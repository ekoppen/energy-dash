import React, { useState, useMemo, useRef, useEffect } from "react";
import { HourRecord, buildTypicalYear, simulateShifted, parseHourCsv } from "./battery-model";
import type { AdviesWaarden } from "../../instellingen";

// Accu-rendementsanalyse. Rekenlogica in battery-model.ts; hier UI + state.
// Geef optioneel `liveHours` mee (echte HA-uurdata via backend) voor de
// nauwkeurige modus; anders schatting uit jaartotalen + CSV-fallback.

export interface AccuSimulatieProps {
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
const euro2 = (n: number) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kwh = (n: number) => Math.round(n).toLocaleString("nl-NL") + " kWh";

export default function AccuSimulatie({
  liveHours, liveHoursSpan, defaultPriceImport = 0.2544, defaultPriceFeedIn = 0.06,
  initial, onChange, initialCsvHours, onCsv,
}: AccuSimulatieProps) {
  const [priceImport, setPriceImport] = useState(defaultPriceImport);
  const [priceFeedIn, setPriceFeedIn] = useState(defaultPriceFeedIn);
  const [saldering, setSaldering] = useState<"nu" | "af2027">(initial?.saldering ?? "af2027");
  const [exportYear, setExportYear] = useState(initial?.exportYear ?? 4500);
  const [importYear, setImportYear] = useState(initial?.importYear ?? 3500);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 10);
  const [roundTrip, setRoundTrip] = useState(initial?.roundTrip ?? 90);
  const [price, setPrice] = useState(initial?.accuPrijs ?? 4500);
  const [lifespan, setLifespan] = useState(initial?.levensduur ?? 12);
  const [csvHours, setCsvHours] = useState<HourRecord[] | null>(initialCsvHours ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange?.({ saldering, exportYear, importYear, capacity, roundTrip, accuPrijs: price, levensduur: lifespan });
  }, [saldering, exportYear, importYear, capacity, roundTrip, price, lifespan]);

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

  const r = useMemo(() => {
    const shifted = simulateShifted(hours, { capacity, roundTrip: roundTrip / 100 }) * yearScale;
    const valuePerKwh = saldering === "nu"
      ? (priceImport - priceFeedIn) * 0.15
      : priceImport - priceFeedIn;
    const yearly = shifted * valuePerKwh;
    const payback = yearly > 0 ? price / yearly : Infinity;
    const net = yearly * lifespan - price;
    const roi = (net / price) * 100;
    const caught = (shifted / Math.max(exportYear, 1)) * 100;
    return { shifted, valuePerKwh, yearly, payback, net, roi, caught };
  }, [hours, capacity, roundTrip, yearScale, saldering, priceImport, priceFeedIn, price, lifespan, exportYear]);

  const ok = r.payback <= lifespan;
  const sourceLabel = liveHours ? "live uit Home Assistant ✓" : csvHours ? "geüploade CSV ✓" : "schatting uit jaartotalen";

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

  return (
    <div style={{ background: C.bg, minHeight: "100%", padding: "32px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.accent, fontWeight: 600, marginBottom: 8 }}>Thuisaccu · rendementsanalyse</div>
          <h1 style={{ fontSize: 30, fontWeight: 700, margin: 0, lineHeight: 1.1 }}>Loont een accu in jouw situatie?</h1>
          <p style={{ color: C.sub, fontSize: 14, marginTop: 10, maxWidth: 640, lineHeight: 1.5 }}>
            De simulatie laadt je teruglevering virtueel in een accu en haalt 'm eruit zodra je verbruikt. Databron: {sourceLabel}.
          </p>
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 20 }}>
            <Metric label="Terugverdientijd" value={r.payback === Infinity ? "—" : r.payback.toFixed(1) + " jaar"} color={r.payback === Infinity ? C.dim : ok ? C.good : C.bad} hint={r.payback === Infinity ? "geen besparing" : ok ? "binnen levensduur" : "te lang"} />
            <Metric label="Besparing per jaar" value={euro(r.yearly)} color={C.import} />
            <Metric label="Resultaat over leven" value={euro(r.net)} color={r.net >= 0 ? C.good : C.bad} hint={`${lifespan} jaar`} />
            <Metric label="ROI" value={(r.roi >= 0 ? "+" : "") + r.roi.toFixed(0) + "%"} color={r.roi >= 0 ? C.good : C.bad} />
          </div>
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.line}`, fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
            De accu vangt ~<b style={{ color: C.exportSoft }}>{kwh(r.shifted)}</b> per jaar op (≈{r.caught.toFixed(0)}%), ter waarde van <b style={{ color: C.ink }}>{euro2(r.valuePerKwh)}</b>/kWh.
            {saldering === "nu" && <span style={{ color: C.accent }}> Zet op "vanaf 2027" voor het relevante scenario.</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <Panel title="De accu">
            <Slider label="Bruikbare capaciteit" value={capacity} set={setCapacity} min={2} max={30} step={0.5} unit="kWh" color={C.accent} />
            <Slider label="Aanschaf + installatie" value={price} set={setPrice} min={1500} max={12000} step={100} fmt={euro} color={C.accent} />
            <Slider label="Levensduur" value={lifespan} set={setLifespan} min={5} max={20} step={1} unit="jaar" color={C.accent} />
            <Slider label="Rendement" value={roundTrip} set={setRoundTrip} min={70} max={98} step={1} unit="%" color={C.accent} />
          </Panel>
          <Panel title="Tarieven & verbruik">
            <Slider label="Inkooptarief" value={priceImport} set={setPriceImport} min={0.1} max={0.45} step={0.005} unit="€/kWh" color={C.import} />
            <Slider label="Teruglevertarief" value={priceFeedIn} set={setPriceFeedIn} min={0} max={0.25} step={0.005} unit="€/kWh" color={C.export} />
            <Slider label="Teruglevering/jaar" value={exportYear} set={setExportYear} min={0} max={10000} step={100} unit="kWh" color={C.export} disabled={usingReal} />
            <Slider label="Verbruik/jaar" value={importYear} set={setImportYear} min={0} max={12000} step={100} unit="kWh" color={C.import} disabled={usingReal} />
          </Panel>
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>Salderingsscenario</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Toggle active={saldering === "nu"} onClick={() => setSaldering("nu")} label="Nu (saldering)" sub="t/m 2026" />
            <Toggle active={saldering === "af2027"} onClick={() => setSaldering("af2027")} label="Vanaf 2027" sub="saldering gestopt" />
          </div>
        </div>
        {!liveHours && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 12.5, color: C.sub, maxWidth: 560, lineHeight: 1.5 }}>
              {csvHours ? `${csvHours.length} uren ingeladen.` : "Schatting. Laad uurdata in of koppel de backend voor een exact resultaat."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => fileRef.current?.click()} style={{ background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>CSV inladen</button>
              {csvHours && <button onClick={() => { setCsvHours(null); onCsv?.(null); }} style={{ background: "transparent", color: C.sub, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Terug</button>}
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return <div><div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 700, color: color || C.ink, lineHeight: 1 }}>{value}</div>{hint && <div style={{ fontSize: 11, color: C.dim, marginTop: 5 }}>{hint}</div>}</div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }}><div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 16, textTransform: "uppercase", letterSpacing: 1 }}>{title}</div>{children}</div>;
}
function Slider({ label, value, set, min, max, step, unit, fmt, color, disabled }: { label: string; value: number; set: (n: number) => void; min: number; max: number; step: number; unit?: string; fmt?: (n: number) => string; color?: string; disabled?: boolean; }) {
  const display = fmt ? fmt(value) : value.toLocaleString("nl-NL", { maximumFractionDigits: 3 }) + (unit ? " " + unit : "");
  return <div style={{ marginBottom: 16, opacity: disabled ? 0.4 : 1 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}><span style={{ fontSize: 13, color: C.ink }}>{label}</span><span style={{ fontSize: 13, fontWeight: 600, color: color || C.ink }}>{display}</span></div><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => set(Number(e.target.value))} style={{ width: "100%", accentColor: color || C.accent }} /></div>;
}
function Toggle({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return <button onClick={onClick} style={{ background: active ? C.accent : "transparent", color: active ? "#1a1205" : C.sub, border: `1px solid ${active ? C.accent : C.line}`, borderRadius: 10, padding: "10px 18px", cursor: "pointer", textAlign: "left" }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div><div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{sub}</div></button>;
}
