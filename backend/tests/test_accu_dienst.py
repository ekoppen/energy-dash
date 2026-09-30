import asyncio
import math
from datetime import date, datetime, timedelta, timezone

import pytest

from accu_dienst import AccuDienst

UUR = 3_600_000
K = {"ha_token": "t"}


class Klok:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


def dienst(inst=None, uren=None, vermogen=-2000, klok=None):
    tellers = {"nu": 0, "uren": 0, "inst": 0}
    start = datetime(2026, 9, 29, tzinfo=timezone.utc)
    uren = uren if uren is not None else [
        {"start_ms": int(start.timestamp() * 1000) + i * UUR, "imp": 0.0, "exp": 1.0, "imp_dal": 0.0} for i in range(3)]

    async def lees(uid):
        tellers["inst"] += 1
        return {"tarief_piek": 0.25, "tarief_dal": 0.2, "tarief_teruglevering": 0.06,
                "virtuele_accu": inst if inst is not None else {"startdatum": "2026-09-29", "capaciteit_kwh": 10}}

    async def nu(k):
        tellers["nu"] += 1
        return {"vermogen_w": vermogen, "actief_tarief": "piek"}

    async def haal(k, days):
        tellers["uren"] += 1
        return uren

    klok = klok or Klok(datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc).timestamp())
    return AccuDienst(lees, nu, haal, klok=klok), tellers, klok


def test_signaal_met_accu():
    d, _, _ = dienst()
    s = asyncio.run(d.nu("u1", K))
    assert s["signaal"] == "accu_laadt" and s["vermogen_w"] == -2000 and s["tarief"] == "piek"
    assert s["accu"]["laadstatus_kwh"] == round(3 * math.sqrt(0.9), 2)
    assert s["accu"]["status"] == "laden"
    assert s["accu"]["stand_om"] is not None
    assert set(s["accu"]["opbrengst_sinds_start_eur"]) == {"met_saldering", "zonder_saldering"}


def test_zonder_startdatum_geen_accublok():
    d, tellers, _ = dienst(inst={})
    s = asyncio.run(d.nu("u1", K))
    assert "accu" not in s and s["signaal"] == "goed_moment"
    assert tellers["uren"] == 0


def test_caches():
    d, tellers, klok = dienst()
    asyncio.run(d.nu("u1", K))
    asyncio.run(d.nu("u1", K))
    assert tellers == {"nu": 1, "uren": 1, "inst": 1}
    klok.t += 11
    asyncio.run(d.nu("u1", K))
    assert tellers["nu"] == 2 and tellers["uren"] == 1
    klok.t += 3900  # voorbij het volgende hele uur + 5 min HA-vertraging
    asyncio.run(d.nu("u1", K))
    assert tellers["uren"] == 2 and tellers["inst"] == 2


def test_geen_uurdata_geeft_lege_accu():
    d, _, _ = dienst(uren=[])
    s = asyncio.run(d.nu("u1", K))
    assert s["accu"]["laadstatus_pct"] == 0 and s["accu"]["stand_om"] is None


def test_startdatum_in_toekomst_en_te_ver_terug():
    d, _, _ = dienst(inst={"startdatum": "2099-01-01"})
    assert asyncio.run(d.nu("u1", K))["accu"]["laadstatus_pct"] == 0
    gevraagd = []
    d2, _, _ = dienst(inst={"startdatum": "2020-01-01"})

    async def haal(k, days):
        gevraagd.append(days)
        return []
    d2._haal_uren = haal
    asyncio.run(d2.nu("u1", K))
    assert gevraagd == [730]


def test_volledig_bevat_dagen_en_totaal():
    d, _, _ = dienst()
    v = asyncio.run(d.volledig("u1", K))
    assert v["instellingen"]["capaciteit_kwh"] == 10
    assert v["dagen"][0]["datum"] == "2026-09-29"
    assert v["totaal"]["minder_teruggeleverd_kwh"] == pytest.approx(3)
