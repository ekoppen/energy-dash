import React, { useState, useMemo, useRef, useEffect } from "react";
import { HourRecord, buildTypicalYear, parseHourCsv } from "../accu/battery-model";
import type { AdviesWaarden } from "../../instellingen";
import {
  analyseSaldering,
  batteryRecovery,
  behaviourEffect,
  Tariffs,
} from "./saldering-model";

// ----------------------------------------------------------------------------
// SalderingImpact — laat zien wat de salderingsstop (vanaf 2027) betekent,
// op basis van je ECHTE HA-uurdata. Drie lagen:
//   1. Jaarrekening mét vs zónder saldering → de kale schade.
//   2. Wat een accu ervan terugwint.
//   3. Wat meer zelf-verbruiken (gedrag) oplevert.
//
// INTEGRATIE: geef `liveHours` (+ `liveHoursSpan`) als prop mee, uit de backend
// die HA recorder-uurstatistieken levert. Zonder die prop: schatting uit
// jaartotalen + CSV-upload als fallback.
// ----------------------------------------------------------------------------

export interface SalderingImpactProps {
  liveHours?: HourRecord[];
  liveHoursSpan?: number;
  defaultPriceImport?: number;
  defaultPriceFeedIn?: number;
  initial?: Partial<AdviesWaarden>;
  onChange?: (w: Partial<AdviesWaarden>) => void;
  initialCsvHours?: HourRecord[] | null;
  onCsv?: (text: string | null) => void;
}

const C = {
  bg: "#0f1419", panel: "#171e26", panel2: "#1d2630", line: "#2a3744",
  ink: "#e8eef3", sub: "#8b9aa8", dim: "#5d6b78",
  import: "#2f6fed", export: "#2e9e3f", exportSoft: "#a5d6a7",
  accent: "#f0a32a", good: "#3ec46d", bad: "#e8654f",
};

const euro = (n: number) => "€ " + Math.round(n).toLocaleString("nl-NL");
const kwh = (n: number) => Math.round(n).toLocaleString("nl-NL") + " kWh";

export default function SalderingImpact({
  liveHours,
  liveHoursSpan,
  defaultPriceImport = 0.2544,
  defaultPriceFeedIn = 0.06,
  initial, onChange, initialCsvHours, onCsv,
}: SalderingImpactProps) {
  const [priceImport, setPriceImport] = useState(initial?.priceImport ?? defaultPriceImport);
  const [priceFeedIn, setPriceFeedIn] = useState(initial?.priceFeedIn ?? defaultPriceFeedIn);
  const [exportYear, setExportYear] = useState(initial?.exportYear ?? 4500);
  const [importYear, setImportYear] = useState(initial?.importYear ?? 3500);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 10);
  const [roundTrip, setRoundTrip] = useState(initial?.roundTrip ?? 90);
  const [shiftPct, setShiftPct] = useState(initial?.shiftPct ?? 20);
  const [csvHours, setCsvHours] = useState<HourRecord[] | null>(initialCsvHours ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange?.({ priceImport, priceFeedIn, exportYear, importYear, capacity, roundTrip, shiftPct });
  }, [priceImport, priceFeedIn, exportYear, importYear, capacity, roundTrip, shiftPct]);

  const effectiveHours = liveHours ?? csvHours;
  const usingReal = !!effectiveHours && effectiveHours.length > 24;

  const hours = useMemo<HourRecord[]>(
    () => (usingReal ? effectiveHours! : buildTypicalYear(exportYear, importYear)),
    [usingReal, effectiveHours, exportYear, importYear]
  );
  const yearScale = useMemo(
    () => (usingReal ? 8760 / (liveHoursSpan ?? effectiveHours!.length) : 1),
    [usingReal, effectiveHours, liveHoursSpan]
  );

  const tariffs: Tariffs = { priceImport, priceFeedIn };

  const impact = useMemo(
    () => analyseSaldering({ hours, tariffs, yearScale }),
    [hours, priceImport, priceFeedIn, yearScale]
  );
  const battery = useMemo(
    () =>
      batteryRecovery({
        hours,
        spec: { capacity, roundTrip: roundTrip / 100 },
        tariffs,
        yearlyImpact: impact.yearlyImpact,
        yearScale,
      }),
    [hours, capacity, roundTrip, priceImport, priceFeedIn, impact.yearlyImpact, yearScale]
  );
  const behaviour = useMemo(
    () => behaviourEffect({ totals: impact.totals, tariffs, shiftFraction: shiftPct / 100 }),
    [impact.totals, priceImport, priceFeedIn, shiftPct]
  );

  const sourceLabel = liveHours
    ? "live uit Home Assistant ✓"
    : csvHours
    ? "geüploade CSV ✓"
    : "schatting uit jaartotalen";

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseHourCsv(String(reader.result));
      if (parsed.length > 24) { setCsvHours(parsed); onCsv?.(String(reader.result)); }
      else alert("Kon niet genoeg uurregels lezen (2 kolommen: verbruik, teruglevering).");
    };
    reader.readAsText(f);
  };

  // Combinatie accu + gedrag, begrensd op de totale schade.
  const combined = Math.min(impact.yearlyImpact, battery.recoveredPerYear + behaviour.savingPerYear);
  const remaining = Math.max(0, impact.yearlyImpact - combined);

  return (
    <div style={{ background: C.bg, minHeight: "100%", padding: "32px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.accent, fontWeight: 600, marginBottom: 8 }}>
            Salderingsstop 2027 · impactanalyse
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, margin: 0, lineHeight: 1.1 }}>Wat kost de salderingsstop jou?</h1>
          <p style={{ color: C.sub, fontSize: 14, marginTop: 10, maxWidth: 660, lineHeight: 1.5 }}>
            Vanaf 2027 vervalt saldering. Je teruglevering is dan nog maar het lage teruglevertarief
            waard in plaats van je volle inkooptarief. Hieronder wat dat jou per jaar kost — en hoeveel
            een accu of slimmer verbruiken ervan terugwint. Databron: {sourceLabel}.
          </p>
        </div>

        {/* De kale schade */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 20 }}>
            <Metric label="Nu (mét saldering)" value={euro(impact.withSaldering.net)} color={C.good} hint="netto variabele stroomkosten/jaar" />
            <Metric label="Vanaf 2027 (zónder)" value={euro(impact.withoutSaldering.net)} color={C.bad} hint="netto variabele stroomkosten/jaar" />
            <Metric label="Salderingsschade" value={"+" + euro(impact.yearlyImpact)} color={C.accent} hint="wat je er per jaar op achteruitgaat" />
            <Metric label="Teruglevering/jaar" value={kwh(impact.totals.gridExport)} color={C.export} hint="verliest waarde vanaf 2027" />
          </div>
        </div>

        {/* Twee tegenmaatregelen */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Wat een accu terugwint</div>
            <Slider label="Bruikbare capaciteit" value={capacity} set={setCapacity} min={2} max={30} step={0.5} unit="kWh" color={C.accent} />
            <Slider label="Rendement (round-trip)" value={roundTrip} set={setRoundTrip} min={70} max={98} step={1} unit="%" color={C.accent} />
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
              <BigNumber value={euro(battery.recoveredPerYear) + " /jaar"} color={C.good} />
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6, lineHeight: 1.5 }}>
                De accu verschuift {kwh(battery.shiftedKwh)} naar eigen gebruik. Resterende schade daarna:
                <b style={{ color: C.ink }}> {euro(battery.remainingImpact)}/jaar</b>.
              </div>
            </div>
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Wat slimmer verbruiken oplevert</div>
            <Slider label="Overschot naar zon-uren verschuiven" value={shiftPct} set={setShiftPct} min={0} max={60} step={5} unit="%" color={C.export} />
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
              <BigNumber value={euro(behaviour.savingPerYear) + " /jaar"} color={C.good} />
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6, lineHeight: 1.5 }}>
                Door {shiftPct}% van je overschot ({kwh(behaviour.shiftedKwh)}) overdag zelf te gebruiken
                — apparaten draaien als de zon schijnt. Gratis, geen investering.
              </div>
            </div>
          </div>
        </div>

        {/* Samenvatting */}
        <div style={{ background: C.panel2, border: `1px solid ${C.accent}44`, borderRadius: 16, padding: 20, marginTop: 20 }}>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: C.ink }}>
            Van de <b style={{ color: C.accent }}>{euro(impact.yearlyImpact)}</b> salderingsschade per jaar
            kun je met accu + gedrag samen zo'n <b style={{ color: C.good }}>{euro(combined)}</b> terugwinnen.
            Er blijft dan <b style={{ color: remaining > 0 ? C.bad : C.good }}>{euro(remaining)}</b> per jaar over.
            {remaining <= 0 && " Je vangt de hele klap op."}
          </div>
        </div>

        {/* Tarieven + databron */}
        <div style={{ display: "grid", gridTemplateColumns: usingReal ? "1fr" : "1fr 1fr", gap: 20, marginTop: 20 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Tarieven</div>
            <Slider label="Inkooptarief stroom" value={priceImport} set={setPriceImport} min={0.1} max={0.45} step={0.005} unit="€/kWh" color={C.import} />
            <Slider label="Teruglevertarief" value={priceFeedIn} set={setPriceFeedIn} min={0} max={0.25} step={0.005} unit="€/kWh" color={C.export} />
          </div>
          {!usingReal && (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Jaarverbruik (schatting)</div>
              <Slider label="Teruglevering per jaar" value={exportYear} set={setExportYear} min={0} max={10000} step={100} unit="kWh" color={C.export} />
              <Slider label="Verbruik per jaar" value={importYear} set={setImportYear} min={0} max={12000} step={100} unit="kWh" color={C.import} />
            </div>
          )}
        </div>

        {!liveHours && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 12.5, color: C.sub, maxWidth: 560, lineHeight: 1.5 }}>
              {csvHours
                ? `${csvHours.length} uren ingeladen — nauwkeurige modus.`
                : "Nu een schatting. Laad je echte uurdata in (of koppel de backend) voor een exact beeld van jouw salderingsschade."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => fileRef.current?.click()} style={{ background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>CSV inladen</button>
              {csvHours && <button onClick={() => { setCsvHours(null); onCsv?.(null); }} style={{ background: "transparent", color: C.sub, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Terug naar schatting</button>}
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
            </div>
          </div>
        )}

        <p style={{ fontSize: 11.5, color: C.dim, marginTop: 24, lineHeight: 1.6, textAlign: "center" }}>
          Indicatief, geen financieel advies. De salderingsstop geldt vanaf 1 januari 2027; tot 2030 geldt
          een wettelijke minimum-terugleververgoeding. Werkelijke bedragen hangen af van je exacte uurpatroon —
          gebruik je eigen HA-uurdata voor de betrouwbaarste uitkomst.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 700, color: color || C.ink, lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: C.dim, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function BigNumber({ value, color }: { value: string; color?: string }) {
  return <div style={{ fontSize: 24, fontWeight: 700, color: color || C.ink, lineHeight: 1 }}>{value}</div>;
}

function Slider({ label, value, set, min, max, step, unit, color }: {
  label: string; value: number; set: (n: number) => void; min: number; max: number; step: number; unit?: string; color?: string;
}) {
  const display = value.toLocaleString("nl-NL", { maximumFractionDigits: 3 }) + (unit ? " " + unit : "");
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: C.ink }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: color || C.ink }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} style={{ width: "100%", accentColor: color || C.accent }} />
    </div>
  );
}
