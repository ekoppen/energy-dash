"""
virtuele_accu.py — pure rekenkern van de virtuele thuisaccu (geen I/O).

Per uur, vanaf de startdatum: eerst laden uit overschot, dan ontladen naar verbruik
(zelfde volgorde en rendementsregel als simulateShifted in de browser). De opbrengst is
het verschil tussen de rekening zonder en met accu, met dezelfde regels als
billWithSaldering/billWithoutSaldering in de browser.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

NL = ZoneInfo("Europe/Amsterdam")
STANDAARD_ACCU = {"capaciteit_kwh": 10.0, "rendement_pct": 90.0, "max_vermogen_kw": 2.5, "drempel_w": 300.0}


@dataclass(frozen=True)
class AccuInstellingen:
    startdatum: date | None
    capaciteit_kwh: float
    rendement_pct: float
    max_vermogen_kw: float
    drempel_w: float


@dataclass(frozen=True)
class Tarieven:
    piek: float
    dal: float
    teruglevering: float
    terugleverkosten: float


@dataclass
class Uur:
    start_ms: int
    soc_kwh: float
    geladen_kwh: float
    ontladen_kwh: float


def _positief(waarde, standaard: float, maximum: float = math.inf) -> float:
    try:
        v = float(waarde)
    except (TypeError, ValueError):
        return standaard
    return v if 0 < v <= maximum else standaard


def accu_instellingen(ruw: dict | None) -> AccuInstellingen:
    ruw = ruw or {}
    try:
        start = date.fromisoformat(str(ruw.get("startdatum")))
    except ValueError:
        start = None
    s = STANDAARD_ACCU
    return AccuInstellingen(
        startdatum=start,
        capaciteit_kwh=_positief(ruw.get("capaciteit_kwh"), s["capaciteit_kwh"]),
        rendement_pct=_positief(ruw.get("rendement_pct"), s["rendement_pct"], 100),
        max_vermogen_kw=_positief(ruw.get("max_vermogen_kw"), s["max_vermogen_kw"]),
        drempel_w=_positief(ruw.get("drempel_w"), s["drempel_w"]),
    )


def tarieven(d: dict) -> Tarieven:
    def getal(k, std):
        try:
            return float(d.get(k, std))
        except (TypeError, ValueError):
            return std
    return Tarieven(getal("tarief_piek", 0.25439), getal("tarief_dal", 0.233699),
                    getal("tarief_teruglevering", 0.06), getal("tarief_terugleverkosten", 0.0))


def simuleer(records: list[dict], inst: AccuInstellingen) -> list[Uur]:
    eta = math.sqrt(inst.rendement_pct / 100)
    soc = 0.0
    uren: list[Uur] = []
    for r in records:
        exp, imp = max(0.0, r["exp"]), max(0.0, r["imp"])
        geladen = max(0.0, min(exp, inst.max_vermogen_kw, (inst.capaciteit_kwh - soc) / eta))
        soc += geladen * eta
        ontladen = max(0.0, min(imp, inst.max_vermogen_kw, soc * eta))
        soc -= ontladen / eta
        uren.append(Uur(r["start_ms"], soc, geladen, ontladen))
    return uren


def gemiddeld_inkooptarief(records: list[dict], t: Tarieven) -> float:
    imp = sum(r["imp"] for r in records)
    if imp <= 0:
        return (t.piek + t.dal) / 2
    aandeel_dal = sum(r.get("imp_dal", 0.0) for r in records) / imp
    return aandeel_dal * t.dal + (1 - aandeel_dal) * t.piek


def rekening(imp: float, exp: float, prijs_import: float, t: Tarieven, saldering: bool) -> float:
    """Netto variabele kosten; terugleverkosten over alle teruglevering (zoals in de browser)."""
    if saldering:
        waarde = min(exp, imp) * prijs_import + max(0.0, exp - imp) * t.teruglevering
    else:
        waarde = exp * t.teruglevering
    return imp * prijs_import - (waarde - exp * t.terugleverkosten)


def totaal(records: list[dict], uren: list[Uur], inst: AccuInstellingen, t: Tarieven) -> dict:
    prijs = gemiddeld_inkooptarief(records, t)
    imp = sum(r["imp"] for r in records)
    exp = sum(r["exp"] for r in records)
    geladen = sum(u.geladen_kwh for u in uren)
    ontladen = sum(u.ontladen_kwh for u in uren)

    def opbrengst(saldering: bool) -> float:
        return rekening(imp, exp, prijs, t, saldering) - rekening(imp - ontladen, exp - geladen, prijs, t, saldering)

    return {
        "met_saldering": round(opbrengst(True), 2),
        "zonder_saldering": round(opbrengst(False), 2),
        "minder_teruggeleverd_kwh": round(geladen, 3),
        "minder_ingekocht_kwh": round(ontladen, 3),
        "cycli": round(ontladen / inst.capaciteit_kwh, 2),
    }


def _datum_nl(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(NL).date().isoformat()


def dagen(records: list[dict], uren: list[Uur], inst: AccuInstellingen, t: Tarieven) -> list[dict]:
    prijs = gemiddeld_inkooptarief(records, t)
    per_dag: dict[str, dict] = {}
    for u in uren:
        d = per_dag.setdefault(_datum_nl(u.start_ms), {"geladen": 0.0, "ontladen": 0.0, "soc": 0.0})
        d["geladen"] += u.geladen_kwh
        d["ontladen"] += u.ontladen_kwh
        d["soc"] = u.soc_kwh
    return [
        {
            "datum": datum,
            # zonder saldering is lineair: per dag hetzelfde als het totaalverschil
            "opbrengst_eur": round(d["ontladen"] * prijs - d["geladen"] * (t.teruglevering - t.terugleverkosten), 4),
            "geladen_kwh": round(d["geladen"], 3),
            "ontladen_kwh": round(d["ontladen"], 3),
            "laadstatus_eind_pct": round(100 * d["soc"] / inst.capaciteit_kwh, 1),
        }
        for datum, d in per_dag.items()
    ]


SIGNALEN: dict[str, tuple[str, str]] = {
    "goed_moment": ("#3ec46d", "Goed moment: je overschot gaat het net op, zet een apparaat aan"),
    "accu_laadt": ("#f0a32a", "Overschot gaat de virtuele accu in"),
    "accu_ontlaadt": ("#2f6fed", "De virtuele accu levert je verbruik"),
    "afname": ("#e8654f", "Je koopt nu stroom in"),
    "rustig": ("#5d6b78", "Rustig: weinig afname of teruglevering"),
    "fout": ("#5d6b78", "Geen actuele gegevens"),
}
_EPS = 1e-9


def accu_nu(soc_kwh: float, inst: AccuInstellingen, vermogen_w: float) -> dict:
    max_w = inst.max_vermogen_kw * 1000
    if vermogen_w < 0:
        if soc_kwh >= inst.capaciteit_kwh - _EPS:
            return {"status": "vol", "vermogen_w": 0}
        return {"status": "laden", "vermogen_w": min(-vermogen_w, max_w)}
    if vermogen_w > 0:
        if soc_kwh <= _EPS:
            return {"status": "leeg", "vermogen_w": 0}
        return {"status": "ontladen", "vermogen_w": min(vermogen_w, max_w)}
    return {"status": "stil", "vermogen_w": 0}


def signaal(vermogen_w: float, drempel_w: float, accu: dict | None) -> dict:
    accu_w = accu["vermogen_w"] if accu else 0
    if -vermogen_w > drempel_w:
        rest = -vermogen_w - (accu_w if accu and accu["status"] == "laden" else 0)
        code = "goed_moment" if rest > drempel_w else "accu_laadt"
    elif vermogen_w > drempel_w:
        rest = vermogen_w - (accu_w if accu and accu["status"] == "ontladen" else 0)
        code = "afname" if rest > drempel_w else "accu_ontlaadt"
    else:
        code = "rustig"
    kleur, advies = SIGNALEN[code]
    return {"signaal": code, "kleur": kleur, "advies": advies}
