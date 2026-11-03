"""Perfis de aparelho: DP Tuya → métrica canônica do contrato de ingestão.

O perfil do BTL40001 segue o modelo de dados oficial (Query Things Data Model,
product_id 68e4caqhuw9j530a), transcrito em docs/AIR-QUALITY-COLLECTOR.md.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    name: str
    # DP → (métrica canônica, divisor da escala)
    metrics: dict[str, tuple[str, float]]
    # DP de temperatura e DP que diz se ela vem em °C ou °F
    temperature_dp: str | None = None
    temperature_unit_dp: str | None = None


BREATHE_BTL40001 = Profile(
    name="breathe-btl40001",
    metrics={
        "2": ("co2_ppm", 1),
        "20": ("pm25_ugm3", 1),
        "101": ("pm10_ugm3", 1),
        "102": ("pm1_ugm3", 1),  # o código Tuya é "pm25", mas o nome oficial é PM1.0
        "21": ("tvoc_mgm3", 1000),
        "22": ("hcho_mgm3", 1000),
        "19": ("humidity_pct", 1),
        "15": ("battery_pct", 1),
    },
    temperature_dp="18",
    temperature_unit_dp="31",
)

PROFILES = {p.name: p for p in (BREATHE_BTL40001,)}


class UnknownProfile(KeyError):
    pass


def get_profile(name: str) -> Profile:
    try:
        return PROFILES[name]
    except KeyError as error:
        raise UnknownProfile(name) from error


def decode(profile: Profile, dps: dict[str, object]) -> dict[str, float]:
    """Converte os DPs brutos em métricas canônicas. DP ausente ou não numérico é ignorado."""
    values: dict[str, float] = {}
    for dp, (metric, divisor) in profile.metrics.items():
        raw = dps.get(dp)
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            values[metric] = raw / divisor
    if profile.temperature_dp:
        raw = dps.get(profile.temperature_dp)
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            unit = dps.get(profile.temperature_unit_dp) if profile.temperature_unit_dp else "c"
            values["temperature_c"] = round((raw - 32) * 5 / 9, 1) if unit == "f" else float(raw)
    return values
