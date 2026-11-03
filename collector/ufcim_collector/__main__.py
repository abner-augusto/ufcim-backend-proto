"""Laço do coletor: lê os aparelhos, fecha amostras de 1 min, enfileira e envia.

    python -m ufcim_collector --config config.toml [--env-file .env] [--once]
"""

from __future__ import annotations

import argparse
import json
import random
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .config import Config, ConfigError, load_config, read_env_file
from .device import ReadError, TuyaReader
from .outbox import Outbox
from .profiles import decode, get_profile
from .sampler import MinuteSampler
from .sender import Backoff, post_batch

HEARTBEAT_FILE = "heartbeat"


def log(event: str, **fields: object) -> None:
    record = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Collector:
    def __init__(self, config: Config):
        self.config = config
        self.readers = {d.id: (TuyaReader(d), get_profile(d.profile)) for d in config.devices}
        self.sampler = MinuteSampler()
        self.outbox = Outbox(config.data_dir / "outbox.sqlite3")
        self.backoff = Backoff()
        self.started_at = iso(datetime.now(timezone.utc))
        self.status = {d.id: {"device": d.id, "state": "unreachable", "last_ok_at": None, "error": "sem leitura ainda"} for d in config.devices}
        self.next_send = 0.0
        self.running = True

    def poll(self) -> None:
        now = datetime.now(timezone.utc)
        for device_id, (reader, profile) in self.readers.items():
            try:
                values = decode(profile, reader.read())
            except ReadError as error:
                self.status[device_id].update(state=error.state, error=error.message)
                log("read_failed", device=device_id, state=error.state, error=error.message)
                continue
            if not values:
                self.status[device_id].update(state="bad_payload", error="nenhum DP do perfil")
                continue
            self.sampler.add(device_id, values, now)
            self.status[device_id].update(state="ok", last_ok_at=iso(now), error=None)
        samples = self.sampler.flush(now)
        if samples:
            self.outbox.put(samples)
            log("samples_queued", count=len(samples), queued=len(self.outbox))

    def send(self) -> None:
        if time.monotonic() < self.next_send:
            return
        purged = self.outbox.purge_older_than(self.config.outbox_max_age_days)
        if purged:
            log("outbox_purged", count=purged)
        rows = self.outbox.take(500)
        payload = {
            "collector": {"version": __version__, "started_at": self.started_at},
            "samples": [sample for _, sample in rows],
            "device_status": list(self.status.values()),
        }
        result = post_batch(self.config.server_url, self.config.token, payload)
        if result.outcome == "retry":
            delay = self.backoff.failed(random.random())
            self.next_send = time.monotonic() + delay
            log("send_retry", status=result.status, body=result.body, retry_in_s=round(delay, 1), queued=len(self.outbox))
            return
        self.outbox.delete([row_id for row_id, _ in rows])
        self.backoff.succeeded()
        self.next_send = time.monotonic() + self.config.send_seconds
        event = "send_ok" if result.outcome == "sent" else "send_dropped"
        log(event, status=result.status, body=result.body, sent=len(rows), queued=len(self.outbox))

    def heartbeat(self) -> None:
        (self.config.data_dir / HEARTBEAT_FILE).write_text(iso(datetime.now(timezone.utc)), encoding="utf-8")

    def run(self, once: bool = False) -> None:
        log("started", version=__version__, devices=list(self.readers), server=self.config.server_url)
        while self.running:
            started = time.monotonic()
            self.poll()
            self.heartbeat()
            if once:
                break
            self.send()
            time.sleep(max(0.0, self.config.poll_seconds - (time.monotonic() - started)))
        self.outbox.close()
        log("stopped")

    def stop(self, *_: object) -> None:
        self.running = False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ufcim-collector")
    parser.add_argument("--config", type=Path, default=Path("config.toml"))
    parser.add_argument("--env-file", type=Path, help="arquivo KEY=valor com os segredos (fora do Docker)")
    parser.add_argument("--once", action="store_true", help="uma leitura e sai, sem enviar (diagnóstico)")
    args = parser.parse_args(argv)

    env = None
    if args.env_file:
        import os

        env = {**os.environ, **read_env_file(args.env_file)}
    try:
        config = load_config(args.config, env)
    except (ConfigError, KeyError, FileNotFoundError) as error:
        log("config_error", error=str(error))
        return 2

    collector = Collector(config)
    signal.signal(signal.SIGTERM, collector.stop)
    signal.signal(signal.SIGINT, collector.stop)
    if args.once:
        for device_id, (reader, profile) in collector.readers.items():
            try:
                log("read_once", device=device_id, values=decode(profile, reader.read()))
            except ReadError as error:
                log("read_failed", device=device_id, state=error.state, error=error.message)
        return 0
    collector.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
