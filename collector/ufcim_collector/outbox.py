"""Fila local em SQLite: as amostras sobrevivem a queda de rede e a reinício."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path


class Outbox:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path)
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS outbox (
                 id INTEGER PRIMARY KEY,
                 device TEXT NOT NULL,
                 measured_at TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 UNIQUE (device, measured_at)
               )"""
        )
        self._db.commit()

    def put(self, samples: list[dict]) -> None:
        self._db.executemany(
            "INSERT OR REPLACE INTO outbox (device, measured_at, payload) VALUES (?, ?, ?)",
            [(s["device"], s["measured_at"], json.dumps(s)) for s in samples],
        )
        self._db.commit()

    def take(self, limit: int = 500) -> list[tuple[int, dict]]:
        rows = self._db.execute("SELECT id, payload FROM outbox ORDER BY measured_at, id LIMIT ?", (limit,)).fetchall()
        return [(row_id, json.loads(payload)) for row_id, payload in rows]

    def delete(self, ids: list[int]) -> None:
        self._db.executemany("DELETE FROM outbox WHERE id = ?", [(i,) for i in ids])
        self._db.commit()

    def purge_older_than(self, days: float, now: datetime | None = None) -> int:
        now = now or datetime.now(timezone.utc)
        cutoff = (now - timedelta(days=days)).isoformat().replace("+00:00", "Z")
        cursor = self._db.execute("DELETE FROM outbox WHERE measured_at < ?", (cutoff,))
        self._db.commit()
        return cursor.rowcount

    def __len__(self) -> int:
        return self._db.execute("SELECT count(*) FROM outbox").fetchone()[0]

    def close(self) -> None:
        self._db.close()
