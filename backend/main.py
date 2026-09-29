"""
main.py — FastAPI backend voor het Energie Dashboard.

Rol: proxy naar Home Assistant (token blijft serverside) + tarief-/advieslogica.
De frontend praat ALLEEN met deze backend, nooit direct met HA.

Dit is een werkend skelet: /health en /config werken meteen; de HA-endpoints
zijn gemarkeerd met TODO en moeten in Claude Code afgemaakt worden (fase 1 van
docs/PLAN.md). Zo start de container en slaagt de health check al.
"""
from __future__ import annotations

from functools import lru_cache

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings

from ha_stats import (
    HAStatsError,
    fetch_hourly_statistics,
    combine_import_export,
)


class Settings(BaseSettings):
    ha_base_url: str = "http://homeassistant.local:8123"
    ha_token: str = ""
    tarief_piek: float = 0.254390
    tarief_dal: float = 0.233699
    tarief_teruglevering: float = 0.060000
    cors_origins: str = "http://localhost:8080"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
app = FastAPI(title="Energie Dashboard API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# HomeWizard P1 entiteiten (zie reference/ha-entities.md)
SERIAL = "3c39e72e8b26"
E = {
    "active_power": f"sensor.p1_meter_{SERIAL}_active_power",
    "active_tariff": f"sensor.p1_meter_{SERIAL}_active_tariff",
    "import_t1": f"sensor.p1_meter_{SERIAL}_total_power_import_t1",
    "import_t2": f"sensor.p1_meter_{SERIAL}_total_power_import_t2",
    "export_t1": f"sensor.p1_meter_{SERIAL}_total_power_export_t1",
    "export_t2": f"sensor.p1_meter_{SERIAL}_total_power_export_t2",
}


def _ha_headers() -> dict[str, str]:
    if not settings.ha_token:
        raise HTTPException(500, "HA_TOKEN niet ingesteld (zie .env / secrets).")
    return {"Authorization": f"Bearer {settings.ha_token}"}


async def _ha_state(entity_id: str) -> dict:
    url = f"{settings.ha_base_url}/api/states/{entity_id}"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, headers=_ha_headers())
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"HA-fout voor {entity_id}")
    return r.json()


@app.get("/health")
def health() -> dict:
    """Liveness check voor Docker/Coolify. Praat NIET met HA (altijd snel)."""
    return {"status": "ok"}


@app.get("/config")
def config() -> dict:
    """Tarieven die de frontend gebruikt (uit env/contract)."""
    return {
        "tarief_piek": settings.tarief_piek,
        "tarief_dal": settings.tarief_dal,
        "tarief_teruglevering": settings.tarief_teruglevering,
    }


@app.get("/now")
async def now() -> dict:
    """Actuele situatie: vermogen, actief tarief, huidige prijs."""
    power = await _ha_state(E["active_power"])
    tariff = await _ha_state(E["active_tariff"])
    actief = tariff["state"]
    prijs = settings.tarief_dal if actief == "1" else settings.tarief_piek
    return {
        "vermogen_w": float(power["state"]),
        "actief_tarief": "dal" if actief == "1" else "piek",
        "prijs_kwh": prijs,
    }


@app.get("/hours")
async def hours(days: int = 365) -> list[dict]:
    """
    Uurdata {imp, exp} voor de accu- en saldering-features, uit de HA recorder-
    statistieken (WebSocket). Combineert import t1+t2 en export t1+t2 per uur.
    `days` = hoeveel dagen terug (default 365). Levert:
        [{ "imp": <kWh dat uur>, "exp": <kWh dat uur> }, ...]
    """
    if not settings.ha_token:
        raise HTTPException(500, "HA_TOKEN niet ingesteld (zie .env / secrets).")

    import_ids = [E["import_t1"], E["import_t2"]]
    export_ids = [E["export_t1"], E["export_t2"]]

    try:
        stats = await fetch_hourly_statistics(
            settings.ha_base_url,
            settings.ha_token,
            import_ids + export_ids,
            days,
        )
    except HAStatsError as e:
        raise HTTPException(502, f"HA-statistieken ophalen mislukt: {e}")

    records = combine_import_export(stats, import_ids, export_ids)
    if not records:
        raise HTTPException(
            404,
            "Geen uur-statistieken gevonden. Heeft de recorder genoeg historie, "
            "en kloppen de entiteit-id's in main.py?",
        )
    return records
