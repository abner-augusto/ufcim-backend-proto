"""Configuração: TOML do host + segredos do ambiente (ou de um arquivo .env)."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class DeviceConfig:
    id: str
    ip: str
    protocol: float
    profile: str
    local_key: str


@dataclass(frozen=True)
class Config:
    server_url: str
    token: str
    poll_seconds: float
    send_seconds: float
    outbox_max_age_days: float
    data_dir: Path
    devices: tuple[DeviceConfig, ...]


def read_env_file(path: Path) -> dict[str, str]:
    """Lê KEY=valor, ignorando comentários; aceita valor entre aspas simples ou duplas."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _secret(env: dict[str, str], name: str) -> str:
    value = env.get(name, "")
    if not value:
        raise ConfigError(f"variável de ambiente {name} ausente ou vazia")
    return value


def load_config(path: Path, env: dict[str, str] | None = None) -> Config:
    env = dict(os.environ) if env is None else env
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    server = raw.get("server", {})
    sampling = raw.get("sampling", {})
    storage = raw.get("storage", {})

    devices = tuple(
        DeviceConfig(
            id=d["id"],
            ip=d["ip"],
            protocol=float(d.get("protocol", 3.5)),
            profile=d["profile"],
            local_key=_secret(env, d["local_key_env"]),
        )
        for d in raw.get("devices", [])
    )
    if not devices:
        raise ConfigError("nenhum aparelho em [[devices]]")

    data_dir = Path(storage.get("data_dir", "data"))
    if not data_dir.is_absolute():
        data_dir = path.parent / data_dir

    return Config(
        server_url=server["url"].rstrip("/"),
        token=_secret(env, server.get("token_env", "UFCIM_COLLECTOR_TOKEN")),
        poll_seconds=float(sampling.get("poll_seconds", 15)),
        send_seconds=float(sampling.get("send_seconds", 60)),
        outbox_max_age_days=float(sampling.get("outbox_max_age_days", 7)),
        data_dir=data_dir,
        devices=devices,
    )
