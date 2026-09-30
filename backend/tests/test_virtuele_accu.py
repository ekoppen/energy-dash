import json
from datetime import date
from pathlib import Path

import pytest

from virtuele_accu import (
    AccuInstellingen, Tarieven, accu_instellingen, accu_nu, dagen, gemiddeld_inkooptarief,
    rekening, signaal, simuleer, totaal,
)

GEVALLEN = json.loads((Path(__file__).parents[2] / "testdata" / "accu-gevallen.json").read_text())
T = Tarieven(piek=0.25, dal=0.20, teruglevering=0.06, terugleverkosten=0.10)
UUR = 3_600_000


def inst(cap=10.0, rend=100.0, max_kw=float("inf")):
    return AccuInstellingen(startdatum=date(2026, 6, 1), capaciteit_kwh=cap, rendement_pct=rend,
                            max_vermogen_kw=max_kw, drempel_w=300)


def recs(uren, start=1_780_000_000_000):
    return [{"start_ms": start + i * UUR, "imp_dal": 0.0, **u} for i, u in enumerate(uren)]


@pytest.mark.parametrize("geval", GEVALLEN, ids=lambda g: g["naam"])
def test_gelijk_aan_browser_simulatie(geval):
    uren = simuleer(recs(geval["uren"]), inst(geval["capaciteit"], geval["rendement"] * 100))
    assert sum(u.ontladen_kwh for u in uren) == pytest.approx(geval["verschoven"])


def test_max_vermogen_begrenst_per_uur():
    uren = simuleer(recs([{"imp": 0, "exp": 5}, {"imp": 5, "exp": 0}]), inst(max_kw=2))
    assert uren[0].geladen_kwh == pytest.approx(2)
    assert uren[1].ontladen_kwh == pytest.approx(2)


def test_start_leeg_en_nooit_boven_capaciteit():
    uren = simuleer(recs([{"imp": 1, "exp": 0}, {"imp": 0, "exp": 50}]), inst(cap=5))
    assert uren[0].ontladen_kwh == 0
    assert uren[1].soc_kwh == pytest.approx(5)


def test_ongeldige_instellingen_vallen_terug_op_standaard():
    i = accu_instellingen({"startdatum": "2026-06-01", "capaciteit_kwh": 0, "rendement_pct": 0,
                           "max_vermogen_kw": -1, "drempel_w": "x"})
    assert (i.capaciteit_kwh, i.rendement_pct, i.max_vermogen_kw, i.drempel_w) == (10, 90, 2.5, 300)
    assert i.startdatum == date(2026, 6, 1)
    assert accu_instellingen(None).startdatum is None
    assert accu_instellingen({"startdatum": "geen datum"}).startdatum is None


def test_gewogen_inkooptarief():
    r = [{"start_ms": 0, "imp": 3, "exp": 0, "imp_dal": 3}, {"start_ms": UUR, "imp": 1, "exp": 0, "imp_dal": 0}]
    assert gemiddeld_inkooptarief(r, T) == pytest.approx(0.75 * 0.20 + 0.25 * 0.25)


def test_rekening_met_en_zonder_saldering():
    # 1000 import, 1500 export, prijs 0.25
    assert rekening(1000, 1500, 0.25, T, saldering=True) == pytest.approx(
        1000 * 0.25 - (1000 * 0.25 + 500 * 0.06 - 1500 * 0.10))
    assert rekening(1000, 1500, 0.25, T, saldering=False) == pytest.approx(
        1000 * 0.25 - (1500 * 0.06 - 1500 * 0.10))


def test_dagopbrengst_telt_op_tot_totaal_zonder_saldering():
    # twee dagen vanaf 1 juni 00:00 Nederlandse tijd (= 31 mei 22:00 UTC)
    r = recs([{"imp": 0, "exp": 4}, {"imp": 3, "exp": 0}] * 24, start=1_780_264_800_000)
    i = inst(cap=5, rend=90)
    u = simuleer(r, i)
    d = dagen(r, u, i, T)
    tot = totaal(r, u, i, T)
    assert round(sum(x["opbrengst_eur"] for x in d), 2) == tot["zonder_saldering"]
    assert tot["minder_ingekocht_kwh"] == pytest.approx(sum(x.ontladen_kwh for x in u))
    assert tot["cycli"] == pytest.approx(tot["minder_ingekocht_kwh"] / 5)


def test_dagen_groeperen_in_nederlandse_tijd():
    # 2026-06-01 22:30 UTC = 2 juni 00:30 in Amsterdam
    r = [{"start_ms": 1_780_353_000_000, "imp": 0, "exp": 1, "imp_dal": 0}]
    d = dagen(r, simuleer(r, inst()), inst(), T)
    assert d[0]["datum"] == "2026-06-02"


def test_accu_nu():
    i = inst(cap=10, max_kw=2.5)
    assert accu_nu(5, i, -1800) == {"status": "laden", "vermogen_w": 1800}
    assert accu_nu(5, i, -4000) == {"status": "laden", "vermogen_w": 2500}
    assert accu_nu(10, i, -1800) == {"status": "vol", "vermogen_w": 0}
    assert accu_nu(5, i, 900) == {"status": "ontladen", "vermogen_w": 900}
    assert accu_nu(0, i, 900) == {"status": "leeg", "vermogen_w": 0}
    assert accu_nu(5, i, 0) == {"status": "stil", "vermogen_w": 0}


@pytest.mark.parametrize("vermogen, accu, verwacht", [
    (-2000, None, "goed_moment"),
    (-2000, {"status": "laden", "vermogen_w": 2000}, "accu_laadt"),
    (-4000, {"status": "laden", "vermogen_w": 2500}, "goed_moment"),   # rest 1500 > 300
    (-2000, {"status": "vol", "vermogen_w": 0}, "goed_moment"),
    (1500, {"status": "ontladen", "vermogen_w": 1500}, "accu_ontlaadt"),
    (1500, {"status": "leeg", "vermogen_w": 0}, "afname"),
    (1500, None, "afname"),
    (-200, None, "rustig"),
    (250, {"status": "leeg", "vermogen_w": 0}, "rustig"),
])
def test_signaal(vermogen, accu, verwacht):
    s = signaal(vermogen, 300, accu)
    assert s["signaal"] == verwacht
    assert s["kleur"].startswith("#") and s["advies"]
