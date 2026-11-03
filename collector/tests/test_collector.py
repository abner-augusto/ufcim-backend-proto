import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from ufcim_collector.config import ConfigError, load_config, read_env_file
from ufcim_collector.device import classify
from ufcim_collector.outbox import Outbox
from ufcim_collector.profiles import BREATHE_BTL40001, decode
from ufcim_collector.sampler import MinuteSampler
from ufcim_collector.sender import Backoff, post_batch

# Leitura real da bancada em 2026-11-03 (protocolo 3.5).
BENCH_DPS = {
    "1": "alarm", "2": 482, "5": "middle", "6": "ringtone_1", "13": False, "15": 100, "17": 100,
    "18": 30, "19": 58, "20": 5, "21": 0, "22": 1, "26": 600, "31": "c", "101": 6, "102": 4,
    "105": 16, "106": "alarm", "108": True, "109": 30,
}


def test_decode_bench_payload():
    assert decode(BREATHE_BTL40001, BENCH_DPS) == {
        "co2_ppm": 482, "pm25_ugm3": 5, "pm10_ugm3": 6, "pm1_ugm3": 4,
        "tvoc_mgm3": 0.0, "hcho_mgm3": 0.001, "humidity_pct": 58, "battery_pct": 100,
        "temperature_c": 30.0,
    }


def test_decode_converts_fahrenheit_and_skips_missing():
    values = decode(BREATHE_BTL40001, {"18": 86, "31": "f", "2": "n/a"})
    assert values == {"temperature_c": 30.0}


@pytest.mark.parametrize(
    ("response", "state"),
    [
        ({"dps": {"2": 1}}, None),
        ({"Error": "Network Error: Unable to Connect", "Err": "901"}, "unreachable"),
        ({"Error": "Check device key or version", "Err": "914"}, "auth_failed"),
        ({"Error": "Invalid JSON", "Err": "900"}, "bad_payload"),
        (None, "bad_payload"),
    ],
)
def test_classify(response, state):
    error = classify(response)
    assert (error.state if error else None) == state


def test_sampler_averages_closed_minutes_only():
    sampler = MinuteSampler()
    t0 = datetime(2026, 11, 3, 17, 13, 0, tzinfo=timezone.utc)
    sampler.add("d", {"co2_ppm": 480}, t0)
    sampler.add("d", {"co2_ppm": 490}, t0 + timedelta(seconds=30))
    sampler.add("d", {"co2_ppm": 999}, t0 + timedelta(seconds=60))  # minuto seguinte, ainda aberto
    assert sampler.flush(t0 + timedelta(seconds=58)) == []
    assert sampler.flush(t0 + timedelta(seconds=65)) == [
        {"device": "d", "measured_at": "2026-11-03T17:13:00Z", "values": {"co2_ppm": 485}}
    ]


def test_outbox_survives_reopen_and_dedupes(tmp_path):
    path = tmp_path / "outbox.sqlite3"
    sample = {"device": "d", "measured_at": "2026-11-03T17:13:00Z", "values": {"co2_ppm": 485}}
    box = Outbox(path)
    box.put([sample, sample])
    box.close()
    box = Outbox(path)
    rows = box.take()
    assert [s for _, s in rows] == [sample]
    box.delete([i for i, _ in rows])
    assert len(box) == 0


def test_outbox_purges_old(tmp_path):
    box = Outbox(tmp_path / "o.sqlite3")
    box.put([{"device": "d", "measured_at": "2026-10-01T00:00:00Z", "values": {}}])
    assert box.purge_older_than(7, now=datetime(2026, 11, 3, tzinfo=timezone.utc)) == 1


def test_env_file_and_config(tmp_path):
    (tmp_path / ".env").write_text("# x\nLOCAL_KEY_A='k*]y.'\nUFCIM_COLLECTOR_TOKEN=tok\n", encoding="utf-8")
    env = read_env_file(tmp_path / ".env")
    assert env == {"LOCAL_KEY_A": "k*]y.", "UFCIM_COLLECTOR_TOKEN": "tok"}
    (tmp_path / "config.toml").write_text(
        '[server]\nurl = "http://x/"\n[[devices]]\nid = "d"\nip = "1.2.3.4"\nprofile = "breathe-btl40001"\nlocal_key_env = "LOCAL_KEY_A"\n',
        encoding="utf-8",
    )
    config = load_config(tmp_path / "config.toml", env)
    assert config.server_url == "http://x" and config.devices[0].local_key == "k*]y."
    with pytest.raises(ConfigError):
        load_config(tmp_path / "config.toml", {})


def test_env_only_config_for_one_device():
    from ufcim_collector.config import load_env_config

    env = {
        "UFCIM_SERVER_URL": "https://worker.example/",
        "UFCIM_COLLECTOR_TOKEN": "tok",
        "UFCIM_DEVICE_ID": "dev",
        "UFCIM_DEVICE_IP": "192.168.50.33",
        "UFCIM_DEVICE_LOCAL_KEY": "k*]y.",
        "UFCIM_POLL_SECONDS": "20",
    }
    config = load_env_config(env)
    assert config.server_url == "https://worker.example"
    assert config.poll_seconds == 20 and config.send_seconds == 60
    assert str(config.data_dir).replace("\\", "/") == "/data"
    device = config.devices[0]
    assert (device.id, device.ip, device.protocol, device.profile, device.local_key) == (
        "dev", "192.168.50.33", 3.5, "breathe-btl40001", "k*]y.",
    )
    with pytest.raises(ConfigError, match="UFCIM_DEVICE_LOCAL_KEY"):
        load_env_config({k: v for k, v in env.items() if k != "UFCIM_DEVICE_LOCAL_KEY"})
    with pytest.raises(ConfigError, match="UFCIM_POLL_SECONDS"):
        load_env_config({**env, "UFCIM_POLL_SECONDS": "rápido"})


def _server(status: int, body: dict):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append((self.headers["Authorization"], json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, received


@pytest.mark.parametrize(("status", "outcome"), [(200, "sent"), (400, "drop"), (401, "retry"), (500, "retry")])
def test_post_batch_outcomes(status, outcome):
    server, received = _server(status, {"accepted": 1})
    try:
        result = post_batch(f"http://127.0.0.1:{server.server_port}", "tok", {"samples": []})
    finally:
        server.shutdown()
    assert result.outcome == outcome
    assert received[0][0] == "Bearer tok"


def test_post_batch_network_error_retries():
    assert post_batch("http://127.0.0.1:9", "tok", {}, timeout=1).outcome == "retry"


def test_smartlife_rows_to_samples():
    from ufcim_collector.import_smartlife import parse_rows

    rows = [
        ("DateTime", "PM1.0", "PM2.5", "PM10", "CO2", "VOC", "HCHO", "Temperatura", "Humidade atual", None),
        ("2026/08/05 00:00:00", "#", "#", "#", "#", "#", "#", "#", "#", None),  # velho demais
        ("2026/11/03 10:00:00", "#", "#", "#", "#", "#", "#", "#", "#", None),  # sem dado
        ("2026/11/03 14:30:00", "4.18", "5.39", "6.37", "483.04", "0.00", "0.00", "30.49", "58.36", None),
    ]
    tz = timezone(timedelta(hours=-3))
    samples = parse_rows(rows, "dev", tz, now=datetime(2026, 11, 3, 18, tzinfo=timezone.utc))
    assert samples == [
        {
            "device": "dev",
            "measured_at": "2026-11-03T17:30:00Z",
            "values": {
                "pm1_ugm3": 4.18, "pm25_ugm3": 5.39, "pm10_ugm3": 6.37, "co2_ppm": 483.04,
                "tvoc_mgm3": 0.0, "hcho_mgm3": 0.0, "temperature_c": 30.49, "humidity_pct": 58.36,
            },
        }
    ]


def test_frozen_runs_keep_last_real_reading_and_drop_glued_runs():
    from ufcim_collector.import_smartlife import drop_frozen_runs

    def s(hhmm, co2):
        return {"device": "d", "measured_at": f"2026-11-02T{hhmm}:00Z", "values": {"co2_ppm": co2}}

    samples = [
        s("10:00", 500), s("10:15", 510),
        s("10:30", 482), s("10:45", 482), s("11:00", 482),  # desligou: fica só 10:30
        s("11:15", 481), s("11:30", 481), s("11:45", 481),  # colada à anterior: sai inteira
        s("12:00", 600), s("12:15", 600),                   # só duas iguais: é dado real
    ]
    kept, dropped = drop_frozen_runs(samples)
    assert [x["measured_at"][11:16] for x in kept] == ["10:00", "10:15", "10:30", "12:00", "12:15"]
    assert len(dropped) == 5


def test_backoff_grows_and_caps():
    backoff = Backoff()
    delays = [backoff.failed(jitter=1.0) for _ in range(10)]
    assert delays[0] == 5 and delays[1] == 10 and max(delays) == 300
    backoff.succeeded()
    assert backoff.failed(jitter=1.0) == 5
