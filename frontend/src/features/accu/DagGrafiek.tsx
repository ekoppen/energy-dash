import React, { useEffect, useRef, useState } from "react";
import type { AccuDag } from "../../api";

// Twee kleine grafieken met dezelfde datum-as (nooit twee schalen in één grafiek):
// boven de opbrengst per dag in €, onder de laadstatus aan het eind van de dag in %.
// Beweeg (of tik) over een dag voor de details; onderaan staat alles ook als tabel.

const C = { ink: "#e8eef3", sub: "#8b9aa8", dim: "#5d6b78", grid: "#232e3a", staaf: "#4fb0c6", lijn: "#f0a32a", hover: "#ffffff10" };
const LINKS = 52, RECHTS = 8, H_EURO = 150, H_SOC = 90, H_AS = 22, MIN_SLOT = 4;

const euro = (n: number) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const datumKort = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

/** Ronde as-waarden (0, 0,5, 1, 1,5 …) die min en max omvatten. */
export function asStappen(min: number, max: number, doel = 4): number[] {
  const bereik = Math.max(max - min, 0.01);
  const ruw = bereik / doel;
  const macht = 10 ** Math.floor(Math.log10(ruw));
  const stap = [1, 2, 2.5, 5, 10].map((f) => f * macht).find((s) => s >= ruw)!;
  const stappen: number[] = [];
  for (let v = Math.floor(min / stap) * stap; v <= max + stap * 1e-9; v += stap) stappen.push(Math.round(v * 1e6) / 1e6);
  if (stappen[stappen.length - 1] < max) stappen.push(Math.round((stappen[stappen.length - 1] + stap) * 1e6) / 1e6);
  return stappen;
}

function useBreedte<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [breedte, setBreedte] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setBreedte(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, breedte] as const;
}

export default function DagGrafiek({ dagen }: { dagen: AccuDag[] }) {
  const [ref, beschikbaar] = useBreedte<HTMLDivElement>();
  const [actief, setActief] = useState<number | null>(null);
  if (dagen.length === 0) return <div ref={ref} style={{ color: C.dim, fontSize: 13 }}>Nog geen dagen om te tonen.</div>;

  // ponytail: bij heel veel dagen (smalle slots) scrolt de grafiek horizontaal i.p.v. te aggregeren per week.
  const slot = Math.max(MIN_SLOT, (beschikbaar - LINKS - RECHTS) / dagen.length);
  const breedte = LINKS + RECHTS + slot * dagen.length;
  const x = (i: number) => LINKS + i * slot;
  const staafB = Math.max(2, slot - 2); // 2px ruimte tussen staven

  const stappen = asStappen(Math.min(0, ...dagen.map((d) => d.opbrengst_eur)), Math.max(0, ...dagen.map((d) => d.opbrengst_eur)));
  const [lo, hi] = [stappen[0], stappen[stappen.length - 1]];
  const yE = (eur: number) => 8 + (H_EURO - 16) * (1 - (eur - lo) / (hi - lo));
  const yS = (pct: number) => 6 + (H_SOC - 12) * (1 - pct / 100);

  const lijn = dagen.map((d, i) => `${x(i) + slot / 2},${yS(d.laadstatus_eind_pct)}`).join(" ");
  const vlak = `${x(0) + slot / 2},${yS(0)} ${lijn} ${x(dagen.length - 1) + slot / 2},${yS(0)}`;
  const elkeN = Math.max(1, Math.ceil(70 / slot)); // ~70px per datumlabel

  const kies = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - LINKS) / slot);
    setActief(i >= 0 && i < dagen.length ? i : null);
  };
  const d = actief !== null ? dagen[actief] : null;
  const markering = actief !== null && <rect x={x(actief)} width={slot} y={0} height="100%" fill={C.hover} />;
  const svgProps = { width: breedte, onPointerMove: kies, onPointerDown: kies, onPointerLeave: () => setActief(null), style: { display: "block", touchAction: "pan-y" } };
  const titel = (t: string) => <div style={{ fontSize: 12.5, color: C.sub, margin: "14px 0 4px" }}>{t}</div>;

  return (
    <div ref={ref}>
      <div style={{ minHeight: 20, fontSize: 13, color: d ? C.ink : C.dim }} aria-live="polite">
        {d ? `${datumKort(d.datum)}: ${euro(d.opbrengst_eur)} · ${d.geladen_kwh.toLocaleString("nl-NL")} kWh geladen · ${d.ontladen_kwh.toLocaleString("nl-NL")} kWh ontladen · eind ${d.laadstatus_eind_pct}%`
           : "Beweeg over een dag voor de details."}
      </div>
      <div style={{ overflowX: "auto" }}>
        {titel("Opbrengst per dag (zonder saldering)")}
        <svg {...svgProps} height={H_EURO} role="img" aria-label="Opbrengst per dag in euro">
          {markering}
          {stappen.map((s) => (
            <g key={s}>
              <line x1={LINKS} x2={breedte - RECHTS} y1={yE(s)} y2={yE(s)} stroke={s === 0 ? C.dim : C.grid} />
              <text x={LINKS - 6} y={yE(s) + 4} textAnchor="end" fill={C.sub} fontSize={11}>{euro(s)}</text>
            </g>
          ))}
          {dagen.map((dag, i) => {
            const y0 = yE(0), y1 = yE(dag.opbrengst_eur);
            return <rect key={dag.datum} x={x(i) + 1} width={staafB} y={Math.min(y0, y1)} height={Math.max(1, Math.abs(y1 - y0))} rx={Math.min(2, staafB / 2)} fill={C.staaf} opacity={actief === null || actief === i ? 1 : 0.55} />;
          })}
        </svg>

        {titel("Laadstatus aan het eind van de dag")}
        <svg {...svgProps} height={H_SOC + H_AS} role="img" aria-label="Laadstatus aan het eind van de dag in procent">
          {markering}
          {[0, 50, 100].map((p) => (
            <g key={p}>
              <line x1={LINKS} x2={breedte - RECHTS} y1={yS(p)} y2={yS(p)} stroke={p === 0 ? C.dim : C.grid} />
              <text x={LINKS - 6} y={yS(p) + 4} textAnchor="end" fill={C.sub} fontSize={11}>{p}%</text>
            </g>
          ))}
          <polygon points={vlak} fill={C.lijn} opacity={0.12} />
          <polyline points={lijn} fill="none" stroke={C.lijn} strokeWidth={2} strokeLinejoin="round" />
          {d && <circle cx={x(actief!) + slot / 2} cy={yS(d.laadstatus_eind_pct)} r={4} fill={C.lijn} stroke="#171e26" strokeWidth={2} />}
          {dagen.map((dag, i) => i % elkeN === 0 && (
            <text key={dag.datum} x={x(i) + slot / 2} y={H_SOC + 16} textAnchor="middle" fill={C.sub} fontSize={11}>{datumKort(dag.datum)}</text>
          ))}
        </svg>
      </div>

      <details style={{ marginTop: 10, fontSize: 12.5, color: C.sub }}>
        <summary style={{ cursor: "pointer" }}>Toon als tabel</summary>
        <table style={{ marginTop: 8, borderCollapse: "collapse", width: "100%", color: C.ink }}>
          <thead><tr style={{ color: C.sub, textAlign: "right" }}>
            <th style={{ textAlign: "left" }}>Datum</th><th>Opbrengst</th><th>Geladen</th><th>Ontladen</th><th>Eind</th>
          </tr></thead>
          <tbody>{dagen.map((dag) => (
            <tr key={dag.datum} style={{ textAlign: "right", borderTop: "1px solid #2a3744" }}>
              <td style={{ textAlign: "left" }}>{dag.datum}</td><td>{euro(dag.opbrengst_eur)}</td>
              <td>{dag.geladen_kwh.toLocaleString("nl-NL")} kWh</td><td>{dag.ontladen_kwh.toLocaleString("nl-NL")} kWh</td><td>{dag.laadstatus_eind_pct}%</td>
            </tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  );
}
