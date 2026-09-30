import asyncio

import main
from display_sleutel import nieuwe_sleutel, sleutel_id
from tests.test_main import AUTH, NepApenkaas, client  # noqa: F401


def test_sleutel_formaat_en_hash():
    s = nieuwe_sleutel()
    assert s.startswith("ed_") and len(s) > 40
    assert sleutel_id(s) == sleutel_id(s) and sleutel_id(s) != s and len(sleutel_id(s)) == 64


def test_aanmaken_slaat_alleen_hash_op_en_vervangen_trekt_oude_in(client, monkeypatch):
    nep = NepApenkaas()
    monkeypatch.setattr(main, "apenkaas", nep)
    monkeypatch.setattr(main.settings, "apenkaas_display_collection_id", "disp")

    eerste = client.post("/display-sleutel", headers=AUTH).json()["sleutel"]
    assert list(nep.docs["disp"]) == [sleutel_id(eerste)]
    assert eerste not in str(nep.docs)
    assert client.get("/display-sleutel", headers=AUTH).json() == {"actief": True}

    tweede = client.post("/display-sleutel", headers=AUTH).json()["sleutel"]
    assert list(nep.docs["disp"]) == [sleutel_id(tweede)]
    assert asyncio.run(main.gebruiker_van_sleutel(eerste)) is None
    assert asyncio.run(main.gebruiker_van_sleutel(tweede)) == "u1"

    assert client.delete("/display-sleutel", headers=AUTH).json() == {"actief": False}
    assert nep.docs["disp"] == {}


def test_onbekende_of_lege_sleutel(monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas())
    monkeypatch.setattr(main.settings, "apenkaas_display_collection_id", "disp")
    assert asyncio.run(main.gebruiker_van_sleutel("ed_bestaatniet")) is None
    assert asyncio.run(main.gebruiker_van_sleutel(None)) is None
    assert asyncio.run(main.gebruiker_van_sleutel("")) is None


def test_display_sleutel_routes_vereisen_inlog(client):
    assert client.post("/display-sleutel").status_code == 401
