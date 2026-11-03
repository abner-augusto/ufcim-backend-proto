"""Backfill a partir do "Export Data" do app Smart Life (planilha .xlsx).

O app envia por e-mail um link para uma planilha com médias de 15 minutos no
horário do aparelho. Este módulo converte as linhas em amostras do contrato de
ingestão e as posta, em lotes, no mesmo endpoint do coletor. O backend recusa
amostras com mais de 7 dias, então só o trecho recente da planilha entra.

    python -m ufcim_collector.import_smartlife export.xlsx \\
        --device ebdaebfb3e5ed2f01crg1m --config config.toml --env-file .env [--dry-run]

Requer `openpyxl` (extra `import` do pyproject).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import __version__
from .config import read_env_file
from .sender import post_batch

# Cabeçalho da planilha (em português no app) → métrica canônica.
COLUMNS = {
    "PM1.0": "pm1_ugm3",
    "PM2.5": "pm25_ugm3",
    "PM10": "pm10_ugm3",
    "CO2": "co2_ppm",
    "VOC": "tvoc_mgm3",
    "HCHO": "hcho_mgm3",
    "Temperatura": "temperature_c",
    "Humidade atual": "humidity_pct",
}
MAX_AGE = timedelta(days=7)
BATCH = 500


def parse_rows(rows: list[tuple], device: str, tz: timezone, now: datetime) -> list[dict]:
    header, *body = rows
    index = {name: i for i, name in enumerate(header) if name}
    if "DateTime" not in index:
        raise ValueError("planilha sem a coluna DateTime")
    samples = []
    for row in body:
        stamp = row[index["DateTime"]]
        if not stamp:
            continue
        moment = datetime.strptime(str(stamp), "%Y/%m/%d %H:%M:%S").replace(tzinfo=tz).astimezone(timezone.utc)
        if now - moment > MAX_AGE:
            continue
        values = {}
        for column, metric in COLUMNS.items():
            raw = row[index[column]] if column in index else None
            try:
                values[metric] = float(raw)
            except (TypeError, ValueError):
                continue  # "#" marca intervalo sem dado
        if values:
            samples.append({"device": device, "measured_at": moment.isoformat().replace("+00:00", "Z"), "values": values})
    return samples


STEP = timedelta(minutes=15)


def drop_frozen_runs(samples: list[dict], min_run: int = 3) -> tuple[list[dict], list[dict]]:
    """Remove trechos em que o aparelho estava desligado.

    Com o aparelho desligado, o Smart Life repete o último valor: N intervalos
    seguidos com as oito métricas idênticas. De cada sequência com `min_run` ou
    mais linhas, fica só a primeira (a última leitura real). Uma sequência
    colada a outra já descartada sai inteira: no export real, à meia-noite o
    valor congelado é reescrito arredondado e começa uma sequência nova.
    """
    groups: list[list[dict]] = []
    for sample in samples:
        moment = datetime.fromisoformat(sample["measured_at"].replace("Z", "+00:00"))
        if groups:
            last = groups[-1][-1]
            last_moment = datetime.fromisoformat(last["measured_at"].replace("Z", "+00:00"))
            if last["values"] == sample["values"] and moment - last_moment == STEP:
                groups[-1].append(sample)
                continue
        groups.append([sample])

    kept: list[dict] = []
    dropped: list[dict] = []
    previous_end: datetime | None = None  # fim da última sequência descartada
    for group in groups:
        start = datetime.fromisoformat(group[0]["measured_at"].replace("Z", "+00:00"))
        if len(group) >= min_run:
            glued = previous_end is not None and start - previous_end == STEP
            kept.extend([] if glued else group[:1])
            dropped.extend(group if glued else group[1:])
            previous_end = datetime.fromisoformat(group[-1]["measured_at"].replace("Z", "+00:00"))
        else:
            kept.extend(group)
            previous_end = None
    return kept, dropped


def main(argv: list[str] | None = None) -> int:
    import tomllib

    import openpyxl

    parser = argparse.ArgumentParser(prog="ufcim_collector.import_smartlife")
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--device", required=True, help="device ID Tuya do aparelho exportado")
    parser.add_argument("--config", type=Path, default=Path("config.toml"))
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--utc-offset", type=float, default=-3.0, help="fuso da planilha em horas (padrão: −3, Fortaleza)")
    parser.add_argument("--min-frozen-run", type=int, default=3, help="linhas idênticas seguidas que indicam aparelho desligado (0 desliga o filtro)")
    parser.add_argument("--dropped-out", type=Path, help="grava os measured_at descartados, um por linha")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    workbook = openpyxl.load_workbook(args.xlsx, read_only=True)
    rows = list(workbook.worksheets[0].iter_rows(values_only=True))
    tz = timezone(timedelta(hours=args.utc_offset))
    samples = parse_rows(rows, args.device, tz, datetime.now(timezone.utc))
    dropped: list[dict] = []
    if args.min_frozen_run:
        samples, dropped = drop_frozen_runs(samples, args.min_frozen_run)
    if args.dropped_out:
        args.dropped_out.write_text("".join(s["measured_at"] + "\n" for s in dropped), encoding="utf-8")
    print(json.dumps({"event": "parsed", "rows": len(rows) - 1, "samples": len(samples), "frozen_dropped": len(dropped),
                      "first": samples[0]["measured_at"] if samples else None,
                      "last": samples[-1]["measured_at"] if samples else None}))
    if args.dry_run or not samples:
        return 0

    config = tomllib.loads(args.config.read_text(encoding="utf-8"))
    env = {**os.environ, **(read_env_file(args.env_file) if args.env_file else {})}
    token = env.get(config["server"].get("token_env", "UFCIM_COLLECTOR_TOKEN"), "")
    url = config["server"]["url"].rstrip("/")
    for start in range(0, len(samples), BATCH):
        payload = {"collector": {"version": f"{__version__}+smartlife-import"}, "samples": samples[start:start + BATCH]}
        result = post_batch(url, token, payload)
        print(json.dumps({"event": "batch", "outcome": result.outcome, "status": result.status, "body": result.body}))
        if result.outcome != "sent":
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
