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
        self._live_fout: dict[str, tuple[float, Exception]] = {}
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
        fout = self._live_fout.get(uid)
        if fout and nu - fout[0] < LIVE_TTL_S:
            raise fout[1]  # HA was net stuk: niet elke poll opnieuw proberen
        try:
            data = await self._haal_nu(k)
        except Exception as e:
            self._live_fout[uid] = (nu, e)
            raise
        self._live_fout.pop(uid, None)
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

    async def volledig(self, uid: str, k: dict, vers: bool = False) -> dict:
        if vers:
            self._inst.pop(uid, None)
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
