"""Leitura de um aparelho Tuya pela LAN (tinytuya)."""

from __future__ import annotations

from dataclasses import dataclass

from .config import DeviceConfig

# Códigos de erro do tinytuya (tinytuya/core/error_helper.py).
_UNREACHABLE = {"901", "902", "905"}  # conexão, timeout, offline
_AUTH = {"914"}  # chave ou versão de protocolo erradas


@dataclass
class ReadError(Exception):
    state: str  # 'unreachable' | 'auth_failed' | 'bad_payload'
    message: str

    def __str__(self) -> str:
        return f"{self.state}: {self.message}"


def classify(response: object) -> ReadError | None:
    """None se a resposta traz DPs; senão o erro classificado no vocabulário do contrato."""
    if isinstance(response, dict) and isinstance(response.get("dps"), dict):
        return None
    if isinstance(response, dict) and "Err" in response:
        code = str(response.get("Err"))
        message = str(response.get("Error", "erro sem descrição"))[:200]
        if code in _AUTH:
            return ReadError("auth_failed", message)
        if code in _UNREACHABLE:
            return ReadError("unreachable", message)
        return ReadError("bad_payload", f"{code} {message}")
    return ReadError("bad_payload", "resposta sem DPs")


class TuyaReader:
    def __init__(self, config: DeviceConfig, timeout: float = 5.0):
        import tinytuya  # importado aqui para os testes não exigirem a dependência

        self.config = config
        self._device = tinytuya.Device(config.id, config.ip, config.local_key, version=config.protocol)
        self._device.set_socketTimeout(timeout)
        self._device.set_socketRetryLimit(1)

    def read(self) -> dict[str, object]:
        try:
            response = self._device.status()
        except OSError as error:
            raise ReadError("unreachable", str(error)[:200]) from error
        error = classify(response)
        if error:
            raise error
        return response["dps"]  # type: ignore[index]
