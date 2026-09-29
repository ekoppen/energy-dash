import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from ha_url import VeiligDoel
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
    monkeypatch.setattr(main, "check_ha_url", lambda url, allow: VeiligDoel(url.rstrip("/"), None))
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
