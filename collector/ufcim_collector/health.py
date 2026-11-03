"""Healthcheck do container: o heartbeat precisa ter menos de 3 minutos."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_AGE_SECONDS = 180


def main(data_dir: str = "/data") -> int:
    try:
        stamp = (Path(data_dir) / "heartbeat").read_text(encoding="utf-8").strip()
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(stamp.replace("Z", "+00:00"))).total_seconds()
    except (OSError, ValueError):
        return 1
    return 0 if age < MAX_AGE_SECONDS else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
