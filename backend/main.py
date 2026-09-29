"""
main.py — FastAPI backend voor het Energie Dashboard.

Rol: proxy naar de Home Assistant van de ingelogde gebruiker. Inloggen en
opslag doet Apenkaas; deze backend controleert het user-JWT via Apenkaas /me en
leest de HA-koppeling (URL, token, P1-entities) met de server-key. Het HA-token
gaat nooit terug naar de browser en komt nooit in de logs.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from apenkaas import Apenkaas, ApenkaasFout, NietIngelogd
from ha_stats import combine_import_export, fetch_hourly_statistics
from ha_url import UrlNietToegestaan, check_ha_url
from p1 import GeenP1Gevonden, find_p1_entities

log = logging.getLogger("energy-dash")


class Settings(BaseSettings):
    apenkaas_url: str = "http://192.168.178.202:3000"
    apenkaas_tenant_id: str = ""
    apenkaas_server_key: str = ""
    apenkaas_koppeling_collection_id: str = ""
    ha_prive_toegestaan: str = ""
    cors_origins: str = "http://localhost:8080"

    class Config:
        env_file = ".env"


settings = Settings()
PRIVE_TOEGESTAAN = {h.strip().lower() for h in settings.ha_prive_toegestaan.split(",") if h.strip()}
apenkaas = Apenkaas(settings.apenkaas_url, settings.apenkaas_tenant_id,
                    settings.apenkaas_server_key, settings.apenkaas_koppeling_collection_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown
    await apenkaas.aclose()


app = FastAPI(title="Energie Dashboard API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["GET", "PUT", "DELETE"],
    allow_headers=["*"],
)


def fout(status: int, code: str, melding: str) -> HTTPException:
    return HTTPException(status, {"code": code, "melding": melding})


bearer = HTTPBearer(auto_error=False)


async def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if cred is None:
        raise fout(401, "niet_ingelogd", "Log eerst in")
    try:
        return await apenkaas.user_id(cred.credentials)
    except NietIngelogd:
        raise fout(401, "niet_ingelogd", "Je sessie is verlopen, log opnieuw in")
    except ApenkaasFout as e:
        log.warning("apenkaas /me mislukt: %s", e)
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")


async def koppeling_van(uid: str = Depends(current_user)) -> dict:
    try:
        k = await apenkaas.get_koppeling(uid)
    except ApenkaasFout as e:
        log.warning("koppeling lezen mislukt user=%s: %s", uid, e)
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")
    if k is None:
        raise fout(404, "geen_koppeling", "Nog geen Home Assistant gekoppeld")
    return k


async def _veilige_url(url: str) -> str:
    try:
        return await asyncio.to_thread(check_ha_url, url, PRIVE_TOEGESTAAN)
    except UrlNietToegestaan as e:
        raise fout(422, "url_geweigerd", str(e))


async def _ha_get(url: str, token: str, path: str):
    """GET op de HA van de gebruiker. Geeft JSON terug; ruwe HA-antwoorden gaan nooit door."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            r = await client.get(f"{url}{path}", headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        raise fout(502, "ha_onbereikbaar", "Je Home Assistant is niet bereikbaar")
    if r.status_code in (401, 403):
        raise fout(502, "ha_token", "Home Assistant accepteert het token niet")
    if r.status_code != 200:
        raise fout(502, "ha_onbereikbaar", f"Home Assistant gaf status {r.status_code}")
    return r.json()


async def _ha_state(k: dict, entity_id: str) -> dict:
    url = await _veilige_url(k["ha_url"])
    return await _ha_get(url, k["ha_token"], f"/api/states/{entity_id}")


@app.get("/health")
def health() -> dict:
    """Liveness check voor Docker/Coolify. Praat niet met HA of Apenkaas."""
    return {"status": "ok"}


class KoppelingIn(BaseModel):
    ha_url: str = Field(min_length=1, max_length=500)
    ha_token: str = Field(min_length=1, max_length=1000)


@app.get("/koppeling")
async def koppeling_status(uid: str = Depends(current_user)) -> dict:
    try:
        k = await apenkaas.get_koppeling(uid)
    except ApenkaasFout:
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")
    return {"gekoppeld": k is not None, "ha_url": k["ha_url"] if k else None}


@app.put("/koppeling")
async def koppeling_opslaan(body: KoppelingIn, uid: str = Depends(current_user)) -> dict:
    url = await _veilige_url(body.ha_url)
    states = await _ha_get(url, body.ha_token, "/api/states")
    try:
        entities = find_p1_entities(states if isinstance(states, list) else [])
    except GeenP1Gevonden as e:
        raise fout(422, "geen_p1", str(e))
    try:
        await apenkaas.put_koppeling(uid, {"ha_url": url, "ha_token": body.ha_token, "entities": entities})
    except ApenkaasFout as e:
        log.warning("koppeling opslaan mislukt user=%s: %s", uid, e)
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")
    log.info("koppeling opgeslagen user=%s", uid)
    return {"gekoppeld": True, "ha_url": url}


@app.delete("/koppeling")
async def koppeling_verwijderen(uid: str = Depends(current_user)) -> dict:
    try:
        await apenkaas.delete_koppeling(uid)
    except ApenkaasFout:
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")
    return {"gekoppeld": False}


@app.get("/now")
async def now(k: dict = Depends(koppeling_van)) -> dict:
    """Actueel vermogen en actief tarief; de prijs rekent de frontend uit."""
    power = await _ha_state(k, k["entities"]["active_power"])
    tariff = await _ha_state(k, k["entities"]["active_tariff"])
    try:
        vermogen = float(power["state"])
    except (KeyError, TypeError, ValueError):
        raise fout(502, "ha_onbereikbaar", "Home Assistant gaf geen geldig vermogen")
    return {"vermogen_w": vermogen, "actief_tarief": "dal" if tariff.get("state") == "1" else "piek"}


@app.get("/hours")
async def hours(days: int = Query(365, ge=1, le=730), k: dict = Depends(koppeling_van)) -> list[dict]:
    """Uurdata {imp, exp} uit de HA recorder-statistieken van de gebruiker."""
    url = await _veilige_url(k["ha_url"])
    e = k["entities"]
    import_ids = [e["import_t1"], e["import_t2"]]
    export_ids = [e["export_t1"], e["export_t2"]]
    try:
        stats = await fetch_hourly_statistics(url, k["ha_token"], import_ids + export_ids, days)
    except Exception as err:  # ook OSError, timeouts, redirects: nooit HA-tekst terug naar de gebruiker
        log.warning("uurstatistieken mislukt: %r", err)
        raise fout(502, "ha_onbereikbaar", "Uur-statistieken ophalen mislukt")
    records = combine_import_export(stats, import_ids, export_ids)
    if not records:
        raise fout(422, "geen_uurdata", "Home Assistant heeft (nog) geen uur-statistieken voor de P1-meter")
    return records
