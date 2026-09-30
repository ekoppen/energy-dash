# Virtuele accu + display-signaal — uitvoeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een per gebruiker meelopende virtuele thuisaccu (terugrekenen vanaf een startdatum, daarna live) met eigen pagina, plus een `/signaal`-endpoint met display-sleutel.

**Architecture:** Pure rekenkern in `backend/virtuele_accu.py` (simulatie, rekeningen, dagreeks, signaal). `backend/accu_dienst.py` haalt instellingen/uurdata/live-vermogen op met caches en levert de antwoorden voor `/accu` en `/signaal`. Instellingen staan in het bestaande apenkaas-`instellingen`-document (nu ook leesbaar voor de server); display-sleutels als sha256-documenten in een nieuwe collectie. Frontend krijgt een pagina "Virtuele accu" met inline-SVG-grafiek.

**Tech Stack:** FastAPI + httpx + pytest (backend), React + TypeScript + Vite + vitest (frontend), apenkaas (auth/opslag), Home Assistant recorder-statistieken.

**Spec:** `docs/superpowers/specs/2026-09-30-virtuele-accu-design.md`

## Global Constraints

- Alle UI-tekst en foutmeldingen in het Nederlands.
- Geen nieuwe dependencies (backend: stdlib `zoneinfo` is aanwezig in `python:3.12-slim`; frontend: grafiek als inline SVG).
- HA-aanroepen alleen via de bestaande veilige paden (`_veilige_url`, `_ha_get`/`_ha_state`, `fetch_hourly_statistics` met `pin_ip`) en respecteren `_geweigerde_tokens`.
- Startdatum maximaal 730 dagen terug (zelfde grens als `/hours`).
- Standaardwaarden accu: `capaciteit_kwh=10`, `rendement_pct=90`, `max_vermogen_kw=2.5`, `drempel_w=300` — gelijk in backend en frontend.
- Kleuren: `goed_moment #3ec46d`, `accu_laadt #f0a32a`, `accu_ontlaadt #2f6fed`, `afname #e8654f`, `rustig #5d6b78`, `fout #5d6b78`.
- De display-sleutel wordt nooit opgeslagen of gelogd; alleen `sha256(sleutel)`.
- Dagen worden gegroepeerd in `Europe/Amsterdam`.
- Backend-tests: `cd backend && .venv/bin/python -m pytest -q`. Frontend-tests: `cd frontend && npx vitest run`. Build: `cd frontend && npm run build`.

## Review Focus

1. **HA-tijdstempels in twee vormen** (epoch-ms-getal of ISO-string, afhankelijk van HA-versie) — dagindeling en sortering moeten voor beide kloppen (Task 1).
2. **Startdatum in de toekomst of verder dan 730 dagen terug** — geen crash: toekomst geeft een lege accu (0%), te ver terug wordt 730 dagen (Task 6).
3. **HA heeft nog geen uurdata sinds de startdatum** — `/accu` en `/signaal` geven laadstatus 0 en `stand_om: null`, geen 422/500 (Task 6).
4. **Half gelukte omzetting van het instellingen-document** (nieuw aangemaakt, oude verwijderen mislukt) — volgende keer laden kiest het document mét `app`-leesrecht en ruimt de rest op, geen tweede kopie (Task 7).
5. **Rendement 0 % of capaciteit 0** — geen deling door nul; backend valideert en gebruikt dan de standaardwaarde (Task 2).

---

## File Structure

| Bestand | Verantwoordelijkheid |
|---|---|
| `backend/ha_stats.py` (wijzigen) | Uurrecords krijgen `start_ms`; numeriek gesorteerd |
| `backend/virtuele_accu.py` (nieuw) | Pure rekenkern: simulatie, rekeningen, dagreeks, live-status, signaal |
| `backend/display_sleutel.py` (nieuw) | Sleutel genereren en hashen |
| `backend/apenkaas.py` (wijzigen) | Generieke documentoperaties op willekeurige collecties |
| `backend/accu_dienst.py` (nieuw) | Instellingen zoeken, caches, antwoorden voor `/accu` en `/signaal` |
| `backend/main.py` (wijzigen) | Settings, helpers `_nu_van`/`_uren_van`, routes `/display-sleutel`, `/accu`, `/signaal` |
| `testdata/accu-gevallen.json` (nieuw) | Gedeelde testgevallen backend ↔ browser |
| `frontend/src/instellingen.ts` (wijzigen) | `virtuele_accu`-blok, `app`-leesrecht, omzetten bestaande documenten |
| `frontend/src/api.ts` (wijzigen) | `accu()`, `displaySleutel.*`, types |
| `frontend/src/features/accu/DagGrafiek.tsx` (nieuw) | Inline-SVG: staaf opbrengst/dag + lijn laadstatus |
| `frontend/src/routes/VirtueleAccu.tsx` (nieuw) | Pagina |
| `frontend/src/main.tsx` (wijzigen) | Route + navigatie |
| `apenkaas.json`, `docker-compose.yml`, `.env.example`, `deploy/README.md` (wijzigen) | Collectie, env-variabelen, uitleg |

---

### Task 1: Uurrecords met tijdstempel

**Files:**
- Modify: `backend/ha_stats.py` (functie `combine_import_export`)
- Test: `backend/tests/test_ha_stats.py`

**Interfaces:**
- Produces: `combine_import_export(...)` → `list[dict]` met per record `{"start_ms": int, "imp": float, "exp": float, "imp_dal": float}`, oplopend gesorteerd op `start_ms`. Helper `start_ms(waarde) -> int`.

- [ ] **Step 1: Pas de bestaande test aan en voeg een test voor beide tijdvormen toe**

Vervang in `backend/tests/test_ha_stats.py` de verwachting van `test_combine_splits_dal_import_per_hour` en voeg een test toe:

```python
def test_combine_splits_dal_import_per_hour():
    from ha_stats import combine_import_export
    stats = {
        "imp_t1": [{"start": 1_700_000_000_000, "change": 0.4}, {"start": 1_700_003_600_000, "change": 0.0}],
        "imp_t2": [{"start": 1_700_003_600_000, "change": 0.7}],
        "exp_t1": [{"start": 1_700_000_000_000, "change": 0.1}],
    }
    records = combine_import_export(stats, ["imp_t1", "imp_t2"], ["exp_t1"], dal_import_ids=["imp_t1"])
    assert records == [
        {"start_ms": 1_700_000_000_000, "imp": 0.4, "exp": 0.1, "imp_dal": 0.4},
        {"start_ms": 1_700_003_600_000, "imp": 0.7, "exp": 0.0, "imp_dal": 0.0},
    ]


def test_start_ms_accepteert_ms_seconden_en_iso():
    from ha_stats import start_ms
    assert start_ms(1_700_000_000_000) == 1_700_000_000_000
    assert start_ms(1_700_000_000.0) == 1_700_000_000_000
    assert start_ms("2023-11-14T22:13:20+00:00") == 1_700_000_000_000
    assert start_ms("2023-11-14T22:13:20Z") == 1_700_000_000_000


def test_combine_sorteert_numeriek_niet_als_tekst():
    from ha_stats import combine_import_export
    stats = {"i": [{"start": 9_999_999_999_000, "change": 1}, {"start": 10_000_000_000_000, "change": 2}]}
    records = combine_import_export(stats, ["i"], [])
    assert [r["start_ms"] for r in records] == [9_999_999_999_000, 10_000_000_000_000]
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ha_stats.py -q`
Expected: FAIL (`start_ms` bestaat niet; records missen `start_ms`).

- [ ] **Step 3: Implementeer**

Voeg in `backend/ha_stats.py` boven `combine_import_export` toe:

```python
def start_ms(waarde) -> int:
    """HA levert 'start' als epoch-milliseconden (nieuw), epoch-seconden of ISO-tekst (oud)."""
    if isinstance(waarde, (int, float)):
        return int(waarde if waarde > 1e11 else waarde * 1000)
    return int(datetime.fromisoformat(str(waarde).replace("Z", "+00:00")).timestamp() * 1000)
```

Vervang in `combine_import_export` de sleutel en de uitvoer:

```python
    def index_by_start(ids: list[str]) -> dict[int, float]:
        acc: dict[int, float] = {}
        for eid in ids:
            for bucket in stats.get(eid, []):
                start = bucket.get("start")
                change = bucket.get("change")
                if start is None or change is None:
                    continue
                key = start_ms(start)
                acc[key] = acc.get(key, 0.0) + float(change)
        return acc

    imp_by_start = index_by_start(import_ids)
    exp_by_start = index_by_start(export_ids)
    dal_by_start = index_by_start(list(dal_import_ids))

    records = []
    for s in sorted(set(imp_by_start) | set(exp_by_start)):
        imp = max(0.0, imp_by_start.get(s, 0.0))
        records.append({
            "start_ms": s,
            "imp": imp,
            "exp": max(0.0, exp_by_start.get(s, 0.0)),
            "imp_dal": min(imp, max(0.0, dal_by_start.get(s, 0.0))),
        })
    return records
```

Werk de docstring bij: `{start_ms, imp, exp, imp_dal}`.

- [ ] **Step 4: Draai alle backendtests**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: alles PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/ha_stats.py backend/tests/test_ha_stats.py
git commit -m "feat(backend): uurrecords krijgen start_ms (ms, seconden of ISO van HA)"
```

---

### Task 2: Rekenkern — simulatie, rekeningen en dagreeks

**Files:**
- Create: `backend/virtuele_accu.py`
- Create: `testdata/accu-gevallen.json`
- Create: `backend/tests/test_virtuele_accu.py`
- Modify: `frontend/src/features/saldering/saldering-model.test.ts` (gedeelde gevallen)

**Interfaces:**
- Consumes: records uit Task 1 (`start_ms`, `imp`, `exp`, `imp_dal`).
- Produces (in `virtuele_accu.py`):
  - `@dataclass(frozen=True) AccuInstellingen(startdatum: date | None, capaciteit_kwh: float, rendement_pct: float, max_vermogen_kw: float, drempel_w: float)`
  - `STANDAARD_ACCU: dict` = `{"capaciteit_kwh": 10, "rendement_pct": 90, "max_vermogen_kw": 2.5, "drempel_w": 300}`
  - `accu_instellingen(ruw: dict | None) -> AccuInstellingen` (valideert, valt terug op standaard)
  - `@dataclass(frozen=True) Tarieven(piek: float, dal: float, teruglevering: float, terugleverkosten: float)`
  - `tarieven(doc_data: dict) -> Tarieven`
  - `@dataclass Uur(start_ms: int, soc_kwh: float, geladen_kwh: float, ontladen_kwh: float)`
  - `simuleer(records: list[dict], inst: AccuInstellingen) -> list[Uur]`
  - `gemiddeld_inkooptarief(records: list[dict], t: Tarieven) -> float`
  - `rekening(imp: float, exp: float, prijs_import: float, t: Tarieven, saldering: bool) -> float`
  - `totaal(records, uren, inst, t) -> dict` met `met_saldering`, `zonder_saldering`, `minder_teruggeleverd_kwh`, `minder_ingekocht_kwh`, `cycli`
  - `dagen(records, uren, inst, t) -> list[dict]` met `datum` (YYYY-MM-DD), `opbrengst_eur`, `geladen_kwh`, `ontladen_kwh`, `laadstatus_eind_pct`

- [ ] **Step 1: Gedeelde testgevallen**

Maak `testdata/accu-gevallen.json`:

```json
[
  { "naam": "vult tot capaciteit en ontlaadt alles", "capaciteit": 5, "rendement": 1.0,
    "uren": [{ "imp": 0, "exp": 3 }, { "imp": 0, "exp": 4 }, { "imp": 6, "exp": 0 }, { "imp": 2, "exp": 0 }],
    "verschoven": 5 },
  { "naam": "rendementsverlies half bij laden, half bij ontladen", "capaciteit": 10, "rendement": 0.81,
    "uren": [{ "imp": 0, "exp": 10 }, { "imp": 10, "exp": 0 }],
    "verschoven": 8.1 },
  { "naam": "laden en ontladen in hetzelfde uur", "capaciteit": 10, "rendement": 1.0,
    "uren": [{ "imp": 2, "exp": 3 }],
    "verschoven": 2 }
]
```

- [ ] **Step 2: Schrijf de falende tests**

Maak `backend/tests/test_virtuele_accu.py`:

```python
import json
from datetime import date
from pathlib import Path

import pytest

from virtuele_accu import (
    AccuInstellingen, Tarieven, accu_instellingen, dagen, gemiddeld_inkooptarief,
    rekening, simuleer, totaal,
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
    assert sum(x["opbrengst_eur"] for x in d) == pytest.approx(tot["zonder_saldering"], abs=1e-6)
    assert tot["minder_ingekocht_kwh"] == pytest.approx(sum(x.ontladen_kwh for x in u))
    assert tot["cycli"] == pytest.approx(tot["minder_ingekocht_kwh"] / 5)


def test_dagen_groeperen_in_nederlandse_tijd():
    # 2026-06-01 22:30 UTC = 2 juni 00:30 in Amsterdam
    r = [{"start_ms": 1_780_353_000_000, "imp": 0, "exp": 1, "imp_dal": 0}]
    d = dagen(r, simuleer(r, inst()), inst(), T)
    assert d[0]["datum"] == "2026-06-02"
```

- [ ] **Step 3: Draai en zie ze falen**

Run: `cd backend && .venv/bin/python -m pytest tests/test_virtuele_accu.py -q`
Expected: FAIL met `ModuleNotFoundError: virtuele_accu`.

- [ ] **Step 4: Implementeer `backend/virtuele_accu.py`**

```python
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
```

Let op: `totaal()` rondt af op 2 decimalen, `dagen()` op 4. De test vergelijkt met `abs=1e-6`; als afronding daar knelt, rond dan in de test beide kanten af op 2 decimalen (`round(sum(...), 2) == tot["zonder_saldering"]`) — niet de rekenregel aanpassen.

- [ ] **Step 5: Draai de backendtests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_virtuele_accu.py -q`
Expected: PASS.

- [ ] **Step 6: Laat de browser-simulatie dezelfde gevallen draaien**

Voeg toe aan het eind van `frontend/src/features/saldering/saldering-model.test.ts` (bovenaan staat `simulateShifted` nog niet in de imports; importeer het uit `../accu/battery-model`):

```ts
import { readFileSync } from "node:fs";
import { simulateShifted } from "../accu/battery-model";

describe("gedeelde accu-testgevallen (gelijk aan backend/virtuele_accu.py)", () => {
  const gevallen = JSON.parse(readFileSync(new URL("../../../../testdata/accu-gevallen.json", import.meta.url), "utf8"));
  for (const g of gevallen) {
    it(g.naam, () => {
      expect(simulateShifted(g.uren, { capacity: g.capaciteit, roundTrip: g.rendement })).toBeCloseTo(g.verschoven, 6);
    });
  }
});
```

Zet de twee `import`-regels bij de bestaande imports bovenaan het bestand.

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/virtuele_accu.py backend/tests/test_virtuele_accu.py testdata/accu-gevallen.json frontend/src/features/saldering/saldering-model.test.ts
git commit -m "feat(backend): rekenkern virtuele accu met gedeelde testgevallen"
```

---

### Task 3: Live-status en signaal

**Files:**
- Modify: `backend/virtuele_accu.py`
- Test: `backend/tests/test_virtuele_accu.py`

**Interfaces:**
- Consumes: `AccuInstellingen` (Task 2).
- Produces:
  - `accu_nu(soc_kwh: float, inst: AccuInstellingen, vermogen_w: float) -> dict` → `{"status": "laden"|"ontladen"|"vol"|"leeg"|"stil", "vermogen_w": float}`
  - `signaal(vermogen_w: float, drempel_w: float, accu: dict | None) -> dict` → `{"signaal": str, "kleur": str, "advies": str}`
  - `SIGNALEN: dict[str, tuple[str, str]]` (code → (kleur, advies))

Regel (verfijning van de spec-tabel): na aftrek van wat de accu opneemt of levert blijft een **rest** over. Teruglevering met rest > drempel → `goed_moment`; teruglevering boven drempel maar rest ≤ drempel → `accu_laadt`. Afname met rest > drempel → `afname`; afname boven drempel maar rest ≤ drempel → `accu_ontlaadt`. Anders `rustig`.

- [ ] **Step 1: Falende tests**

Voeg toe aan `backend/tests/test_virtuele_accu.py`:

```python
from virtuele_accu import accu_nu, signaal


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
```

- [ ] **Step 2: Draai en zie ze falen**

Run: `cd backend && .venv/bin/python -m pytest tests/test_virtuele_accu.py -q`
Expected: FAIL (`ImportError: accu_nu`).

- [ ] **Step 3: Implementeer (onderaan `virtuele_accu.py`)**

```python
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
```

- [ ] **Step 4: Draai de tests**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/virtuele_accu.py backend/tests/test_virtuele_accu.py
git commit -m "feat(backend): live accustatus en display-signaal"
```

---

### Task 4: Apenkaas-client — documenten in willekeurige collecties

**Files:**
- Modify: `backend/apenkaas.py`
- Test: `backend/tests/test_apenkaas.py`

**Interfaces:**
- Produces (methoden op `Apenkaas`, altijd met de server-sleutel):
  - `async documenten(collection_id: str, filters: dict[str, str] | None = None) -> list[dict]` — alle pagina's (limit 1000); elk document `{id, data, read_permissions, write_permissions, bijgewerkt_op, ...}`
  - `async document(collection_id: str, doc_id: str) -> dict | None` (404 → `None`)
  - `async maak_document(collection_id: str, doc_id: str, data: dict, lees: list[str], schrijf: list[str]) -> None`
  - `async verwijder_document(collection_id: str, doc_id: str) -> None` (404 is ok)
  - Alle fouten → `ApenkaasFout`.
- Produces (module-functie): `kies_instellingen(docs: list[dict], user_id: str) -> dict | None` — het meest recent bijgewerkte document met `user:<user_id>` in `write_permissions`.

- [ ] **Step 1: Falende tests**

Voeg toe aan `backend/tests/test_apenkaas.py`:

```python
from apenkaas import kies_instellingen


def test_documenten_pagineert_en_filtert():
    gezien = []

    def handler(req):
        gezien.append(str(req.url))
        assert req.headers["authorization"] == "ApiKey geheim"
        offset = int(req.url.params["offset"])
        docs = [{"id": f"d{i}"} for i in range(offset, min(offset + 1000, 1500))]
        return httpx.Response(200, json={"documents": docs, "count": 1500})

    docs = asyncio.run(maak(handler).documenten("col", {"user_id": "eq.u1"}))
    assert len(docs) == 1500
    assert "user_id=eq.u1" in gezien[0] and "limit=1000" in gezien[0]
    assert len(gezien) == 2


def test_document_404_is_none_en_verwijderen_404_ok():
    ak = maak(lambda req: httpx.Response(404, json={"error": "not_found"}))
    assert asyncio.run(ak.document("col", "x")) is None
    asyncio.run(ak.verwijder_document("col", "x"))


def test_maak_document_stuurt_id_en_rechten():
    body = {}

    def handler(req):
        body.update(json.loads(req.content))
        assert req.url.path == "/api/t1/collections/col/documents"
        return httpx.Response(200, json={"id": "abc"})

    asyncio.run(maak(handler).maak_document("col", "abc", {"user_id": "u1"}, ["app"], ["app"]))
    assert body == {"id": "abc", "data": {"user_id": "u1"}, "readPermissions": ["app"], "writePermissions": ["app"]}


def test_kies_instellingen_alleen_eigen_document():
    docs = [
        {"id": "vreemd", "write_permissions": ["user:u2"], "bijgewerkt_op": "2026-09-30T10:00:00Z", "data": {}},
        {"id": "oud", "write_permissions": ["user:u1"], "bijgewerkt_op": "2026-09-01T10:00:00Z", "data": {}},
        {"id": "nieuw", "write_permissions": ["user:u1"], "bijgewerkt_op": "2026-09-29T10:00:00Z", "data": {}},
    ]
    assert kies_instellingen(docs, "u1")["id"] == "nieuw"
    assert kies_instellingen(docs, "u3") is None
```

Voeg `import json` toe bovenaan het testbestand.

- [ ] **Step 2: Draai en zie ze falen**

Run: `cd backend && .venv/bin/python -m pytest tests/test_apenkaas.py -q`
Expected: FAIL (`ImportError: kies_instellingen`).

- [ ] **Step 3: Implementeer in `backend/apenkaas.py`**

Voeg methoden toe aan de klasse `Apenkaas` (na `delete_koppeling`):

```python
    async def documenten(self, collection_id: str, filters: dict[str, str] | None = None) -> list[dict]:
        """Alle documenten die de server-sleutel mag lezen, over alle pagina's."""
        alles: list[dict] = []
        while True:
            params = {**(filters or {}), "limit": "1000", "offset": str(len(alles))}
            r = await self._request("GET", f"/collections/{collection_id}/documents",
                                    headers=self._server, params=params)
            if r.status_code != 200:
                raise ApenkaasFout(f"documenten lezen gaf {r.status_code}")
            pagina = r.json()["documents"]
            alles += pagina
            if len(pagina) < 1000:
                return alles

    async def document(self, collection_id: str, doc_id: str) -> dict | None:
        r = await self._request("GET", f"/collections/{collection_id}/documents/{doc_id}", headers=self._server)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise ApenkaasFout(f"document lezen gaf {r.status_code}")
        return r.json()

    async def maak_document(self, collection_id: str, doc_id: str, data: dict,
                            lees: list[str], schrijf: list[str]) -> None:
        r = await self._request("POST", f"/collections/{collection_id}/documents", headers=self._server, json={
            "id": doc_id, "data": data, "readPermissions": lees, "writePermissions": schrijf,
        })
        if r.status_code != 200:
            raise ApenkaasFout(f"document aanmaken gaf {r.status_code}")

    async def verwijder_document(self, collection_id: str, doc_id: str) -> None:
        r = await self._request("DELETE", f"/collections/{collection_id}/documents/{doc_id}", headers=self._server)
        if r.status_code not in (200, 404):
            raise ApenkaasFout(f"document verwijderen gaf {r.status_code}")
```

En onderaan de module:

```python
def kies_instellingen(docs: list[dict], user_id: str) -> dict | None:
    """
    Het instellingen-document van deze gebruiker: alleen documenten waarin user:<id>
    mag schrijven. Gebruikers kunnen geen rechten voor een ander toekennen (apenkaas),
    dus niemand kan een document namens een ander neerzetten.
    """
    eigen = [d for d in docs if f"user:{user_id}" in d.get("write_permissions", [])]
    return max(eigen, key=lambda d: d.get("bijgewerkt_op", ""), default=None)
```

- [ ] **Step 4: Draai de tests**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apenkaas.py backend/tests/test_apenkaas.py
git commit -m "feat(backend): apenkaas-client voor documenten in andere collecties"
```

---

### Task 5: Display-sleutel (routes, collectie, configuratie)

**Files:**
- Create: `backend/display_sleutel.py`
- Modify: `backend/main.py` (Settings, routes)
- Modify: `apenkaas.json`, `docker-compose.yml`, `.env.example`
- Test: `backend/tests/test_display_sleutel.py`, uitbreiding `NepApenkaas` in `backend/tests/test_main.py`

**Interfaces:**
- Consumes: `Apenkaas.documenten/document/maak_document/verwijder_document` (Task 4).
- Produces:
  - `display_sleutel.nieuwe_sleutel() -> str` (`"ed_" + secrets.token_urlsafe(32)`)
  - `display_sleutel.sleutel_id(sleutel: str) -> str` (sha256-hex)
  - `Settings.apenkaas_instellingen_collection_id: str`, `Settings.apenkaas_display_collection_id: str`
  - `async main.gebruiker_van_sleutel(sleutel: str | None) -> str | None` (Task 6 gebruikt dit)
  - Routes: `GET /display-sleutel` → `{"actief": bool}`, `POST /display-sleutel` → `{"sleutel": str}`, `DELETE /display-sleutel` → `{"actief": false}`
  - Testhulp in `test_main.py`: `NepApenkaas` met `self.docs: dict[str, dict[str, dict]]` (collectie → id → document) en de vier documentmethoden.

- [ ] **Step 1: Breid `NepApenkaas` uit (testhulp)**

In `backend/tests/test_main.py`, voeg aan `NepApenkaas.__init__` toe: `self.docs = {}`, en voeg methoden toe:

```python
    async def documenten(self, col, filters=None):
        docs = list(self.docs.get(col, {}).values())
        for veld, waarde in (filters or {}).items():
            docs = [d for d in docs if f"eq.{d['data'].get(veld)}" == waarde]
        return docs

    async def document(self, col, doc_id):
        return self.docs.get(col, {}).get(doc_id)

    async def maak_document(self, col, doc_id, data, lees, schrijf):
        self.docs.setdefault(col, {})[doc_id] = {
            "id": doc_id, "data": data, "read_permissions": lees, "write_permissions": schrijf,
            "bijgewerkt_op": "2026-09-30T12:00:00Z"}

    async def verwijder_document(self, col, doc_id):
        self.docs.get(col, {}).pop(doc_id, None)
```

- [ ] **Step 2: Falende tests**

Maak `backend/tests/test_display_sleutel.py`:

```python
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
```

- [ ] **Step 3: Draai en zie ze falen**

Run: `cd backend && .venv/bin/python -m pytest tests/test_display_sleutel.py -q`
Expected: FAIL (`ModuleNotFoundError: display_sleutel`).

- [ ] **Step 4: Implementeer**

`backend/display_sleutel.py`:

```python
"""display_sleutel.py — sleutels voor displays: alleen de sha256 wordt opgeslagen."""
from __future__ import annotations

import hashlib
import secrets


def nieuwe_sleutel() -> str:
    return "ed_" + secrets.token_urlsafe(32)


def sleutel_id(sleutel: str) -> str:
    return hashlib.sha256(sleutel.encode()).hexdigest()
```

In `backend/main.py`:
- Import: `from display_sleutel import nieuwe_sleutel, sleutel_id`
- In `class Settings` na `apenkaas_koppeling_collection_id`:

```python
    apenkaas_instellingen_collection_id: str = ""
    apenkaas_display_collection_id: str = ""
```

- Routes (na de `/koppeling`-routes):

```python
async def _sleutels_van(uid: str) -> list[dict]:
    return await apenkaas.documenten(settings.apenkaas_display_collection_id, {"user_id": f"eq.{uid}"})


async def gebruiker_van_sleutel(sleutel: str | None) -> str | None:
    if not sleutel:
        return None
    doc = await apenkaas.document(settings.apenkaas_display_collection_id, sleutel_id(sleutel))
    return doc["data"].get("user_id") if doc else None


@app.get("/display-sleutel")
async def display_sleutel_status(uid: str = Depends(current_user)) -> dict:
    try:
        return {"actief": bool(await _sleutels_van(uid))}
    except ApenkaasFout:
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")


@app.post("/display-sleutel")
async def display_sleutel_maken(uid: str = Depends(current_user)) -> dict:
    """Maakt een nieuwe sleutel; eerdere sleutels van deze gebruiker vervallen. Eénmalig zichtbaar."""
    sleutel = nieuwe_sleutel()
    try:
        for d in await _sleutels_van(uid):
            await apenkaas.verwijder_document(settings.apenkaas_display_collection_id, d["id"])
        await apenkaas.maak_document(settings.apenkaas_display_collection_id, sleutel_id(sleutel),
                                     {"user_id": uid}, ["app"], ["app"])
    except ApenkaasFout as e:
        log.warning("display-sleutel maken mislukt user=%s: %s", uid, e)
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")
    log.info("display-sleutel aangemaakt user=%s", uid)
    return {"sleutel": sleutel}


@app.delete("/display-sleutel")
async def display_sleutel_intrekken(uid: str = Depends(current_user)) -> dict:
    try:
        for d in await _sleutels_van(uid):
            await apenkaas.verwijder_document(settings.apenkaas_display_collection_id, d["id"])
    except ApenkaasFout:
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")
    return {"actief": False}
```

- CORS: voeg `"POST"` toe aan `allow_methods` (`["GET", "PUT", "POST", "DELETE"]`).

`apenkaas.json` — voeg aan `collections` toe, en zet bij `instellingen` de extra env-naam:

```json
    {
      "naam": "display_sleutels",
      "schema": [{ "key": "user_id", "type": "string" }],
      "createPermissions": [],
      "env": ["APENKAAS_DISPLAY_COLLECTION_ID"]
    }
```

en bij `instellingen`: `"env": ["VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID", "APENKAAS_INSTELLINGEN_COLLECTION_ID"]`.

`docker-compose.yml` — onder `backend.environment` na `APENKAAS_KOPPELING_COLLECTION_ID`:

```yaml
      APENKAAS_INSTELLINGEN_COLLECTION_ID: ${APENKAAS_INSTELLINGEN_COLLECTION_ID}
      APENKAAS_DISPLAY_COLLECTION_ID: ${APENKAAS_DISPLAY_COLLECTION_ID}
```

`.env.example` — onder `APENKAAS_KOPPELING_COLLECTION_ID`:

```
# Zelfde id als VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID; de backend leest tarieven + accu-instellingen.
APENKAAS_INSTELLINGEN_COLLECTION_ID=uuid-van-collection-instellingen
APENKAAS_DISPLAY_COLLECTION_ID=uuid-van-collection-display_sleutels
```

- [ ] **Step 5: Draai de tests**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/display_sleutel.py backend/main.py backend/tests apenkaas.json docker-compose.yml .env.example
git commit -m "feat: display-sleutel (alleen sha256 opgeslagen, vervangen trekt oude in)"
```

---

### Task 6: Accudienst met caches en de routes `/accu` en `/signaal`

**Files:**
- Create: `backend/accu_dienst.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_accu_dienst.py`, `backend/tests/test_main.py`

**Interfaces:**
- Consumes: `virtuele_accu.*` (Task 2, 3), `Apenkaas.documenten`, `kies_instellingen` (Task 4), `gebruiker_van_sleutel` (Task 5), `_geweigerde_tokens`/`_token_id`/`_token_geweigerd` (bestaand).
- Produces:
  - `class AccuDienst(lees_instellingen, haal_nu, haal_uren, klok=time.time)` waarbij
    - `lees_instellingen: async (uid) -> dict` (document-`data`, `{}` als er geen is)
    - `haal_nu: async (koppeling: dict) -> {"vermogen_w": float, "actief_tarief": "dal"|"piek"}`
    - `haal_uren: async (koppeling: dict, days: int) -> list[dict]` (records Task 1)
  - `async AccuDienst.nu(uid, koppeling) -> dict` — antwoordvorm van `/signaal`
  - `async AccuDienst.volledig(uid, koppeling) -> dict` — `{"instellingen", "nu", "totaal", "dagen"}`
  - `AccuDienst.fout_antwoord(melding: str) -> dict` — `/signaal`-antwoord met `signaal: "fout"`
  - In `main.py`: `async _nu_van(k) -> dict`, `async _uren_van(k, days) -> list[dict]` (logica uit `/now` en `/hours` verplaatst; die routes roepen deze aan), `accu_dienst = AccuDienst(...)`, routes `GET /accu`, `GET /signaal`.

Caches (in het geheugen, per gebruiker): instellingen 60 s; live 10 s; uurberekening met sleutel `(startdatum, capaciteit, rendement, max_vermogen, tarieven)` geldig tot 5 minuten na het volgende hele uur.

- [ ] **Step 1: Falende tests voor de dienst**

Maak `backend/tests/test_accu_dienst.py`:

```python
import asyncio
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
    assert s["accu"]["laadstatus_kwh"] == pytest.approx(3 * 0.9486833, rel=1e-3)
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
```

Let op de verwachte laadstatus: rendement 90% → η = √0,9 ≈ 0,94868; drie uur 1 kWh overschot → 3 × η.

- [ ] **Step 2: Draai en zie ze falen**

Run: `cd backend && .venv/bin/python -m pytest tests/test_accu_dienst.py -q`
Expected: FAIL (`ModuleNotFoundError: accu_dienst`).

- [ ] **Step 3: Implementeer `backend/accu_dienst.py`**

```python
"""
accu_dienst.py — levert de antwoorden voor /accu en /signaal.

Rekent de virtuele accu steeds opnieuw uit de HA-uurdata (geen opgeslagen toestand).
Caches per gebruiker (in het geheugen): instellingen 60 s, live-vermogen 10 s,
uurberekening tot kort na het volgende hele uur. Een display dat vaker vraagt,
raakt HA dus hooguit eens per 10 s.
"""
from __future__ import annotations

import time
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

import virtuele_accu as va

INSTELLINGEN_TTL_S = 60
LIVE_TTL_S = 10
UUR_S = 3600
HA_UUR_VERTRAGING_S = 300  # HA schrijft de uurstatistiek kort na het hele uur
MAX_DAGEN = 730


class AccuDienst:
    def __init__(self, lees_instellingen, haal_nu, haal_uren, klok=time.time):
        self._lees_instellingen = lees_instellingen
        self._haal_nu = haal_nu
        self._haal_uren = haal_uren
        self._klok = klok
        self._inst: dict[str, tuple[float, dict]] = {}
        self._live: dict[str, tuple[float, dict]] = {}
        self._uren: dict[str, tuple[tuple, float, dict]] = {}

    async def _instellingen(self, uid: str) -> dict:
        nu = self._klok()
        hit = self._inst.get(uid)
        if hit and nu - hit[0] < INSTELLINGEN_TTL_S:
            return hit[1]
        data = await self._lees_instellingen(uid)
        self._inst[uid] = (nu, data)
        return data

    async def _live_van(self, uid: str, k: dict) -> dict:
        nu = self._klok()
        hit = self._live.get(uid)
        if hit and nu - hit[0] < LIVE_TTL_S:
            return hit[1]
        data = await self._haal_nu(k)
        self._live[uid] = (nu, data)
        return data

    async def _berekening(self, uid: str, k: dict, inst: va.AccuInstellingen, t: va.Tarieven) -> dict:
        sleutel = (inst.startdatum, inst.capaciteit_kwh, inst.rendement_pct, inst.max_vermogen_kw, t)
        nu = self._klok()
        hit = self._uren.get(uid)
        if hit and hit[0] == sleutel and nu < hit[1]:
            return hit[2]
        vandaag = datetime.fromtimestamp(nu, tz=timezone.utc).astimezone(va.NL).date()
        dagen_terug = min(MAX_DAGEN, (vandaag - inst.startdatum).days + 1)
        records: list[dict] = []
        if dagen_terug > 0:
            start_ms = datetime.combine(inst.startdatum, datetime.min.time(), tzinfo=va.NL).timestamp() * 1000
            records = [r for r in await self._haal_uren(k, dagen_terug) if r["start_ms"] >= start_ms]
        uren = va.simuleer(records, inst)
        resultaat = {
            "uren": uren,
            "totaal": va.totaal(records, uren, inst, t),
            "dagen": va.dagen(records, uren, inst, t),
        }
        geldig_tot = (nu // UUR_S + 1) * UUR_S + HA_UUR_VERTRAGING_S
        self._uren[uid] = (sleutel, geldig_tot, resultaat)
        return resultaat

    def _tijd(self) -> str:
        return datetime.fromtimestamp(self._klok(), tz=timezone.utc).astimezone(va.NL).isoformat(timespec="seconds")

    async def _alles(self, uid: str, k: dict) -> tuple[dict, dict | None, va.AccuInstellingen]:
        data = await self._instellingen(uid)
        inst = va.accu_instellingen(data.get("virtuele_accu"))
        live = await self._live_van(uid, k)
        antwoord = {"tijd": self._tijd(), "vermogen_w": live["vermogen_w"], "tarief": live["actief_tarief"]}
        berekening = None
        accu = None
        if inst.startdatum is not None:
            berekening = await self._berekening(uid, k, inst, va.tarieven(data))
            laatste = berekening["uren"][-1] if berekening["uren"] else None
            soc = laatste.soc_kwh if laatste else 0.0
            stand_om = (datetime.fromtimestamp(laatste.start_ms / 1000 + UUR_S, tz=timezone.utc)
                        .astimezone(va.NL).strftime("%H:%M")) if laatste else None
            vandaag = self._tijd()[:10]
            accu = {
                "laadstatus_pct": round(100 * soc / inst.capaciteit_kwh, 1),
                "laadstatus_kwh": round(soc, 2),
                "stand_om": stand_om,
                **va.accu_nu(soc, inst, live["vermogen_w"]),
                "opbrengst_vandaag_eur": round(sum(d["opbrengst_eur"] for d in berekening["dagen"] if d["datum"] == vandaag), 2),
                "opbrengst_sinds_start_eur": {k2: berekening["totaal"][k2] for k2 in ("met_saldering", "zonder_saldering")},
            }
        antwoord.update(va.signaal(live["vermogen_w"], inst.drempel_w, accu))
        if accu:
            antwoord["accu"] = accu
        return antwoord, berekening, inst

    async def nu(self, uid: str, k: dict) -> dict:
        antwoord, _, _ = await self._alles(uid, k)
        return antwoord

    async def volledig(self, uid: str, k: dict) -> dict:
        antwoord, berekening, inst = await self._alles(uid, k)
        instellingen = asdict(inst)
        instellingen["startdatum"] = inst.startdatum.isoformat() if inst.startdatum else None
        return {
            "instellingen": instellingen,
            "nu": antwoord,
            "totaal": berekening["totaal"] if berekening else None,
            "dagen": berekening["dagen"] if berekening else [],
        }

    def fout_antwoord(self, melding: str) -> dict:
        kleur, _ = va.SIGNALEN["fout"]
        return {"tijd": self._tijd(), "signaal": "fout", "kleur": kleur, "advies": melding}
```

- [ ] **Step 4: Draai de diensttests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_accu_dienst.py -q`
Expected: PASS.

- [ ] **Step 5: Falende routetests**

Voeg toe aan `backend/tests/test_main.py`:

```python
def _nep_dienst(monkeypatch, nu=None, fout=None):
    class Nep:
        async def nu(self, uid, k):
            if fout:
                raise fout
            return nu or {"signaal": "rustig"}

        async def volledig(self, uid, k):
            return {"nu": {"signaal": "rustig"}, "instellingen": {}, "totaal": None, "dagen": []}

        def fout_antwoord(self, melding):
            return {"signaal": "fout", "advies": melding}

    monkeypatch.setattr(main, "accu_dienst", Nep())


def test_signaal_met_sleutel_header_en_query(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))
    _nep_dienst(monkeypatch)

    async def van(s):
        return "u1" if s == "ed_goed" else None

    monkeypatch.setattr(main, "gebruiker_van_sleutel", van)
    assert client.get("/signaal", headers={"Authorization": "Bearer ed_goed"}).json() == {"signaal": "rustig"}
    assert client.get("/signaal?sleutel=ed_goed").json() == {"signaal": "rustig"}
    assert client.get("/signaal?sleutel=fout").status_code == 401
    assert client.get("/signaal").status_code == 401


def test_signaal_met_geweigerd_token_is_fout_zonder_ha(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))
    monkeypatch.setattr(main, "_geweigerde_tokens", {main._token_id("HA-GEHEIM")})
    _nep_dienst(monkeypatch, fout=AssertionError("dienst mag niet aangeroepen worden"))

    async def van(s):
        return "u1"

    monkeypatch.setattr(main, "gebruiker_van_sleutel", van)
    r = client.get("/signaal?sleutel=ed_x")
    assert r.status_code == 200 and r.json()["signaal"] == "fout"


def test_signaal_zonder_koppeling_is_fout(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas())
    _nep_dienst(monkeypatch)

    async def van(s):
        return "u1"

    monkeypatch.setattr(main, "gebruiker_van_sleutel", van)
    assert client.get("/signaal?sleutel=ed_x").json()["signaal"] == "fout"


def test_accu_vereist_inlog_en_koppeling(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))
    _nep_dienst(monkeypatch)
    assert client.get("/accu").status_code == 401
    assert client.get("/accu", headers=AUTH).json()["dagen"] == []


def test_display_sleutel_werkt_niet_op_andere_routes(client, monkeypatch):
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))
    assert client.get("/now", headers={"Authorization": "Bearer ed_goed"}).status_code == 401
```

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -q`
Expected: FAIL (`/signaal` bestaat niet → 404).

- [ ] **Step 6: Implementeer in `backend/main.py`**

Imports: `from accu_dienst import AccuDienst` en `from apenkaas import Apenkaas, ApenkaasFout, NietIngelogd, kies_instellingen`.

Verplaats de logica van `/now` en `/hours` naar helpers en laat de routes die aanroepen:

```python
async def _nu_van(k: dict) -> dict:
    power = await _ha_state(k, k["entities"]["active_power"])
    tariff = await _ha_state(k, k["entities"]["active_tariff"])
    try:
        vermogen = float(power["state"])
    except (KeyError, TypeError, ValueError):
        raise fout(502, "ha_onbereikbaar", "Home Assistant gaf geen geldig vermogen")
    return {"vermogen_w": vermogen, "actief_tarief": "dal" if tariff.get("state") == "1" else "piek"}


async def _uren_van(k: dict, days: int) -> list[dict]:
    doel = await _veilige_url(k["ha_url"])
    e = k["entities"]
    import_ids = [e["import_t1"], e["import_t2"]]
    export_ids = [e["export_t1"], e["export_t2"]]
    try:
        stats = await fetch_hourly_statistics(doel.url, k["ha_token"], import_ids + export_ids, days, pin_ip=doel.ip)
    except HAAuthError:
        raise _token_geweigerd(k["ha_token"])
    except Exception as err:  # ook OSError, timeouts, redirects: nooit HA-tekst terug naar de gebruiker
        log.warning("uurstatistieken mislukt: %r", err)
        raise fout(502, "ha_onbereikbaar", "Uur-statistieken ophalen mislukt")
    return combine_import_export(stats, import_ids, export_ids, dal_import_ids=[e["import_t1"]])


@app.get("/now")
async def now(k: dict = Depends(koppeling_van)) -> dict:
    """Actueel vermogen en actief tarief; de prijs rekent de frontend uit."""
    return await _nu_van(k)


@app.get("/hours")
async def hours(days: int = Query(365, ge=1, le=730), k: dict = Depends(koppeling_van)) -> list[dict]:
    """Uurdata {start_ms, imp, exp, imp_dal} uit de HA recorder-statistieken van de gebruiker."""
    records = await _uren_van(k, days)
    if not records:
        raise fout(422, "geen_uurdata", "Home Assistant heeft (nog) geen uur-statistieken voor de P1-meter")
    return records
```

Dienst en routes (na de display-sleutel-routes):

```python
async def _lees_instellingen(uid: str) -> dict:
    doc = kies_instellingen(await apenkaas.documenten(settings.apenkaas_instellingen_collection_id), uid)
    return doc["data"] if doc else {}


accu_dienst = AccuDienst(_lees_instellingen, _nu_van, _uren_van)


@app.get("/accu")
async def accu(uid: str = Depends(current_user), k: dict = Depends(koppeling_van)) -> dict:
    try:
        return await accu_dienst.volledig(uid, k)
    except ApenkaasFout:
        raise fout(503, "apenkaas_onbereikbaar", "Apenkaas is even niet bereikbaar")


@app.get("/signaal")
async def signaal_voor_display(sleutel: str | None = Query(None),
                               cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    """Voor displays: alleen met een display-sleutel; fouten als signaal 'fout' (HTTP 200)."""
    try:
        uid = await gebruiker_van_sleutel(cred.credentials if cred else sleutel)
    except ApenkaasFout:
        return accu_dienst.fout_antwoord("Apenkaas is even niet bereikbaar")
    if uid is None:
        raise fout(401, "sleutel_ongeldig", "Onbekende display-sleutel")
    try:
        k = await koppeling_van(uid)
        return await accu_dienst.nu(uid, k)
    except HTTPException as e:
        return accu_dienst.fout_antwoord(e.detail.get("melding", "Geen actuele gegevens"))
    except ApenkaasFout:
        return accu_dienst.fout_antwoord("Apenkaas is even niet bereikbaar")
```

`koppeling_van` is een gewone async-functie met `uid` als parameter, dus rechtstreeks aanroepen werkt; hij gooit bij een geweigerd token al `ha_token` zonder HA aan te roepen.

- [ ] **Step 7: Draai alle backendtests**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/accu_dienst.py backend/main.py backend/tests
git commit -m "feat(backend): /accu en /signaal met caches op instellingen, live en uurberekening"
```

---

### Task 7: Instellingen-document leesbaar voor de server + accu-blok (frontend)

**Files:**
- Modify: `frontend/src/instellingen.ts`
- Test: `frontend/src/instellingen.test.ts`

**Interfaces:**
- Consumes: `getSessie()` uit `./auth` (`userId`).
- Produces:
  - `interface VirtueleAccu { startdatum?: string; capaciteit_kwh: number; rendement_pct: number; max_vermogen_kw: number; drempel_w: number }`
  - `Instellingen.virtuele_accu: VirtueleAccu`
  - `STANDAARD.virtuele_accu = { capaciteit_kwh: 10, rendement_pct: 90, max_vermogen_kw: 2.5, drempel_w: 300 }`
  - Ongewijzigd: `laadInstellingen()`, `bewaarInstellingen(id, deel)`.

- [ ] **Step 1: Falende tests**

Pas in `frontend/src/instellingen.test.ts` de mock aan zodat de sessie een gebruiker heeft:

```ts
vi.mock("./auth", () => ({
  APENKAAS_API: "http://ak/api/t",
  authFetch: (u: string, i?: RequestInit) => fetch(u, i),
  getSessie: () => ({ userId: "u1" }),
}));
```

Voeg toe:

```ts
describe("leesrecht voor de server", () => {
  it("maakt een nieuw document aan met app-leesrecht", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ id: "n1" }), { status: 200 }); }
      return new Response(JSON.stringify({ documents: [] }), { status: 200 });
    }));
    await laadInstellingen();
    expect(body.readPermissions).toEqual(["user:u1", "app"]);
    expect(body.writePermissions).toEqual(["user:u1"]);
    expect(body.data.virtuele_accu).toEqual(STANDAARD.virtuele_accu);
  });

  it("zet een bestaand document zonder app-leesrecht om: nieuw aanmaken, oud verwijderen", async () => {
    const calls: string[] = [];
    let nieuwBody: any;
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (init?.method === "POST") { nieuwBody = JSON.parse(init.body as string); return new Response(JSON.stringify({ id: "n2" }), { status: 200 }); }
      if (init?.method === "DELETE") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ documents: [
        { id: "oud", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1"] },
      ] }), { status: 200 });
    }));
    const { id, data } = await laadInstellingen();
    expect(id).toBe("n2");
    expect(data.tarief_piek).toBe(0.3);
    expect(nieuwBody.data.tarief_piek).toBe(0.3);
    expect(calls.some((c) => c.startsWith("DELETE") && c.endsWith("/oud"))).toBe(true);
  });

  it("na een half gelukte omzetting: kiest het document mét app-leesrecht en ruimt het andere op", async () => {
    let posts = 0;
    const verwijderd: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; return new Response("{}", { status: 200 }); }
      if (init?.method === "DELETE") { verwijderd.push(u.split("/").pop()!); return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify({ documents: [
        { id: "oud", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1"] },
        { id: "nieuw", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1", "app"] },
      ] }), { status: 200 });
    }));
    const { id } = await laadInstellingen();
    expect(id).toBe("nieuw");
    expect(posts).toBe(0);
    expect(verwijderd).toEqual(["oud"]);
  });
});
```

De bestaande tests leveren documenten zonder `read_permissions`; die worden nu ook omgezet. Pas in die tests de documenten aan met `read_permissions: ["user:u1", "app"]` zodat ze hun oorspronkelijke gedrag blijven testen (in `"vult ontbrekende velden aan"` en `"bewaren schrijft alleen het eigen deel"`).

- [ ] **Step 2: Draai en zie ze falen**

Run: `cd frontend && npx vitest run src/instellingen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementeer in `frontend/src/instellingen.ts`**

Pas de kopcommentaar aan: "Leesbaar voor de gebruiker én de server (die rekent er de virtuele accu en het display-signaal mee); schrijven alleen door de gebruiker."

```ts
import { APENKAAS_API, authFetch, getSessie } from "./auth";

export interface VirtueleAccu {
  /** "YYYY-MM-DD"; ontbreekt = virtuele accu uit */
  startdatum?: string;
  capaciteit_kwh: number; rendement_pct: number; max_vermogen_kw: number; drempel_w: number;
}
```

Voeg `virtuele_accu: VirtueleAccu;` toe aan `Instellingen` en aan `STANDAARD`:
`virtuele_accu: { capaciteit_kwh: 10, rendement_pct: 90, max_vermogen_kw: 2.5, drempel_w: 300 }`.

Vervang `laad()`:

```ts
interface Doc { id: string; data: Partial<Instellingen>; read_permissions?: string[] }

function rechten() {
  const uid = getSessie()?.userId;
  return { readPermissions: [`user:${uid}`, "app"], writePermissions: [`user:${uid}`] };
}

const heeftApp = (d: Doc) => (d.read_permissions ?? []).includes("app");

async function maak(data: Partial<Instellingen>): Promise<string> {
  const nieuw = await ok(await authFetch(DOCS, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ data, ...rechten() }) }));
  return nieuw.id;
}

const verwijder = (id: string) => authFetch(`${DOCS}/${id}`, { method: "DELETE" }).catch(() => {});

// Eén document per gebruiker, leesbaar voor de server. Apenkaas kan rechten van een
// bestaand document niet wijzigen: een oud document wordt vervangen door een kopie
// met de juiste rechten. Blijft er door een half gelukte omzetting een extra kopie
// over, dan wint het document mét app-leesrecht en gaat de rest weg.
async function laad(): Promise<{ id: string; data: Instellingen }> {
  const docs: Doc[] = (await ok(await authFetch(`${DOCS}?limit=10`))).documents;
  const goed = docs.find(heeftApp);
  if (goed) {
    for (const d of docs) if (d.id !== goed.id) await verwijder(d.id);
    return { id: goed.id, data: { ...STANDAARD, ...goed.data } };
  }
  const oud = docs[0];
  const data = { ...STANDAARD, ...(oud?.data ?? {}) };
  const id = await maak(data);
  for (const d of docs) await verwijder(d.id);
  return { id, data };
}
```

`bewaarInstellingen` blijft gelijk (het gebruikt `laad()` en schrijft naar het gekozen id).

- [ ] **Step 4: Draai tests en build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS; build zonder fouten.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/instellingen.ts frontend/src/instellingen.test.ts
git commit -m "feat(frontend): instellingen leesbaar voor de server, accu-blok, omzetten bestaande documenten"
```

---

### Task 8: Pagina "Virtuele accu"

**Files:**
- Modify: `frontend/src/api.ts`
- Create: `frontend/src/features/accu/DagGrafiek.tsx`
- Create: `frontend/src/routes/VirtueleAccu.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `/accu`, `/display-sleutel` (Task 5, 6); `laadInstellingen`/`bewaarInstellingen`/`VirtueleAccu` (Task 7).
- Produces (in `api.ts`):
  - `interface Signaal { tijd: string; vermogen_w?: number; tarief?: "dal" | "piek"; signaal: string; kleur: string; advies: string; accu?: AccuNu }`
  - `interface AccuNu { laadstatus_pct: number; laadstatus_kwh: number; stand_om: string | null; status: "laden" | "ontladen" | "vol" | "leeg" | "stil"; vermogen_w: number; opbrengst_vandaag_eur: number; opbrengst_sinds_start_eur: { met_saldering: number; zonder_saldering: number } }`
  - `interface AccuDag { datum: string; opbrengst_eur: number; geladen_kwh: number; ontladen_kwh: number; laadstatus_eind_pct: number }`
  - `interface AccuData { instellingen: { startdatum: string | null; capaciteit_kwh: number; rendement_pct: number; max_vermogen_kw: number; drempel_w: number }; nu: Signaal; totaal: { met_saldering: number; zonder_saldering: number; minder_teruggeleverd_kwh: number; minder_ingekocht_kwh: number; cycli: number } | null; dagen: AccuDag[] }`
  - `api.accu(): Promise<AccuData>`, `api.displaySleutel.get(): Promise<{ actief: boolean }>`, `.maak(): Promise<{ sleutel: string }>`, `.intrek(): Promise<{ actief: boolean }>`

- [ ] **Step 1: API-client**

Voeg de interfaces hierboven toe aan `frontend/src/api.ts` en breid `api` uit:

```ts
  accu: () => call<AccuData>("/accu"),
  displaySleutel: {
    get: () => call<{ actief: boolean }>("/display-sleutel"),
    maak: () => call<{ sleutel: string }>("/display-sleutel", { method: "POST" }),
    intrek: () => call<{ actief: boolean }>("/display-sleutel", { method: "DELETE" }),
  },
```

- [ ] **Step 2: Grafiek (`frontend/src/features/accu/DagGrafiek.tsx`)**

```tsx
import React from "react";
import type { AccuDag } from "../../api";

// Staaf = opbrengst per dag (zonder saldering), lijn = laadstatus aan het eind van de dag.
const H = 180, W_STAAF = 14, GAT = 4, MARGE = 28;

export default function DagGrafiek({ dagen }: { dagen: AccuDag[] }) {
  if (dagen.length === 0) return <div style={{ color: "#5d6b78", fontSize: 13 }}>Nog geen dagen om te tonen.</div>;
  const max = Math.max(0.01, ...dagen.map((d) => Math.abs(d.opbrengst_eur)));
  const breedte = MARGE + dagen.length * (W_STAAF + GAT);
  const y = (eur: number) => H / 2 - (eur / max) * (H / 2 - 10);
  const ySoc = (pct: number) => H - 10 - (pct / 100) * (H - 20);
  const x = (i: number) => MARGE + i * (W_STAAF + GAT);
  const lijn = dagen.map((d, i) => `${x(i) + W_STAAF / 2},${ySoc(d.laadstatus_eind_pct)}`).join(" ");
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={breedte} height={H} role="img" aria-label="Opbrengst per dag en laadstatus">
        <line x1={MARGE} x2={breedte} y1={H / 2} y2={H / 2} stroke="#2a3744" />
        <text x={0} y={14} fill="#8b9aa8" fontSize={10}>€{max.toFixed(2)}</text>
        {dagen.map((d, i) => (
          <rect key={d.datum} x={x(i)} width={W_STAAF}
            y={Math.min(y(d.opbrengst_eur), H / 2)} height={Math.abs(y(d.opbrengst_eur) - H / 2)}
            fill={d.opbrengst_eur >= 0 ? "#3ec46d" : "#e8654f"}>
            <title>{`${d.datum}: € ${d.opbrengst_eur.toFixed(2)} · ${d.ontladen_kwh} kWh ontladen · ${d.laadstatus_eind_pct}% eind`}</title>
          </rect>
        ))}
        <polyline points={lijn} fill="none" stroke="#f0a32a" strokeWidth={2} />
      </svg>
      <div style={{ fontSize: 11.5, color: "#5d6b78", marginTop: 6 }}>
        Groen = opbrengst per dag (zonder saldering) · oranje lijn = laadstatus aan het eind van de dag
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Pagina (`frontend/src/routes/VirtueleAccu.tsx`)**

```tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AccuData, ApiFout } from "../api";
import DagGrafiek from "../features/accu/DagGrafiek";
import { bewaarInstellingen, laadInstellingen, STANDAARD, VirtueleAccu as Inst } from "../instellingen";

const C = { bg: "#0f1419", panel: "#171e26", line: "#2a3744", ink: "#e8eef3", sub: "#8b9aa8", dim: "#5d6b78", accent: "#f0a32a", good: "#3ec46d", bad: "#e8654f" };
const paneel = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22, marginBottom: 20 };
const input = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", fontSize: 14, width: "100%", boxSizing: "border-box" as const };
const knop = { background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const euro = (n: number) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vandaag = () => new Date().toISOString().slice(0, 10);
const minDatum = () => new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
const STATUS: Record<string, string> = { laden: "laadt", ontladen: "ontlaadt", vol: "vol", leeg: "leeg", stil: "staat stil" };

export default function VirtueleAccu() {
  const [docId, setDocId] = useState<string | null>(null);
  const [inst, setInst] = useState<Inst>(STANDAARD.virtuele_accu);
  const [advies, setAdvies] = useState<{ capacity?: number; roundTrip?: number }>({});
  const [data, setData] = useState<AccuData | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [geenKoppeling, setGeenKoppeling] = useState(false);
  const [sleutelActief, setSleutelActief] = useState(false);
  const [nieuweSleutel, setNieuweSleutel] = useState<string | null>(null);

  const haal = () => api.accu().then((d) => { setData(d); setMelding(null); }).catch((e) => {
    if (e instanceof ApiFout && (e.code === "geen_koppeling" || e.code === "ha_token")) { setGeenKoppeling(true); return "stop"; }
    setMelding(e instanceof Error ? e.message : String(e));
  });

  useEffect(() => {
    laadInstellingen().then((d) => { setDocId(d.id); setInst({ ...STANDAARD.virtuele_accu, ...d.data.virtuele_accu }); setAdvies(d.data.advies); })
      .catch((e) => setMelding(e instanceof Error ? e.message : String(e)));
    api.displaySleutel.get().then((s) => setSleutelActief(s.actief)).catch(() => {});
    let t: ReturnType<typeof setInterval> | undefined;
    haal().then((r) => { if (r === "stop") clearInterval(t); });
    t = setInterval(() => haal().then((r) => { if (r === "stop") clearInterval(t); }), 30_000);
    return () => clearInterval(t);
  }, []);

  const zet = (k: keyof Inst, v: string) => setInst({ ...inst, [k]: k === "startdatum" ? (v || undefined) : Number(v) });

  const bewaar = async () => {
    if (!docId) return;
    try { await bewaarInstellingen(docId, { virtuele_accu: inst }); setMelding("Opgeslagen ✓ — opnieuw doorgerekend"); await haal(); }
    catch (e) { setMelding(e instanceof Error ? e.message : String(e)); }
  };

  const neemOver = () => setInst({ ...inst, capaciteit_kwh: advies.capacity ?? inst.capaciteit_kwh, rendement_pct: advies.roundTrip ?? inst.rendement_pct });

  const maakSleutel = async () => {
    if (sleutelActief && !window.confirm("De huidige display-sleutel stopt dan met werken. Doorgaan?")) return;
    try { setNieuweSleutel((await api.displaySleutel.maak()).sleutel); setSleutelActief(true); }
    catch (e) { setMelding(e instanceof Error ? e.message : String(e)); }
  };
  const intrek = async () => {
    try { await api.displaySleutel.intrek(); setSleutelActief(false); setNieuweSleutel(null); }
    catch (e) { setMelding(e instanceof Error ? e.message : String(e)); }
  };

  const nu = data?.nu;
  const accu = nu?.accu;

  return (
    <div style={{ background: C.bg, minHeight: "100%", padding: "32px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.accent, fontWeight: 600, marginBottom: 8 }}>Virtuele accu</div>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Wat had een accu gedaan?</h1>
        <p style={{ color: C.sub, fontSize: 14, margin: "0 0 24px", maxWidth: 680, lineHeight: 1.5 }}>
          Kies een startdatum: de accu rekent vanaf die dag mee op je echte meterdata en loopt daarna live door.
          Gerekend met je huidige tarieven.
        </p>
        {melding && <div role="status" style={{ color: C.sub, fontSize: 13, marginBottom: 12 }}>{melding}</div>}
        {geenKoppeling && (
          <div style={{ ...paneel, color: C.sub, fontSize: 14 }}>
            Koppel eerst (opnieuw) je Home Assistant via <Link to="/instellingen" style={{ color: C.accent }}>Instellingen</Link>.
          </div>
        )}

        {nu && (
          <section style={{ ...paneel, borderColor: nu.kleur }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span style={{ width: 16, height: 16, borderRadius: 8, background: nu.kleur, display: "inline-block" }} />
              <b>{nu.advies}</b>
            </div>
            {accu ? (
              <>
                <div style={{ background: C.bg, borderRadius: 8, height: 18, overflow: "hidden", border: `1px solid ${C.line}` }}>
                  <div style={{ width: `${accu.laadstatus_pct}%`, height: "100%", background: C.accent }} />
                </div>
                <div style={{ fontSize: 13, color: C.sub, marginTop: 8 }}>
                  {accu.laadstatus_pct}% ({accu.laadstatus_kwh} kWh){accu.stand_om && ` · stand om ${accu.stand_om}`} ·
                  nu: {STATUS[accu.status]}{accu.vermogen_w > 0 && ` met ${Math.round(accu.vermogen_w)} W`} ·
                  vandaag {euro(accu.opbrengst_vandaag_eur)}
                </div>
              </>
            ) : <div style={{ fontSize: 13, color: C.sub }}>Kies hieronder een startdatum om de virtuele accu aan te zetten.</div>}
          </section>
        )}

        {data?.totaal && (
          <section style={paneel}>
            <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>Sinds {data.instellingen.startdatum}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 18, marginBottom: 18 }}>
              <Getal label="Opbrengst zonder saldering" waarde={euro(data.totaal.zonder_saldering)} kleur={C.good} hint="het scenario vanaf 2027" />
              <Getal label="Opbrengst mét saldering" waarde={euro(data.totaal.met_saldering)} hint="nu, t/m 2026 (benadering)" />
              <Getal label="Minder teruggeleverd" waarde={`${Math.round(data.totaal.minder_teruggeleverd_kwh)} kWh`} />
              <Getal label="Minder ingekocht" waarde={`${Math.round(data.totaal.minder_ingekocht_kwh)} kWh`} />
              <Getal label="Volle laadcycli" waarde={data.totaal.cycli.toLocaleString("nl-NL")} />
            </div>
            <DagGrafiek dagen={data.dagen} />
          </section>
        )}

        <section style={{ ...paneel, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Instellen</h2>
          <label style={{ fontSize: 13, color: C.sub }}>Startdatum (ingebruikname)
            <input style={input} type="date" min={minDatum()} max={vandaag()} value={inst.startdatum ?? ""} onChange={(e) => zet("startdatum", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Capaciteit (kWh)
            <input style={input} type="number" min="0.5" step="0.5" value={inst.capaciteit_kwh} onChange={(e) => zet("capaciteit_kwh", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Rendement (%)
            <input style={input} type="number" min="50" max="100" step="1" value={inst.rendement_pct} onChange={(e) => zet("rendement_pct", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Max. laad-/ontlaadvermogen (kW)
            <input style={input} type="number" min="0.5" step="0.1" value={inst.max_vermogen_kw} onChange={(e) => zet("max_vermogen_kw", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Drempel voor het display (W)
            <input style={input} type="number" min="0" step="50" value={inst.drempel_w} onChange={(e) => zet("drempel_w", e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={knop} onClick={bewaar} disabled={!docId}>Opslaan en doorrekenen</button>
            <button style={{ ...knop, background: "transparent", color: C.sub, border: `1px solid ${C.line}` }} onClick={neemOver}>Neem over uit Advies</button>
            {inst.startdatum && <button style={{ ...knop, background: "transparent", color: C.sub, border: `1px solid ${C.line}` }} onClick={() => setInst({ ...inst, startdatum: undefined })}>Accu uitzetten</button>}
          </div>
        </section>

        <section style={{ ...paneel, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Display</h2>
          <p style={{ margin: 0, fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
            Een display kan het signaal hierboven uitlezen met een eigen sleutel. Die sleutel kan alleen dit
            signaal lezen, niets wijzigen.
          </p>
          {nieuweSleutel && (
            <div style={{ background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 10, padding: 12, fontSize: 13 }}>
              <div style={{ marginBottom: 6 }}>Je nieuwe sleutel (wordt maar één keer getoond):</div>
              <code style={{ wordBreak: "break-all", color: C.accent }}>{nieuweSleutel}</code>
              <div style={{ marginTop: 10, color: C.sub }}>Voorbeeld:</div>
              <code style={{ wordBreak: "break-all" }}>{`curl -H "Authorization: Bearer ${nieuweSleutel}" ${window.location.origin}/api/signaal`}</code>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={knop} onClick={maakSleutel}>{sleutelActief ? "Nieuwe sleutel maken" : "Display-sleutel maken"}</button>
            {sleutelActief && <button style={{ ...knop, background: "transparent", color: C.bad, border: `1px solid ${C.line}` }} onClick={intrek}>Intrekken</button>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Getal({ label, waarde, kleur, hint }: { label: string; waarde: string; kleur?: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: kleur ?? C.ink }}>{waarde}</div>
      {hint && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
```

Opmerking bij `advies.roundTrip`: in Advies is dit een percentage (70–98), dus direct bruikbaar als `rendement_pct`.

- [ ] **Step 4: Route en navigatie (`frontend/src/main.tsx`)**

- Import: `import VirtueleAccu from "./routes/VirtueleAccu";`
- In de `nav`, na de Advies-link: `<Link to="/accu" style={link(path.startsWith("/accu"))}>Virtuele accu</Link>`
- In `children`: `{ path: "accu", element: <VirtueleAccu /> },`

- [ ] **Step 5: Tests en build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS; build zonder fouten.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): pagina Virtuele accu met dag-grafiek en display-sleutel"
```

---

### Task 9: Uitrol op apenkaas-test en handmatige controle

**Files:**
- Modify: `deploy/README.md`
- Modify (lokaal, niet committen): `.env`

**Interfaces:**
- Consumes: alles hierboven.

- [ ] **Step 1: Collectie aanmaken met het manifest**

Maak in de apenkaas-console (tenant energy-dash) een tijdelijke niet-publieke setup-sleutel met `data:read`, `data:write`, `storage:read`, `storage:write` en draai vanuit de apenkaas-repo:

```bash
APENKAAS_URL=http://192.168.178.202:3000 APENKAAS_TENANT=<tenant-id> APENKAAS_KEY=<setup-key> \
  node scripts/push.mjs ../energy-dash/apenkaas.json
```

Expected: `collectie 'display_sleutels': aanmaken`, de rest `ongewijzigd`. Verwijder de setup-sleutel daarna.

- [ ] **Step 2: `.env` aanvullen**

Voeg de twee regels uit de uitvoer toe aan `energy-dash/.env`:
`APENKAAS_INSTELLINGEN_COLLECTION_ID=<id instellingen>` en `APENKAAS_DISPLAY_COLLECTION_ID=<id display_sleutels>`.

- [ ] **Step 3: Bouwen en starten**

Run: `cd /Volumes/DATA/dev/energy-dash && docker compose up --build -d && curl -s localhost:8080/api/health`
Expected: `{"status":"ok"}`.

- [ ] **Step 4: Handmatige controle (met Eelko, in de browser)**

1. Open Instellingen of Overzicht: het instellingen-document wordt omgezet (in de apenkaas-console: het document van de gebruiker heeft nu `app` in de leesrechten; er is er maar één).
2. Pagina Virtuele accu: startdatum een maand terug, opslaan → totaal en dag-grafiek verschijnen; laadstatus en signaal kloppen met wat Overzicht toont.
3. Display-sleutel maken, dan:
   `curl -s -H "Authorization: Bearer <sleutel>" http://192.168.178.125:8080/api/signaal` → JSON met `signaal`, `kleur`, `accu`.
4. Nieuwe sleutel maken → de oude geeft 401.
5. Tweede account: ziet niets van de eerste, eigen sleutel werkt alleen voor eigen data.

- [ ] **Step 5: Documentatie**

Voeg aan `deploy/README.md` (na stap 4 "Vul `.env` in") toe:

```markdown
5. **Display (optioneel):** maak op de pagina *Virtuele accu* een display-sleutel.
   Het display leest `GET /api/signaal` met `Authorization: Bearer <sleutel>`
   (of `?sleutel=<sleutel>` voor apparaten zonder headers; die vorm kan in de
   nginx-access-log belanden). Antwoord: `signaal`, `kleur` (hex), `advies`, en
   bij een virtuele accu het blok `accu`. De backend vraagt HA hooguit eens per 10 s.
```

Zorg dat stap 4's `.env`-voorbeeld ook `APENKAAS_INSTELLINGEN_COLLECTION_ID` en `APENKAAS_DISPLAY_COLLECTION_ID` noemt.

- [ ] **Step 6: Commit**

```bash
git add deploy/README.md
git commit -m "docs: display-signaal en nieuwe env-variabelen in de deploy-uitleg"
```
