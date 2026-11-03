"""Agrega as leituras de cada minuto numa amostra (média por métrica)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone


def minute_of(moment: datetime) -> datetime:
    return moment.astimezone(timezone.utc).replace(second=0, microsecond=0)


class MinuteSampler:
    def __init__(self) -> None:
        # (aparelho, minuto) → métrica → valores lidos
        self._buckets: dict[tuple[str, datetime], dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    def add(self, device: str, values: dict[str, float], at: datetime) -> None:
        if not values:
            return
        bucket = self._buckets[(device, minute_of(at))]
        for metric, value in values.items():
            bucket[metric].append(value)

    def flush(self, now: datetime) -> list[dict]:
        """Devolve as amostras dos minutos já fechados (anteriores ao minuto de `now`)."""
        current = minute_of(now)
        samples = []
        for key in sorted(k for k in self._buckets if k[1] < current):
            device, minute = key
            bucket = self._buckets.pop(key)
            samples.append(
                {
                    "device": device,
                    "measured_at": minute.isoformat().replace("+00:00", "Z"),
                    "values": {m: round(sum(v) / len(v), 3) for m, v in bucket.items()},
                }
            )
        return samples
