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
