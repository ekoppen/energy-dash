# Energy-dash × Apenkaas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meerdere huishoudens loggen in via Apenkaas, koppelen hun eigen Home Assistant (of gebruiken jaartotalen/CSV), en zien hun instellingen en uurdata terug.

**Architecture:** De browser praat rechtstreeks met Apenkaas voor inloggen, de collection `instellingen` en de bucket `uurdata`. De FastAPI-backend controleert het user-JWT via Apenkaas `/me`, leest de HA-koppeling met een server-key uit de collection `ha_koppeling` (document-id = gebruikers-id) en blijft de enige die HA-tokens ziet.

**Tech Stack:** FastAPI + httpx + pytest (backend), Vite + React 18 + TypeScript + vitest (frontend), Apenkaas REST-API (bestaand, ongewijzigd).

**Spec:** `docs/superpowers/specs/2026-09-29-apenkaas-koppeling-design.md`

## Global Constraints

- Apenkaas zelf wordt niet gewijzigd; alleen via de console ingericht.
- HA-token nooit naar de browser, nooit in logs.
- Alleen HomeWizard P1; entity-id's worden gedetecteerd, niet hardgecodeerd.
- Privé/loopback/link-local/gereserveerde adressen geweigerd, behalve hosts in `HA_PRIVE_TOEGESTAAN`. Geen redirects volgen. Controle bij elk gebruik.
- Geen nieuwe frontend-dependencies (fetch, geen SDK).
- Backend-fouten als `{"detail": {"code": "...", "melding": "..."}}`.
- Alleen tegen `apenkaas-test` (192.168.178.202:3000); dit is een test-opzet.
- Bestanden onder 500 regels; `.env` nooit committen.

**Afwijkingen van de spec (bij het plannen ontdekt):**
- *Geen publieke app-key nodig.* Apenkaas spiegelt elke Origin in CORS (`demo/server.mjs:133`), en user-routes gebruiken het user-JWT.
- *Geen "wachtwoord vergeten" in de UI.* Apenkaas stuurt het reset-token alleen via een webhook, en er is geen mailer. Een beheerder reset het wachtwoord via de Apenkaas-console. Kan later, zodra er een mail-webhook is.
- *Jaartotalen en CSV blijven op het Advies-scherm* (daar zitten ze nu al) en verhuizen niet naar Instellingen. Ze worden wel bewaard.

## Review Focus

1. **Tweede P1-meter of een andere naamgeving.** Detectie kiest één apparaat-prefix waarvan álle zes entities bestaan, en mengt nooit twee meters. Test: `test_p1_kiest_complete_meter` (Task 2).
2. **IPv4-mapped IPv6 (`::ffff:127.0.0.1`) en DNS die naar een privé-adres wijst.** Beide worden geweigerd. Tests: `test_ipv4_mapped_loopback_geweigerd` en `test_hostnaam_naar_prive_geweigerd` (Task 1).
3. **Verlopen access-token terwijl twee verzoeken tegelijk lopen.** Er is maar één refresh-call; beide verzoeken slagen daarna. Test: `authFetch ververst één keer bij gelijktijdige 401s` (Task 5).
4. **Koppeling opgeslagen, daarna HA offline of token ingetrokken.** `/now` geeft 502 met een duidelijke code, geen 500. Test: `test_now_ha_onbereikbaar_502` (Task 4).
5. **Eerste login in React StrictMode (effect draait dubbel).** Er wordt maar één `instellingen`-document aangemaakt. Test: `laadInstellingen maakt één document bij gelijktijdige aanroepen` (Task 6).

---

## Bestandsoverzicht

| Bestand | Verantwoordelijkheid |
|---|---|
| `backend/ha_url.py` (nieuw) | URL-controle tegen SSRF |
| `backend/p1.py` (nieuw) | HomeWizard P1-entities vinden in `/api/states` |
| `backend/apenkaas.py` (nieuw) | `/me` met cache + CRUD op `ha_koppeling` met server-key |
| `backend/main.py` (herschreven) | endpoints, auth-dependency, foutvertaling |
| `backend/tests/*.py` (nieuw) | pytest |
| `backend/requirements-dev.txt` (nieuw) | pytest |
| `frontend/src/auth.ts` (nieuw) | sessie, login/registreren/uitloggen, `authFetch` met refresh |
| `frontend/src/instellingen.ts` (nieuw) | `instellingen`-document laden/bewaren |
| `frontend/src/uurdata.ts` (nieuw) | CSV in bucket `uurdata` bewaren/laden |
| `frontend/src/api.ts` | backend-calls via `authFetch`, `ApiFout` |
| `frontend/src/routes/Login.tsx` (nieuw) | inlog-/registratiescherm |
| `frontend/src/routes/Instellingen.tsx` (nieuw) | tarieven + HA koppelen |
| `frontend/src/main.tsx` | route-guard, nav, uitloggen |
| `frontend/src/routes/Overzicht.tsx`, `Advies.tsx`, `features/*/…tsx` | eigen tarieven, bewaren van schuifjes/CSV |
| `.env.example`, `docker-compose.yml`, `frontend/Dockerfile`, `deploy/README.md`, `README.md` | config + docs |

---

### Task 1: URL-controle (SSRF)

**Files:**
- Create: `backend/ha_url.py`, `backend/tests/__init__.py` (leeg), `backend/tests/test_ha_url.py`, `backend/requirements-dev.txt`, `backend/pytest.ini`

**Interfaces:**
- Produces: `class UrlNietToegestaan(Exception)`; `check_ha_url(url: str, allow_private: set[str], resolve=_resolve) -> str` geeft de genormaliseerde URL terug (zonder trailing `/`), of gooit `UrlNietToegestaan`.

- [ ] **Step 1: Test-setup**

`backend/requirements-dev.txt`:
```
-r requirements.txt
pytest==8.3.3
```
`backend/pytest.ini`:
```ini
[pytest]
testpaths = tests
pythonpath = .
```
Run: `cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`
(Gebruik Python 3.12, net als de Dockerfile. De Mac heeft standaard 3.14, en daarvoor heeft `pydantic==2.9.2` geen kant-en-klare wheels. Ontbreekt 3.12, installeer die dan met `brew install python@3.12`.) Voeg `backend/.venv/` niet toe aan git; `.gitignore` dekt `.venv/` al.

- [ ] **Step 2: Failing tests** — `backend/tests/test_ha_url.py`:
```python
import pytest

from ha_url import UrlNietToegestaan, check_ha_url


def resolver(mapping):
    return lambda host: mapping[host]


def test_publiek_adres_ok():
    r = resolver({"ha.example.nl": ["93.184.216.34"]})
    assert check_ha_url("https://ha.example.nl/", set(), r) == "https://ha.example.nl"


def test_prive_ip_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("http://192.168.178.1:8123", set(), resolver({"192.168.178.1": ["192.168.178.1"]}))


def test_localhost_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("http://localhost:8123", set(), resolver({"localhost": ["127.0.0.1"]}))


def test_hostnaam_naar_prive_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("https://evil.example", set(), resolver({"evil.example": ["93.184.216.34", "10.0.0.5"]}))


def test_ipv4_mapped_loopback_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("http://[::ffff:127.0.0.1]:8123", set(), resolver({"::ffff:127.0.0.1": ["::ffff:127.0.0.1"]}))


def test_allowlist_mag_prive():
    def nooit(host):
        raise AssertionError("allowlist hoort niet te resolven")
    assert check_ha_url("http://192.168.178.50:8123", {"192.168.178.50"}, nooit) == "http://192.168.178.50:8123"


@pytest.mark.parametrize("url", ["ftp://ha.example.nl", "ha.example.nl", "http://", "file:///etc/passwd"])
def test_ongeldige_url(url):
    with pytest.raises(UrlNietToegestaan):
        check_ha_url(url, set(), resolver({}))


def test_onbekende_host():
    def faal(host):
        raise OSError("nx")
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("https://bestaat-niet.example", set(), faal)
```

- [ ] **Step 3: Run** `cd backend && .venv/bin/pytest tests/test_ha_url.py -v` → FAIL (`ModuleNotFoundError: ha_url`)

- [ ] **Step 4: Implementatie** — `backend/ha_url.py`:
```python
"""
ha_url.py — controleert een door de gebruiker opgegeven Home Assistant-URL.

De backend draait in het homelab; zonder deze controle kan een gebruiker de
backend interne adressen laten aanroepen (SSRF). Privé/loopback/link-local/
gereserveerde adressen worden geweigerd, behalve expliciet toegestane hosts.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit


class UrlNietToegestaan(Exception):
    pass


def _resolve(host: str) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, None)]


# ponytail: resolve-dan-verbinden laat een DNS-rebinding-venster open; dicht
# te zetten door op het geresolvede IP te verbinden als dat ooit nodig is.
def check_ha_url(url: str, allow_private: set[str], resolve=_resolve) -> str:
    url = url.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UrlNietToegestaan("Gebruik een http(s)-adres, bv. https://jouw-ha.example.nl")
    host = parts.hostname.lower()
    if host in allow_private:
        return url.rstrip("/")
    try:
        addresses = resolve(host)
    except OSError:
        raise UrlNietToegestaan("Deze hostnaam bestaat niet")
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%")[0])
        if ip.version == 6 and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global:
            raise UrlNietToegestaan("Dit adres is niet toegestaan")
    return url.rstrip("/")
```

- [ ] **Step 5: Run** `.venv/bin/pytest tests/test_ha_url.py -v` → alle PASS

- [ ] **Step 6: Commit**
```bash
git add backend/ha_url.py backend/tests backend/requirements-dev.txt backend/pytest.ini
git commit -m "feat(backend): URL-controle tegen SSRF voor gebruikers-HA"
```

---

### Task 2: P1-detectie

**Files:**
- Create: `backend/p1.py`, `backend/tests/test_p1.py`

**Interfaces:**
- Produces: `P1_KEYS: tuple[str, ...]` = `("active_power", "active_tariff", "import_t1", "import_t2", "export_t1", "export_t2")`; `class GeenP1Gevonden(Exception)`; `find_p1_entities(states: list[dict]) -> dict[str, str]` (sleutel uit `P1_KEYS` → entity_id).

- [ ] **Step 1: Failing tests** — `backend/tests/test_p1.py`:
```python
import pytest

from p1 import GeenP1Gevonden, find_p1_entities

SUFFIXES = ["active_power", "active_tariff", "total_power_import_t1", "total_power_import_t2",
            "total_power_export_t1", "total_power_export_t2"]


def states(prefix, skip=()):
    return [{"entity_id": f"{prefix}_{s}"} for s in SUFFIXES if s not in skip]


def test_vindt_meter_met_serienummer():
    found = find_p1_entities(states("sensor.p1_meter_3c39e72e8b26") + [{"entity_id": "light.keuken"}])
    assert found["active_power"] == "sensor.p1_meter_3c39e72e8b26_active_power"
    assert found["export_t2"] == "sensor.p1_meter_3c39e72e8b26_total_power_export_t2"
    assert len(found) == 6


def test_vindt_meter_zonder_serienummer():
    assert find_p1_entities(states("sensor.p1_meter"))["import_t1"] == "sensor.p1_meter_total_power_import_t1"


def test_p1_kiest_complete_meter():
    incompleet = states("sensor.p1_meter_aaa", skip=("total_power_export_t2",))
    found = find_p1_entities(incompleet + states("sensor.p1_meter_bbb"))
    assert set(found.values()) == {f"sensor.p1_meter_bbb_{s}" for s in SUFFIXES}


def test_geen_p1():
    with pytest.raises(GeenP1Gevonden):
        find_p1_entities(states("sensor.p1_meter_aaa", skip=("active_tariff",)))


def test_negeert_power_l1():
    extra = [{"entity_id": "sensor.p1_meter_aaa_active_power_l1"}]
    assert find_p1_entities(extra + states("sensor.p1_meter_aaa"))["active_power"] == "sensor.p1_meter_aaa_active_power"
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_p1.py -v` → FAIL (module ontbreekt)

- [ ] **Step 3: Implementatie** — `backend/p1.py`:
```python
"""p1.py — vindt de HomeWizard P1-entities in de HA-states van een gebruiker."""
from __future__ import annotations

P1_SUFFIXES = {
    "active_power": "_active_power",
    "active_tariff": "_active_tariff",
    "import_t1": "_total_power_import_t1",
    "import_t2": "_total_power_import_t2",
    "export_t1": "_total_power_export_t1",
    "export_t2": "_total_power_export_t2",
}
P1_KEYS = tuple(P1_SUFFIXES)


class GeenP1Gevonden(Exception):
    pass


def find_p1_entities(states: list[dict]) -> dict[str, str]:
    """Kiest één meter (apparaat-prefix) waarvan alle zes entities bestaan."""
    ids = {s.get("entity_id", "") for s in states}
    power_suffix = P1_SUFFIXES["active_power"]
    prefixes = sorted(
        i[: -len(power_suffix)] for i in ids
        if i.startswith("sensor.p1_meter") and i.endswith(power_suffix)
    )
    for prefix in prefixes:
        found = {key: prefix + suffix for key, suffix in P1_SUFFIXES.items()}
        if all(entity in ids for entity in found.values()):
            return found
    raise GeenP1Gevonden("Geen HomeWizard P1-meter gevonden in deze Home Assistant")
```

- [ ] **Step 4: Run** `.venv/bin/pytest tests/test_p1.py -v` → alle PASS

- [ ] **Step 5: Commit**
```bash
git add backend/p1.py backend/tests/test_p1.py
git commit -m "feat(backend): HomeWizard P1-entities automatisch detecteren"
```

---

### Task 3: Apenkaas-client

**Files:**
- Create: `backend/apenkaas.py`, `backend/tests/test_apenkaas.py`

**Interfaces:**
- Produces: `class NietIngelogd(Exception)`, `class ApenkaasFout(Exception)`, en
  `class Apenkaas(base_url: str, tenant_id: str, server_key: str, koppeling_collection_id: str, transport: httpx.AsyncBaseTransport | None = None)` met:
  - `async user_id(token: str) -> str` (60 s cache per token)
  - `async get_koppeling(user_id: str) -> dict | None` (de `data` van het document)
  - `async put_koppeling(user_id: str, data: dict) -> None`
  - `async delete_koppeling(user_id: str) -> None`
- Consumes (Apenkaas): `GET /api/<t>/me` → `{user_id, tenant_id, ...}`. Documenten: `GET/PATCH/DELETE /api/<t>/collections/<c>/documents/<id>` en `POST …/documents` met `{data, id, readPermissions, writePermissions}`. Server-key als `Authorization: ApiKey <key>`.

- [ ] **Step 1: Failing tests** — `backend/tests/test_apenkaas.py`:
```python
import asyncio

import httpx
import pytest

from apenkaas import Apenkaas, ApenkaasFout, NietIngelogd


def maak(handler):
    return Apenkaas("http://ak", "t1", "geheim", "kop", transport=httpx.MockTransport(handler))


def test_user_id_en_cache():
    calls = []

    def handler(req):
        calls.append(req)
        assert req.url.path == "/api/t1/me"
        assert req.headers["authorization"] == "Bearer tok"
        return httpx.Response(200, json={"user_id": "u1", "tenant_id": "t1"})

    ak = maak(handler)
    assert asyncio.run(ak.user_id("tok")) == "u1"
    assert asyncio.run(ak.user_id("tok")) == "u1"
    assert len(calls) == 1


def test_user_id_ongeldig():
    ak = maak(lambda req: httpx.Response(401, json={"error": "invalid_token"}))
    with pytest.raises(NietIngelogd):
        asyncio.run(ak.user_id("slecht"))


def test_apenkaas_onbereikbaar():
    def handler(req):
        raise httpx.ConnectError("weg")
    with pytest.raises(ApenkaasFout):
        asyncio.run(maak(handler).user_id("tok"))


def test_get_koppeling_bestaat_niet():
    ak = maak(lambda req: httpx.Response(404, json={"error": "not_found"}))
    assert asyncio.run(ak.get_koppeling("u1")) is None


def test_get_koppeling_gebruikt_server_key():
    def handler(req):
        assert req.headers["authorization"] == "ApiKey geheim"
        assert req.url.path == "/api/t1/collections/kop/documents/u1"
        return httpx.Response(200, json={"id": "u1", "data": {"ha_url": "https://x"}})
    assert asyncio.run(maak(handler).get_koppeling("u1")) == {"ha_url": "https://x"}


def test_put_koppeling_maakt_aan_als_niet_bestaat():
    seen = []

    def handler(req):
        seen.append((req.method, req.url.path))
        if req.method == "PATCH":
            return httpx.Response(404, json={})
        body = __import__("json").loads(req.content)
        assert body == {"id": "u1", "data": {"a": 1}, "readPermissions": ["app"], "writePermissions": ["app"]}
        return httpx.Response(200, json={"id": "u1"})

    asyncio.run(maak(handler).put_koppeling("u1", {"a": 1}))
    assert seen == [("PATCH", "/api/t1/collections/kop/documents/u1"), ("POST", "/api/t1/collections/kop/documents")]


def test_delete_koppeling_404_is_ok():
    asyncio.run(maak(lambda req: httpx.Response(404, json={})).delete_koppeling("u1"))
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_apenkaas.py -v` → FAIL (module ontbreekt)

- [ ] **Step 3: Implementatie** — `backend/apenkaas.py`:
```python
"""
apenkaas.py — praat met Apenkaas: wie is ingelogd (/me) en de HA-koppeling
per gebruiker (collection ha_koppeling, leesbaar alleen met de server-key).
"""
from __future__ import annotations

import time

import httpx

ME_CACHE_SECONDS = 60


class NietIngelogd(Exception):
    pass


class ApenkaasFout(Exception):
    pass


class Apenkaas:
    def __init__(self, base_url: str, tenant_id: str, server_key: str,
                 koppeling_collection_id: str, transport: httpx.AsyncBaseTransport | None = None):
        self._client = httpx.AsyncClient(
            base_url=f"{base_url.rstrip('/')}/api/{tenant_id}", timeout=10, transport=transport
        )
        self._server = {"Authorization": f"ApiKey {server_key}"}
        self._docs = f"/collections/{koppeling_collection_id}/documents"
        self._me_cache: dict[str, tuple[float, str]] = {}

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            return await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as e:
            raise ApenkaasFout(f"Apenkaas onbereikbaar: {e}") from e

    async def user_id(self, token: str) -> str:
        now = time.monotonic()
        hit = self._me_cache.get(token)
        if hit and hit[0] > now:
            return hit[1]
        r = await self._request("GET", "/me", headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 401:
            raise NietIngelogd()
        if r.status_code != 200:
            raise ApenkaasFout(f"/me gaf {r.status_code}")
        uid = r.json()["user_id"]
        self._me_cache = {t: v for t, v in self._me_cache.items() if v[0] > now}
        self._me_cache[token] = (now + ME_CACHE_SECONDS, uid)
        return uid

    async def get_koppeling(self, user_id: str) -> dict | None:
        r = await self._request("GET", f"{self._docs}/{user_id}", headers=self._server)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise ApenkaasFout(f"koppeling lezen gaf {r.status_code}")
        return r.json()["data"]

    async def put_koppeling(self, user_id: str, data: dict) -> None:
        r = await self._request("PATCH", f"{self._docs}/{user_id}", headers=self._server, json={"data": data})
        if r.status_code == 404:
            r = await self._request("POST", self._docs, headers=self._server, json={
                "id": user_id, "data": data, "readPermissions": ["app"], "writePermissions": ["app"],
            })
        if r.status_code != 200:
            raise ApenkaasFout(f"koppeling opslaan gaf {r.status_code}")

    async def delete_koppeling(self, user_id: str) -> None:
        r = await self._request("DELETE", f"{self._docs}/{user_id}", headers=self._server)
        if r.status_code not in (200, 404):
            raise ApenkaasFout(f"koppeling verwijderen gaf {r.status_code}")
```

- [ ] **Step 4: Run** `.venv/bin/pytest tests/test_apenkaas.py -v` → alle PASS

- [ ] **Step 5: Commit**
```bash
git add backend/apenkaas.py backend/tests/test_apenkaas.py
git commit -m "feat(backend): Apenkaas-client voor /me en HA-koppeling"
```

---

### Task 4: Backend-endpoints per gebruiker

**Files:**
- Modify: `backend/main.py` (volledig vervangen, zie hieronder)
- Create: `backend/tests/test_main.py`
- Modify: `.env.example`, `docker-compose.yml` (backend-environment)

**Interfaces:**
- Consumes: `check_ha_url`, `UrlNietToegestaan` (Task 1); `find_p1_entities`, `GeenP1Gevonden`, `P1_KEYS` (Task 2); `Apenkaas`, `NietIngelogd`, `ApenkaasFout` (Task 3); `fetch_hourly_statistics`, `combine_import_export`, `HAStatsError` (bestaand `ha_stats.py`).
- Produces (HTTP, alles behalve `/health` vereist `Authorization: Bearer <user-JWT>`):
  - `GET /koppeling` → `{"gekoppeld": bool, "ha_url": str | null}`
  - `PUT /koppeling` body `{"ha_url": str, "ha_token": str}` → `{"gekoppeld": true, "ha_url": str}`
  - `DELETE /koppeling` → `{"gekoppeld": false}`
  - `GET /now` → `{"vermogen_w": float, "actief_tarief": "dal" | "piek"}`
  - `GET /hours?days=365` → `[{"imp": float, "exp": float}, ...]`
  - Foutcodes: 401 `niet_ingelogd`, 404 `geen_koppeling`, 422 `url_geweigerd` / `geen_p1` / `geen_uurdata`, 502 `ha_onbereikbaar` / `ha_token`, 503 `apenkaas_onbereikbaar`.

- [ ] **Step 1: Failing tests** — `backend/tests/test_main.py`:
```python
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from apenkaas import ApenkaasFout, NietIngelogd

KOPPELING = {
    "ha_url": "https://ha.example.nl",
    "ha_token": "HA-GEHEIM",
    "entities": {k: f"sensor.p1_meter_x_{k}" for k in
                 ("active_power", "active_tariff", "import_t1", "import_t2", "export_t1", "export_t2")},
}


class NepApenkaas:
    def __init__(self, koppeling=None, fout=None):
        self.koppeling, self.fout, self.opgeslagen = koppeling, fout, None

    async def user_id(self, token):
        if self.fout:
            raise self.fout
        if token != "goed":
            raise NietIngelogd()
        return "u1"

    async def get_koppeling(self, uid):
        return self.koppeling

    async def put_koppeling(self, uid, data):
        self.opgeslagen = data

    async def delete_koppeling(self, uid):
        self.koppeling = None


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "check_ha_url", lambda url, allow: url.rstrip("/"))
    return TestClient(main.app)


AUTH = {"Authorization": "Bearer goed"}


def test_health_zonder_auth(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_zonder_token_401(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas())
    r = client.get("/now")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "niet_ingelogd"


def test_apenkaas_weg_503(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(fout=ApenkaasFout("weg")))
    assert client.get("/now", headers=AUTH).status_code == 503


def test_now_zonder_koppeling_404(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas())
    r = client.get("/now", headers=AUTH)
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "geen_koppeling"


def test_now_met_koppeling(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))

    async def nep_state(k, entity_id):
        return {"state": "1"} if entity_id.endswith("active_tariff") else {"state": "-350.5"}

    monkeypatch.setattr(main, "_ha_state", nep_state)
    assert client.get("/now", headers=AUTH).json() == {"vermogen_w": -350.5, "actief_tarief": "dal"}


def test_now_ha_onbereikbaar_502(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))

    async def weg(url, token, path):
        raise HTTPException(502, {"code": "ha_onbereikbaar", "melding": "x"})

    monkeypatch.setattr(main, "_ha_get", weg)
    r = client.get("/now", headers=AUTH)
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "ha_onbereikbaar"


def test_get_koppeling_lekt_geen_token(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))
    r = client.get("/koppeling", headers=AUTH)
    assert r.json() == {"gekoppeld": True, "ha_url": "https://ha.example.nl"}
    assert "HA-GEHEIM" not in r.text


def test_put_koppeling_slaat_entities_op(client, monkeypatch):
    nep = NepApenkaas()
    monkeypatch.setattr(main, "apenkaas", nep)
    states = [{"entity_id": f"sensor.p1_meter_abc_{s}"} for s in (
        "active_power", "active_tariff", "total_power_import_t1", "total_power_import_t2",
        "total_power_export_t1", "total_power_export_t2")]

    async def nep_get(url, token, path):
        assert path == "/api/states"
        return states

    monkeypatch.setattr(main, "_ha_get", nep_get)
    r = client.put("/koppeling", headers=AUTH, json={"ha_url": "https://ha.example.nl/", "ha_token": "t"})
    assert r.json() == {"gekoppeld": True, "ha_url": "https://ha.example.nl"}
    assert nep.opgeslagen["entities"]["active_power"] == "sensor.p1_meter_abc_active_power"
    assert nep.opgeslagen["ha_token"] == "t"


def test_put_koppeling_geen_p1_422(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas())

    async def nep_get(url, token, path):
        return [{"entity_id": "light.keuken"}]

    monkeypatch.setattr(main, "_ha_get", nep_get)
    r = client.put("/koppeling", headers=AUTH, json={"ha_url": "https://ha.example.nl", "ha_token": "t"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "geen_p1"


def test_put_koppeling_url_geweigerd(monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas())
    r = TestClient(main.app).put("/koppeling", headers=AUTH,
                                 json={"ha_url": "http://127.0.0.1:8123", "ha_token": "t"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "url_geweigerd"


def test_delete_koppeling(client, monkeypatch):
    nep = NepApenkaas(KOPPELING)
    monkeypatch.setattr(main, "apenkaas", nep)
    assert client.delete("/koppeling", headers=AUTH).json() == {"gekoppeld": False}
    assert nep.koppeling is None
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_main.py -v` → FAIL

- [ ] **Step 3: Implementatie** — vervang `backend/main.py` volledig:
```python
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

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from apenkaas import Apenkaas, ApenkaasFout, NietIngelogd
from ha_stats import HAStatsError, combine_import_export, fetch_hourly_statistics
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

app = FastAPI(title="Energie Dashboard API", version="0.2.0")
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
async def hours(days: int = 365, k: dict = Depends(koppeling_van)) -> list[dict]:
    """Uurdata {imp, exp} uit de HA recorder-statistieken van de gebruiker."""
    url = await _veilige_url(k["ha_url"])
    e = k["entities"]
    import_ids = [e["import_t1"], e["import_t2"]]
    export_ids = [e["export_t1"], e["export_t2"]]
    try:
        stats = await fetch_hourly_statistics(url, k["ha_token"], import_ids + export_ids, days)
    except HAStatsError as err:
        raise fout(502, "ha_onbereikbaar", f"Uur-statistieken ophalen mislukt: {err}")
    records = combine_import_export(stats, import_ids, export_ids)
    if not records:
        raise fout(422, "geen_uurdata", "Home Assistant heeft (nog) geen uur-statistieken voor de P1-meter")
    return records
```
Let op: `test_put_koppeling_url_geweigerd` gebruikt de echte `check_ha_url` (de fixture wordt daar bewust niet gebruikt).

- [ ] **Step 4: Run** `.venv/bin/pytest -v` → alle tests (Task 1–4) PASS

- [ ] **Step 5: Config bijwerken**

`.env.example`: vervang de blokken `--- Home Assistant ---` en `--- Tarieven ---` door:
```
# --- Apenkaas (backend) ---
APENKAAS_URL=http://192.168.178.202:3000
APENKAAS_TENANT_ID=uuid-van-tenant-energy-dash
# Niet-publieke app-key met scopes data:read + data:write. NOOIT committen.
APENKAAS_SERVER_KEY=plak-hier-de-server-key
APENKAAS_KOPPELING_COLLECTION_ID=uuid-van-collection-ha_koppeling
# Hosts/IP's die wél privé mogen zijn (bv. je eigen HA op het LAN), komma-gescheiden.
HA_PRIVE_TOEGESTAAN=

# --- Apenkaas (frontend, build-time) ---
VITE_APENKAAS_URL=http://192.168.178.202:3000
VITE_APENKAAS_TENANT_ID=uuid-van-tenant-energy-dash
VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID=uuid-van-collection-instellingen
VITE_APENKAAS_UURDATA_BUCKET_ID=uuid-van-bucket-uurdata
```
`docker-compose.yml`, backend `environment:` — vervang `HA_BASE_URL` t/m `TARIEF_TERUGLEVERING` door:
```yaml
      APENKAAS_URL: ${APENKAAS_URL}
      APENKAAS_TENANT_ID: ${APENKAAS_TENANT_ID}
      APENKAAS_SERVER_KEY: ${APENKAAS_SERVER_KEY}
      APENKAAS_KOPPELING_COLLECTION_ID: ${APENKAAS_KOPPELING_COLLECTION_ID}
      HA_PRIVE_TOEGESTAAN: ${HA_PRIVE_TOEGESTAAN:-}
```
Pas ook de headercomment van `docker-compose.yml` aan: "HA-tokens staan per gebruiker in Apenkaas; de server-key komt uit .env / Coolify secrets."

- [ ] **Step 6: Commit**
```bash
git add backend/main.py backend/tests/test_main.py .env.example docker-compose.yml
git commit -m "feat(backend): endpoints per ingelogde gebruiker met eigen HA-koppeling"
```

---

### Task 5: Frontend-inloggen

**Files:**
- Create: `frontend/src/auth.ts`, `frontend/src/auth.test.ts`, `frontend/src/routes/Login.tsx`
- Modify: `frontend/src/api.ts`, `frontend/src/main.tsx`, `frontend/src/vite-env.d.ts`, `frontend/Dockerfile`, `docker-compose.yml` (frontend build-args)

**Interfaces:**
- Produces (`auth.ts`): `APENKAAS_API: string` (`<url>/api/<tenant>`); `interface Sessie { accessToken; refreshToken; userId; email }`; `getSessie(): Sessie | null`; `useSessie(): Sessie | null` (React-hook, luistert naar event `"sessie"`); `login(email, password): Promise<void>`; `registreer(email, password): Promise<void>`; `logout(): Promise<void>`; `authFetch(url: string, init?: RequestInit): Promise<Response>`.
- Produces (`api.ts`): `class ApiFout extends Error { status: number; code: string }`; `api.now(): Promise<NowData>` met `NowData = { vermogen_w: number; actief_tarief: "dal" | "piek" }`; `api.hours(days?)`; `api.koppeling.get(): Promise<{gekoppeld: boolean; ha_url: string | null}>`, `.put(ha_url, ha_token)`, `.delete()`. `ConfigData` en `api.config` vervallen.

- [ ] **Step 1: Env-types** — `frontend/src/vite-env.d.ts`, voeg toe aan `ImportMetaEnv` (lees het bestand eerst; laat bestaande `VITE_API_BASE` staan):
```ts
  readonly VITE_APENKAAS_URL: string;
  readonly VITE_APENKAAS_TENANT_ID: string;
  readonly VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID: string;
  readonly VITE_APENKAAS_UURDATA_BUCKET_ID: string;
```

- [ ] **Step 2: Failing test** — `frontend/src/auth.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} });

const { authFetch, getSessie } = await import("./auth");

function sessie(access: string) {
  store.set("energy-dash.sessie", JSON.stringify({ accessToken: access, refreshToken: "r1", userId: "u1", email: "a@b.nl" }));
}

describe("authFetch", () => {
  beforeEach(() => store.clear());

  it("ververst één keer bij gelijktijdige 401s", async () => {
    sessie("oud");
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/refresh")) {
        refreshes++;
        return new Response(JSON.stringify({ accessToken: "nieuw", refreshToken: "r2" }), { status: 200 });
      }
      const auth = new Headers(init?.headers).get("Authorization");
      return new Response("{}", { status: auth === "Bearer nieuw" ? 200 : 401 });
    }));
    const [a, b] = await Promise.all([authFetch("/api/now"), authFetch("/api/hours")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(refreshes).toBe(1);
    expect(getSessie()?.refreshToken).toBe("r2");
  });

  it("wist de sessie als refresh mislukt", async () => {
    sessie("oud");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect((await authFetch("/api/now")).status).toBe(401);
    expect(getSessie()).toBeNull();
  });
});
```

- [ ] **Step 3: Run** `cd frontend && npx vitest run src/auth.test.ts` → FAIL (module ontbreekt)

- [ ] **Step 4: Implementatie** — `frontend/src/auth.ts`:
```ts
// auth.ts — inloggen bij Apenkaas en een fetch die het user-JWT meestuurt.
// Sessie in localStorage (blijft ingelogd na herladen, zoals Supabase).
import { useEffect, useState } from "react";

export const APENKAAS_API = `${import.meta.env.VITE_APENKAAS_URL}/api/${import.meta.env.VITE_APENKAAS_TENANT_ID}`;
const KEY = "energy-dash.sessie";

export interface Sessie { accessToken: string; refreshToken: string; userId: string; email: string }

export function getSessie(): Sessie | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}

function setSessie(s: Sessie | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("sessie"));
}

export function useSessie(): Sessie | null {
  const [s, setS] = useState(getSessie);
  useEffect(() => {
    const update = () => setS(getSessie());
    window.addEventListener("sessie", update);
    return () => window.removeEventListener("sessie", update);
  }, []);
  return s;
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${APENKAAS_API}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? `Apenkaas gaf ${r.status}`);
  return j;
}

export async function login(email: string, password: string) {
  const j = await post("/login", { email, password });
  setSessie({ accessToken: j.accessToken, refreshToken: j.refreshToken, userId: j.user.id, email: j.user.email });
}

export async function registreer(email: string, password: string) {
  await post("/register", { email, password });
  await login(email, password);
}

export async function logout() {
  const s = getSessie();
  setSessie(null);
  if (s) await post("/logout", { refreshToken: s.refreshToken }).catch(() => {});
}

let bezigMetVerversen: Promise<boolean> | null = null;

async function ververs(): Promise<boolean> {
  const s = getSessie();
  if (!s) return false;
  try {
    const j = await post("/refresh", { refreshToken: s.refreshToken });
    setSessie({ ...s, accessToken: j.accessToken, refreshToken: j.refreshToken });
    return true;
  } catch {
    setSessie(null);
    return false;
  }
}

export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const doe = () => {
    const h = new Headers(init.headers);
    const s = getSessie();
    if (s) h.set("Authorization", `Bearer ${s.accessToken}`);
    return fetch(url, { ...init, headers: h });
  };
  let r = await doe();
  if (r.status === 401 && getSessie()) {
    // Eén refresh voor alle gelijktijdige 401s: Apenkaas roteert refresh-tokens.
    bezigMetVerversen ??= ververs().finally(() => { bezigMetVerversen = null; });
    if (await bezigMetVerversen) r = await doe();
  }
  if (r.status === 401) setSessie(null);
  return r;
}
```

- [ ] **Step 5: Run** `npx vitest run src/auth.test.ts` → PASS

- [ ] **Step 6: `api.ts` vervangen**:
```ts
// api.ts — praat met de backend-proxy, nooit direct met Home Assistant.
import type { HourRecord } from "./features/accu/battery-model";
import { authFetch } from "./auth";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiFout extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, melding: string) {
    super(melding);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${BASE}${path}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFout(r.status, j.detail?.code ?? "onbekend", j.detail?.melding ?? `API ${path} → ${r.status}`);
  return j as T;
}

export interface NowData { vermogen_w: number; actief_tarief: "dal" | "piek" }
export interface KoppelingStatus { gekoppeld: boolean; ha_url: string | null }

export const api = {
  now: () => call<NowData>("/now"),
  hours: (days = 365) => call<HourRecord[]>(`/hours?days=${days}`),
  koppeling: {
    get: () => call<KoppelingStatus>("/koppeling"),
    put: (ha_url: string, ha_token: string) => call<KoppelingStatus>("/koppeling", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ha_url, ha_token }),
    }),
    delete: () => call<KoppelingStatus>("/koppeling", { method: "DELETE" }),
  },
};
```

- [ ] **Step 7: Login-scherm** — `frontend/src/routes/Login.tsx`:
```tsx
import React, { useState } from "react";
import { login, registreer } from "../auth";

const C = { bg: "#0f1419", panel: "#171e26", line: "#2a3744", ink: "#e8eef3", sub: "#8b9aa8", accent: "#f0a32a", bad: "#e8654f" };
const input = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, width: "100%", boxSizing: "border-box" as const };

export default function Login() {
  const [modus, setModus] = useState<"login" | "registreer">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault();
    setFout(null);
    setBezig(true);
    try {
      await (modus === "login" ? login(email, password) : registreer(email, password));
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "grid", placeItems: "center", padding: 16, fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <form onSubmit={verstuur} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, width: "100%", maxWidth: 360, display: "grid", gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{modus === "login" ? "Inloggen" : "Account maken"}</h1>
        <label style={{ fontSize: 13, color: C.sub }}>E-mail
          <input style={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ fontSize: 13, color: C.sub }}>Wachtwoord
          <input style={input} type="password" autoComplete={modus === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {fout && <div role="alert" style={{ color: C.bad, fontSize: 13 }}>{fout}</div>}
        <button disabled={bezig} style={{ background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "11px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          {bezig ? "Bezig…" : modus === "login" ? "Inloggen" : "Account maken"}
        </button>
        <button type="button" onClick={() => setModus(modus === "login" ? "registreer" : "login")} style={{ background: "transparent", color: C.sub, border: "none", fontSize: 13, cursor: "pointer" }}>
          {modus === "login" ? "Nog geen account? Maak er een" : "Heb je al een account? Log in"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: Guard, nav en uitloggen** in `frontend/src/main.tsx`:
  - Imports toevoegen: `import Login from "./routes/Login";`, `import Instellingen from "./routes/Instellingen";`, `import { logout, useSessie } from "./auth";`
  - In `Layout()`, als eerste regel: `const sessie = useSessie(); if (!sessie) return <Login />;`
  - In de `<nav>`, na de Advies-link:
```tsx
        <Link to="/instellingen" style={link(path.startsWith("/instellingen"))}>Instellingen</Link>
        <button onClick={() => logout()} style={{ ...link(false), marginLeft: "auto", border: "none", cursor: "pointer" }}>Uitloggen</button>
```
  - Route toevoegen aan `children`: `{ path: "instellingen", element: <Instellingen /> },`
  - Tijdelijke placeholder zodat de build slaagt — `frontend/src/routes/Instellingen.tsx`: `export default function Instellingen() { return null; }` (wordt in Task 6 volledig vervangen).

- [ ] **Step 9: Build-args** — `frontend/Dockerfile`: lees het bestand. Voeg naast de bestaande `ARG VITE_API_BASE` toe:
```dockerfile
ARG VITE_APENKAAS_URL
ARG VITE_APENKAAS_TENANT_ID
ARG VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID
ARG VITE_APENKAAS_UURDATA_BUCKET_ID
ENV VITE_APENKAAS_URL=$VITE_APENKAAS_URL VITE_APENKAAS_TENANT_ID=$VITE_APENKAAS_TENANT_ID VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID=$VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID VITE_APENKAAS_UURDATA_BUCKET_ID=$VITE_APENKAAS_UURDATA_BUCKET_ID
```
(Volg het patroon waarmee `VITE_API_BASE` daar al doorgegeven wordt, als dat afwijkt.) `docker-compose.yml`, frontend `build.args`, toevoegen:
```yaml
        VITE_APENKAAS_URL: ${VITE_APENKAAS_URL}
        VITE_APENKAAS_TENANT_ID: ${VITE_APENKAAS_TENANT_ID}
        VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID: ${VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID}
        VITE_APENKAAS_UURDATA_BUCKET_ID: ${VITE_APENKAAS_UURDATA_BUCKET_ID}
```

- [ ] **Step 10: Build + tests** — `cd frontend && npm test && npm run build`. Verwacht: tests groen. `tsc` faalt op `Overzicht.tsx` (`prijs_kwh`) en `Advies.tsx` (`api.config`); die worden in Task 6/7 opgelost. Maak de build nu al groen met de kleinste tijdelijke wijzigingen: in `Advies.tsx` de `api.config()`-regel en de `cfg`-state verwijderen (`pi`/`pf` vallen terug op hun defaults), en in `Overzicht.tsx` de "Prijs nu"-kaart tijdelijk weghalen. `npm run build` → slaagt.

- [ ] **Step 11: Commit**
```bash
git add frontend docker-compose.yml
git commit -m "feat(frontend): inloggen bij Apenkaas, JWT naar backend met automatische refresh"
```

---

### Task 6: Instellingen (tarieven + HA koppelen) en Overzicht

**Files:**
- Create: `frontend/src/instellingen.ts`, `frontend/src/instellingen.test.ts`
- Modify: `frontend/src/routes/Instellingen.tsx` (placeholder vervangen), `frontend/src/routes/Overzicht.tsx`

**Interfaces:**
- Consumes: `APENKAAS_API`, `authFetch` (Task 5); `api.koppeling.*`, `api.now`, `ApiFout` (Task 5).
- Produces:
```ts
export interface AdviesWaarden {
  priceImport: number; priceFeedIn: number; exportYear: number; importYear: number;
  capacity: number; roundTrip: number; shiftPct: number; saldering: "nu" | "af2027";
  accuPrijs: number; levensduur: number;
}
export interface Instellingen {
  tarief_piek: number; tarief_dal: number; tarief_teruglevering: number;
  advies: Partial<AdviesWaarden>;
}
export const STANDAARD: Instellingen;
export function laadInstellingen(): Promise<{ id: string; data: Instellingen }>;
export function bewaarInstellingen(id: string, data: Instellingen): Promise<void>;
```

- [ ] **Step 1: Failing test** — `frontend/src/instellingen.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ APENKAAS_API: "http://ak/api/t", authFetch: (u: string, i?: RequestInit) => fetch(u, i) }));
const { laadInstellingen, STANDAARD } = await import("./instellingen");

describe("laadInstellingen", () => {
  it("maakt één document bij gelijktijdige aanroepen", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        return new Response(JSON.stringify({ id: "d1", data: STANDAARD }), { status: 200 });
      }
      return new Response(JSON.stringify({ documents: [], count: 0 }), { status: 200 });
    }));
    const [a, b] = await Promise.all([laadInstellingen(), laadInstellingen()]);
    expect(posts).toBe(1);
    expect(a.id).toBe("d1");
    expect(b.id).toBe("d1");
  });

  it("vult ontbrekende velden aan met standaardwaarden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ documents: [{ id: "d2", data: { tarief_piek: 0.3 } }] }), { status: 200 })));
    const { data } = await laadInstellingen();
    expect(data.tarief_piek).toBe(0.3);
    expect(data.tarief_dal).toBe(STANDAARD.tarief_dal);
    expect(data.advies).toEqual({});
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/instellingen.test.ts` → FAIL

- [ ] **Step 3: Implementatie** — `frontend/src/instellingen.ts`:
```ts
// instellingen.ts — één Apenkaas-document per gebruiker met tarieven en
// schuifjes. Alleen die gebruiker mag het lezen/schrijven (standaard user:<id>).
import { APENKAAS_API, authFetch } from "./auth";

export interface AdviesWaarden {
  priceImport: number; priceFeedIn: number; exportYear: number; importYear: number;
  capacity: number; roundTrip: number; shiftPct: number; saldering: "nu" | "af2027";
  accuPrijs: number; levensduur: number;
}
export interface Instellingen {
  tarief_piek: number; tarief_dal: number; tarief_teruglevering: number;
  advies: Partial<AdviesWaarden>;
}

export const STANDAARD: Instellingen = { tarief_piek: 0.25439, tarief_dal: 0.233699, tarief_teruglevering: 0.06, advies: {} };

const DOCS = `${APENKAAS_API}/collections/${import.meta.env.VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID}/documents`;
const JSON_HEADERS = { "Content-Type": "application/json" };

async function ok(r: Response) {
  if (!r.ok) throw new Error(`Apenkaas gaf ${r.status} bij instellingen`);
  return r.json();
}

async function laad(): Promise<{ id: string; data: Instellingen }> {
  const lijst = await ok(await authFetch(`${DOCS}?limit=1`));
  const doc = lijst.documents[0];
  if (doc) return { id: doc.id, data: { ...STANDAARD, ...doc.data } };
  const nieuw = await ok(await authFetch(DOCS, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ data: STANDAARD }) }));
  return { id: nieuw.id, data: STANDAARD };
}

// Gelijktijdige aanroepen (StrictMode draait effects dubbel) delen één verzoek,
// anders ontstaan bij de eerste login twee documenten.
let bezig: Promise<{ id: string; data: Instellingen }> | null = null;
export function laadInstellingen() {
  bezig ??= laad().finally(() => { bezig = null; });
  return bezig;
}

export async function bewaarInstellingen(id: string, data: Instellingen): Promise<void> {
  await ok(await authFetch(`${DOCS}/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ data }) }));
}
```

- [ ] **Step 4: Run** `npx vitest run src/instellingen.test.ts` → PASS

- [ ] **Step 5: Instellingen-pagina** — vervang `frontend/src/routes/Instellingen.tsx`:
```tsx
import React, { useEffect, useState } from "react";
import { api, ApiFout, KoppelingStatus } from "../api";
import { bewaarInstellingen, Instellingen as Inst, laadInstellingen } from "../instellingen";

const C = { bg: "#0f1419", panel: "#171e26", line: "#2a3744", ink: "#e8eef3", sub: "#8b9aa8", accent: "#f0a32a", good: "#3ec46d", bad: "#e8654f" };
const input = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, width: "100%", boxSizing: "border-box" as const };
const knop = { background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const paneel = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, marginBottom: 20, display: "grid", gap: 14 };
const melding = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Instellingen() {
  const [doc, setDoc] = useState<{ id: string; data: Inst } | null>(null);
  const [tarievenStatus, setTarievenStatus] = useState<string | null>(null);
  const [koppeling, setKoppeling] = useState<KoppelingStatus | null>(null);
  const [haUrl, setHaUrl] = useState("");
  const [haToken, setHaToken] = useState("");
  const [koppelStatus, setKoppelStatus] = useState<{ ok: boolean; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    laadInstellingen().then(setDoc).catch((e) => setTarievenStatus(melding(e)));
    api.koppeling.get().then(setKoppeling).catch((e) => setKoppelStatus({ ok: false, tekst: melding(e) }));
  }, []);

  const zetTarief = (key: "tarief_piek" | "tarief_dal" | "tarief_teruglevering", v: string) =>
    doc && setDoc({ ...doc, data: { ...doc.data, [key]: Number(v) } });

  const bewaarTarieven = async () => {
    if (!doc) return;
    try { await bewaarInstellingen(doc.id, doc.data); setTarievenStatus("Opgeslagen ✓"); }
    catch (e) { setTarievenStatus(melding(e)); }
  };

  const koppel = async (e: React.FormEvent) => {
    e.preventDefault();
    setBezig(true);
    setKoppelStatus(null);
    try {
      setKoppeling(await api.koppeling.put(haUrl, haToken));
      setHaToken("");
      setKoppelStatus({ ok: true, tekst: "Verbinding gelukt, P1-meter gevonden ✓" });
    } catch (err) {
      setKoppelStatus({ ok: false, tekst: err instanceof ApiFout ? err.message : melding(err) });
    } finally {
      setBezig(false);
    }
  };

  const ontkoppel = async () => {
    try { setKoppeling(await api.koppeling.delete()); setKoppelStatus(null); }
    catch (e) { setKoppelStatus({ ok: false, tekst: melding(e) }); }
  };

  return (
    <div style={{ background: C.bg, minHeight: "100%", padding: "32px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 24px" }}>Instellingen</h1>

        <section style={paneel}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Tarieven (€/kWh)</h2>
          {doc && (["tarief_piek", "tarief_dal", "tarief_teruglevering"] as const).map((k) => (
            <label key={k} style={{ fontSize: 13, color: C.sub }}>
              {{ tarief_piek: "Piek", tarief_dal: "Dal", tarief_teruglevering: "Teruglevering" }[k]}
              <input style={input} type="number" step="0.0001" min="0" value={doc.data[k]} onChange={(e) => zetTarief(k, e.target.value)} />
            </label>
          ))}
          <div><button style={knop} onClick={bewaarTarieven} disabled={!doc}>Opslaan</button></div>
          {tarievenStatus && <div style={{ fontSize: 13, color: C.sub }}>{tarievenStatus}</div>}
        </section>

        <section style={paneel}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Home Assistant</h2>
          {koppeling?.gekoppeld ? (
            <>
              <div style={{ fontSize: 14 }}>Gekoppeld met <b>{koppeling.ha_url}</b></div>
              <div><button style={{ ...knop, background: "transparent", color: C.sub, border: `1px solid ${C.line}` }} onClick={ontkoppel}>Ontkoppelen</button></div>
            </>
          ) : (
            <form onSubmit={koppel} style={{ display: "grid", gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
                Vul een adres in dat vanaf internet bereikbaar is (bv. je Nabu Casa-URL) en een
                langlevend toegangstoken (HA → profiel → Beveiliging). Geen Home Assistant? Vul dan bij
                Advies je jaartotalen in of laad een CSV — die worden bewaard.
              </p>
              <label style={{ fontSize: 13, color: C.sub }}>Adres
                <input style={input} type="url" required placeholder="https://jouw-ha.ui.nabu.casa" value={haUrl} onChange={(e) => setHaUrl(e.target.value)} />
              </label>
              <label style={{ fontSize: 13, color: C.sub }}>Token
                <input style={input} type="password" required autoComplete="off" value={haToken} onChange={(e) => setHaToken(e.target.value)} />
              </label>
              <div><button style={knop} disabled={bezig}>{bezig ? "Verbinden…" : "Koppelen"}</button></div>
            </form>
          )}
          {koppelStatus && <div role="status" style={{ fontSize: 13, color: koppelStatus.ok ? C.good : C.bad }}>{koppelStatus.tekst}</div>}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Overzicht met eigen tarieven** — in `frontend/src/routes/Overzicht.tsx`:
  - Imports: `import { Link } from "react-router-dom";`, `import { api, ApiFout, NowData } from "../api";`, `import { Instellingen, laadInstellingen, STANDAARD } from "../instellingen";`
  - State: `const [tar, setTar] = useState<Instellingen>(STANDAARD);` en `const [geenKoppeling, setGeenKoppeling] = useState(false);`
  - Vervang de `load`-regel in het effect door:
```tsx
    laadInstellingen().then((d) => setTar(d.data)).catch(() => {});
    const load = () => api.now().then((n) => { setNow(n); setErr(null); }).catch((e) => {
      if (e instanceof ApiFout && e.code === "geen_koppeling") setGeenKoppeling(true);
      else setErr(e instanceof Error ? e.message : String(e));
    });
```
  - Voeg na `const teruglevert = …` toe: `const prijs = now ? (now.actief_tarief === "dal" ? tar.tarief_dal : tar.tarief_piek) : 0;`
  - Vervang de foutkaart-tekst door `{err}` (de oude HA_BASE_URL-hint klopt niet meer), en voeg ernaast toe:
```tsx
        {geenKoppeling && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, color: C.sub, fontSize: 14 }}>
            Nog geen Home Assistant gekoppeld. <Link to="/instellingen" style={{ color: C.accent }}>Koppel je HA</Link> voor live data,
            of bekijk <Link to="/advies" style={{ color: C.accent }}>Advies</Link> op basis van je jaartotalen.
          </div>
        )}
```
  - Zet de "Prijs nu"-kaart terug met `value={euro(prijs)}`.
  - Pas de conditie `{!now && !err && …Laden…}` aan naar `{!now && !err && !geenKoppeling && …}`.

- [ ] **Step 7: Build + tests** — `npm test && npm run build` → groen.

- [ ] **Step 8: Commit**
```bash
git add frontend/src
git commit -m "feat(frontend): instellingen-pagina (tarieven, HA koppelen) en overzicht met eigen tarieven"
```

---

### Task 7: Advies — schuifjes en CSV bewaren

**Files:**
- Create: `frontend/src/uurdata.ts`
- Modify: `frontend/src/routes/Advies.tsx`, `frontend/src/features/accu/AccuSimulatie.tsx`, `frontend/src/features/saldering/SalderingImpact.tsx`

**Interfaces:**
- Consumes: `laadInstellingen`, `bewaarInstellingen`, `AdviesWaarden`, `Instellingen` (Task 6); `APENKAAS_API`, `authFetch` (Task 5); `parseHourCsv` (bestaand).
- Produces: `laadCsv(): Promise<string | null>`, `bewaarCsv(text: string | null): Promise<void>`. Beide componenten krijgen extra optionele props:
```ts
  initial?: Partial<AdviesWaarden>;
  onChange?: (w: Partial<AdviesWaarden>) => void;
  initialCsvHours?: HourRecord[] | null;
  onCsv?: (text: string | null) => void;
```

- [ ] **Step 1: `uurdata.ts`**:
```ts
// uurdata.ts — de geüploade CSV per gebruiker in Apenkaas-storage (bucket uurdata).
// Upload gaat via een presigned POST rechtstreeks naar MinIO; per gebruiker één bestand.
import { APENKAAS_API, authFetch } from "./auth";

const BUCKET = import.meta.env.VITE_APENKAAS_UURDATA_BUCKET_ID;

interface Bestand { id: string; aangemaakt_op: string }

async function lijst(): Promise<Bestand[]> {
  const r = await authFetch(`${APENKAAS_API}/storage/buckets/${BUCKET}/files`);
  if (!r.ok) throw new Error(`Apenkaas gaf ${r.status} bij uurdata`);
  return r.json();
}

export async function laadCsv(): Promise<string | null> {
  const nieuwste = (await lijst()).sort((a, b) => b.aangemaakt_op.localeCompare(a.aangemaakt_op))[0];
  if (!nieuwste) return null;
  const r = await authFetch(`${APENKAAS_API}/storage/files/${nieuwste.id}/download`);
  if (!r.ok) return null;
  const { downloadUrl } = await r.json();
  const bestand = await fetch(downloadUrl);
  return bestand.ok ? bestand.text() : null;
}

export async function bewaarCsv(text: string | null): Promise<void> {
  for (const f of await lijst()) {
    await authFetch(`${APENKAAS_API}/storage/files/${f.id}`, { method: "DELETE" });
  }
  if (text === null) return;
  const blob = new Blob([text], { type: "text/csv" });
  const r = await authFetch(`${APENKAAS_API}/storage/buckets/${BUCKET}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bestandsnaam: "uurdata.csv", mimeType: "text/csv", grootte: blob.size }),
  });
  if (!r.ok) throw new Error(`CSV opslaan mislukt (${r.status})`);
  const { uploadUrl, fields } = await r.json();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields as Record<string, string>)) form.append(k, v);
  form.append("file", blob);
  const up = await fetch(uploadUrl, { method: "POST", body: form });
  if (!up.ok) throw new Error(`CSV uploaden mislukt (${up.status})`);
}
```

- [ ] **Step 2: `AccuSimulatie.tsx`** — voeg `useEffect` toe aan de React-import en `import type { AdviesWaarden } from "../../instellingen";`. Voeg de vier props hierboven toe aan `AccuSimulatieProps` en aan de destructuring. Vervang de state-initialisatie:
```tsx
  const [priceImport, setPriceImport] = useState(initial?.priceImport ?? defaultPriceImport);
  const [priceFeedIn, setPriceFeedIn] = useState(initial?.priceFeedIn ?? defaultPriceFeedIn);
  const [saldering, setSaldering] = useState<"nu" | "af2027">(initial?.saldering ?? "af2027");
  const [exportYear, setExportYear] = useState(initial?.exportYear ?? 4500);
  const [importYear, setImportYear] = useState(initial?.importYear ?? 3500);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 10);
  const [roundTrip, setRoundTrip] = useState(initial?.roundTrip ?? 90);
  const [price, setPrice] = useState(initial?.accuPrijs ?? 4500);
  const [lifespan, setLifespan] = useState(initial?.levensduur ?? 12);
  const [csvHours, setCsvHours] = useState<HourRecord[] | null>(initialCsvHours ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange?.({ priceImport, priceFeedIn, saldering, exportYear, importYear, capacity, roundTrip, accuPrijs: price, levensduur: lifespan });
  }, [priceImport, priceFeedIn, saldering, exportYear, importYear, capacity, roundTrip, price, lifespan]);
```
In `handleFile`: na `setCsvHours(parsed);` toevoegen `onCsv?.(String(reader.result));`. De "Terug"-knop (regel ~129): `onClick={() => { setCsvHours(null); onCsv?.(null); }}`.

- [ ] **Step 3: `SalderingImpact.tsx`** — zelfde imports en props. Vervang de state-initialisatie:
```tsx
  const [priceImport, setPriceImport] = useState(initial?.priceImport ?? defaultPriceImport);
  const [priceFeedIn, setPriceFeedIn] = useState(initial?.priceFeedIn ?? defaultPriceFeedIn);
  const [exportYear, setExportYear] = useState(initial?.exportYear ?? 4500);
  const [importYear, setImportYear] = useState(initial?.importYear ?? 3500);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 10);
  const [roundTrip, setRoundTrip] = useState(initial?.roundTrip ?? 90);
  const [shiftPct, setShiftPct] = useState(initial?.shiftPct ?? 20);
  const [csvHours, setCsvHours] = useState<HourRecord[] | null>(initialCsvHours ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange?.({ priceImport, priceFeedIn, exportYear, importYear, capacity, roundTrip, shiftPct });
  }, [priceImport, priceFeedIn, exportYear, importYear, capacity, roundTrip, shiftPct]);
```
In `handleFile`: na `setCsvHours(parsed);` toevoegen `onCsv?.(String(reader.result));`. De knop "Terug naar schatting" (regel ~199): `onClick={() => { setCsvHours(null); onCsv?.(null); }}`.

- [ ] **Step 4: `Advies.tsx` vervangen**:
```tsx
import React, { useEffect, useRef, useState } from "react";
import AccuSimulatie from "../features/accu/AccuSimulatie";
import SalderingImpact from "../features/saldering/SalderingImpact";
import { HourRecord, parseHourCsv } from "../features/accu/battery-model";
import { api } from "../api";
import { AdviesWaarden, bewaarInstellingen, Instellingen, laadInstellingen } from "../instellingen";
import { bewaarCsv, laadCsv } from "../uurdata";

// Advies-dashboard. Laadt eerst de instellingen en een eventueel bewaarde CSV,
// zodat de schuifjes met de bewaarde waarden starten. Wijzigingen worden ~1 s
// na de laatste beweging opgeslagen.
const BEWAAR_VERTRAGING_MS = 1000;

export default function Advies() {
  const [hours, setHours] = useState<HourRecord[] | undefined>(undefined);
  const [doc, setDoc] = useState<{ id: string; data: Instellingen } | null>(null);
  const [csvHours, setCsvHours] = useState<HourRecord[] | null>(null);
  const [klaar, setKlaar] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [tab, setTab] = useState<"saldering" | "accu">("saldering");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    api.hours(365).then((h) => { if (Array.isArray(h) && h.length > 24) setHours(h); }).catch(() => {
      // geen koppeling of HA onbereikbaar → schatting/CSV-modus
    });
    Promise.all([
      laadInstellingen().then(setDoc).catch(() => setMelding("Instellingen konden niet geladen worden; wijzigingen worden niet bewaard.")),
      laadCsv().then((t) => t && setCsvHours(parseHourCsv(t))).catch(() => {}),
    ]).finally(() => setKlaar(true));
    return () => clearTimeout(timer.current);
  }, []);

  const onChange = (w: Partial<AdviesWaarden>) => {
    const huidig = docRef.current;
    if (!huidig) return;
    const volgende = { ...huidig, data: { ...huidig.data, advies: { ...huidig.data.advies, ...w } } };
    setDoc(volgende);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      bewaarInstellingen(volgende.id, volgende.data).catch(() => setMelding("Opslaan mislukt — probeer het later opnieuw."));
    }, BEWAAR_VERTRAGING_MS);
  };

  const onCsv = (text: string | null) => {
    setCsvHours(text ? parseHourCsv(text) : null);
    bewaarCsv(text).catch((e) => setMelding(e instanceof Error ? e.message : String(e)));
  };

  const tabBtn = (active: boolean) => ({
    background: active ? "#171e26" : "transparent",
    color: active ? "#f0a32a" : "#8b9aa8",
    border: "1px solid " + (active ? "#f0a32a55" : "#2a3744"),
    borderRadius: 10, padding: "8px 16px", cursor: "pointer",
    fontWeight: 600, fontSize: 13.5, fontFamily: "'Inter', system-ui, sans-serif",
  });

  if (!klaar) return <div style={{ padding: 32, color: "#5d6b78", background: "#0f1419" }}>Laden…</div>;

  const props = {
    liveHours: hours,
    liveHoursSpan: hours?.length,
    defaultPriceImport: doc?.data.tarief_piek ?? 0.2544,
    defaultPriceFeedIn: doc?.data.tarief_teruglevering ?? 0.06,
    initial: doc?.data.advies,
    onChange,
    initialCsvHours: csvHours,
    onCsv,
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: "16px 20px 0", background: "#0f1419", alignItems: "center" }}>
        <button style={tabBtn(tab === "saldering")} onClick={() => setTab("saldering")}>Salderingsstop 2027</button>
        <button style={tabBtn(tab === "accu")} onClick={() => setTab("accu")}>Accu-analyse</button>
        {melding && <span role="status" style={{ color: "#e8654f", fontSize: 13, marginLeft: 12 }}>{melding}</span>}
      </div>
      {tab === "saldering" ? <SalderingImpact {...props} /> : <AccuSimulatie {...props} />}
    </div>
  );
}
```
Waarom `docRef`: beide componenten roepen `onChange` aan vanuit een effect met een oude closure; via de ref wordt altijd op de laatste versie verder gebouwd.

- [ ] **Step 5: Build + tests** — `npm test && npm run build` → groen.

- [ ] **Step 6: Commit**
```bash
git add frontend/src
git commit -m "feat(frontend): schuifjes en CSV per gebruiker bewaren in Apenkaas"
```

---

### Task 8: Apenkaas inrichten, docs en end-to-end test

**Files:**
- Modify: `README.md` (architectuur + setup), `deploy/README.md`

- [ ] **Step 1: Apenkaas inrichten** (console op `http://192.168.178.202:3000/console`, samen met Eelko):
  1. Tenant **energy-dash** aanmaken, registratie **aan**. Noteer het tenant-id.
  2. App **energy-dash-server**: niet-publiek, scopes `data:read`, `data:write`. Noteer de key (wordt één keer getoond).
  3. Collection **instellingen**: geen verplichte velden, create-regel `users`. Noteer het id.
  4. Collection **ha_koppeling**: create-regel leeg (alleen de server maakt aan). Noteer het id.
  5. Bucket **uurdata**: create-regel `users`, max 5 MB, mimetypes `text/csv`. Noteer het id.
  6. Vul `.env` in (lokaal, niet committen) volgens `.env.example`; `HA_PRIVE_TOEGESTAAN` = LAN-IP van Eelko's HA.

- [ ] **Step 2: Docs** — `README.md`: vervang het architectuurdiagram door het diagram uit de spec (sectie "Gekozen aanpak") en de regel "Het HA-token staat uitsluitend serverside (env/secret)" door "HA-tokens staan per gebruiker in Apenkaas (collection `ha_koppeling`, alleen leesbaar met de server-key) en komen nooit in de browser." `deploy/README.md`: vervang de secties "Long-lived token" en het HA-deel van "Coolify" door de Apenkaas-inrichting uit Step 1, en noem `HA_PRIVE_TOEGESTAAN` bij "Home Assistant bereikbaar maken".

- [ ] **Step 3: Alles draaien** — `docker compose up --build`; open `http://localhost:8080`.

- [ ] **Step 4: End-to-end handmatig (browser)**, elk punt afvinken:
  1. Inlogscherm verschijnt; account A registreren → Overzicht toont "Nog geen Home Assistant gekoppeld".
  2. Instellingen: `http://127.0.0.1:8123` koppelen → melding "Dit adres is niet toegestaan".
  3. Eelko's HA (LAN-IP, in allowlist) + token koppelen → "Verbinding gelukt".
  4. Overzicht: live vermogen, tarief en prijs uit de eigen tarieven. DevTools → Network: geen HA-token in enig antwoord.
  5. Advies: schuifje verplaatsen, 2 s wachten, herladen → waarde bewaard.
  6. Uitloggen → inlogscherm; opnieuw inloggen → alles terug.
  7. Account B registreren (ander browserprofiel): Overzicht zonder koppeling; Advies → CSV laden → herladen → CSV nog steeds ingeladen ("geüploade CSV ✓").
  8. Met B's access-token (DevTools → localStorage `energy-dash.sessie`) handmatig `GET /api/koppeling` → `gekoppeld: false`: ziet A's koppeling niet.
  9. In de Apenkaas-console: de documenten van A en B hebben `user:<id>`-permissies; `ha_koppeling` heeft `app`/`app`.

- [ ] **Step 5: Tests nogmaals** — `cd backend && .venv/bin/pytest -v` en `cd frontend && npm test && npm run build` → alles groen.

- [ ] **Step 6: Commit**
```bash
git add README.md deploy/README.md
git commit -m "docs: Apenkaas-inrichting en nieuwe architectuur"
```
