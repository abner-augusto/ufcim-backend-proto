"""Envio de lotes ao backend (POST /ingest/v1/samples)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class SendResult:
    outcome: str  # 'sent' | 'drop' | 'retry'
    status: int | None
    body: dict | str | None


def post_batch(url: str, token: str, payload: dict, timeout: float = 15.0) -> SendResult:
    request = urllib.request.Request(
        f"{url}/ingest/v1/samples",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return SendResult("sent", response.status, _json(response.read()))
    except urllib.error.HTTPError as error:
        body = _json(error.read())
        # 400/422: lote inválido; reenviar não conserta. 401, 429 e 5xx: tentar de novo.
        outcome = "drop" if error.code in (400, 422) else "retry"
        return SendResult(outcome, error.code, body)
    except (urllib.error.URLError, OSError) as error:
        return SendResult("retry", None, str(error)[:200])


def _json(raw: bytes) -> dict | str:
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return raw.decode("utf-8", errors="replace")[:200]


class Backoff:
    """Exponencial de 5 s a 5 min, com jitter, depois de cada falha."""

    def __init__(self, base: float = 5.0, cap: float = 300.0):
        self.base, self.cap, self.failures = base, cap, 0

    def failed(self, jitter: float) -> float:
        self.failures += 1
        return min(self.cap, self.base * 2 ** (self.failures - 1)) * (0.5 + jitter / 2)

    def succeeded(self) -> None:
        self.failures = 0
