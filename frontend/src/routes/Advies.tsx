import React, { useEffect, useState } from "react";
import AccuSimulatie from "../features/accu/AccuSimulatie";
import SalderingImpact from "../features/saldering/SalderingImpact";
import type { HourRecord } from "../features/accu/battery-model";
import { api, ConfigData } from "../api";

// Advies-dashboard: hosts de saldering-impact analyse en de accu-simulatie.
// Probeert echte uurdata + tarieven uit de backend te halen; lukt dat niet
// (endpoint nog TODO, of backend offline), dan draaien de features in
// schatting-modus zodat het scherm altijd bruikbaar is.

export default function Advies() {
  const [hours, setHours] = useState<HourRecord[] | undefined>(undefined);
  const [cfg, setCfg] = useState<ConfigData | undefined>(undefined);
  const [tab, setTab] = useState<"saldering" | "accu">("saldering");

  useEffect(() => {
    api.config().then(setCfg).catch(() => {});
    api.hours(365).then((h) => {
      if (Array.isArray(h) && h.length > 24) setHours(h);
    }).catch(() => {
      // /hours nog niet geïmplementeerd of backend offline → schatting-modus.
    });
  }, []);

  const tabBtn = (active: boolean) => ({
    background: active ? "#171e26" : "transparent",
    color: active ? "#f0a32a" : "#8b9aa8",
    border: "1px solid " + (active ? "#f0a32a55" : "#2a3744"),
    borderRadius: 10, padding: "8px 16px", cursor: "pointer",
    fontWeight: 600, fontSize: 13.5, fontFamily: "'Inter', system-ui, sans-serif",
  });

  const pi = cfg?.tarief_piek ?? 0.2544;
  const pf = cfg?.tarief_teruglevering ?? 0.06;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: "16px 20px 0", background: "#0f1419" }}>
        <button style={tabBtn(tab === "saldering")} onClick={() => setTab("saldering")}>Salderingsstop 2027</button>
        <button style={tabBtn(tab === "accu")} onClick={() => setTab("accu")}>Accu-analyse</button>
      </div>
      {tab === "saldering" ? (
        <SalderingImpact liveHours={hours} liveHoursSpan={hours?.length} defaultPriceImport={pi} defaultPriceFeedIn={pf} />
      ) : (
        <AccuSimulatie liveHours={hours} liveHoursSpan={hours?.length} defaultPriceImport={pi} defaultPriceFeedIn={pf} />
      )}
    </div>
  );
}
