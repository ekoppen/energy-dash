import React, { useEffect, useRef, useState } from "react";
import AccuSimulatie from "../features/accu/AccuSimulatie";
import SalderingImpact from "../features/saldering/SalderingImpact";
import { gemiddeldInkooptarief } from "../features/saldering/saldering-model";
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
  const pending = useRef<{ id: string; advies: Partial<AdviesWaarden> } | null>(null);
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
    return () => {
      // Nog niet bewaarde wijziging niet weggooien maar meteen wegschrijven.
      clearTimeout(timer.current);
      const wacht = pending.current;
      pending.current = null;
      if (wacht) bewaarInstellingen(wacht.id, { advies: wacht.advies }).catch(() => {});
    };
  }, []);

  const onChange = (w: Partial<AdviesWaarden>) => {
    const huidig = docRef.current;
    if (!huidig) return;
    const volgende = { ...huidig, data: { ...huidig.data, advies: { ...huidig.data.advies, ...w } } };
    setDoc(volgende);
    clearTimeout(timer.current);
    pending.current = { id: volgende.id, advies: volgende.data.advies };
    timer.current = setTimeout(() => {
      pending.current = null;
      bewaarInstellingen(volgende.id, { advies: volgende.data.advies }).catch(() => setMelding("Opslaan mislukt — probeer het later opnieuw."));
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
    defaultPriceImport: gemiddeldInkooptarief(hours ?? csvHours ?? undefined, doc?.data.tarief_piek ?? 0.2544, doc?.data.tarief_dal ?? 0.2337),
    defaultPriceFeedIn: doc?.data.tarief_teruglevering ?? 0.06,
    defaultExportCost: doc?.data.tarief_terugleverkosten ?? 0,
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
      {/* key: opnieuw opbouwen zodra live uurdata binnenkomt, zodat de gewogen inkoopprijs meeloopt */}
      {tab === "saldering" ? <SalderingImpact key={hours ? "live" : "geen"} {...props} /> : <AccuSimulatie key={hours ? "live" : "geen"} {...props} />}
    </div>
  );
}
