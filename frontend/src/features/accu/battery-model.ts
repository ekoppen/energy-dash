// battery-model.ts
// Pure rekenlogica voor de accu-rendementsanalyse. Geen React, geen UI.
// De HourRecord-structuur wordt gedeeld met de saldering-feature.

export interface HourRecord {
  /** netto import dat uur (kWh) — wat je van het net afnam */
  imp: number;
  /** netto export dat uur (kWh) — wat je terugleverde */
  exp: number;
  /** deel van imp op het daltarief (kWh); alleen bij live HA-data */
  imp_dal?: number;
}

export interface BatterySpec {
  capacity: number; // bruikbare kWh
  roundTrip: number; // 0..1
}

const SOLAR_SHAPE = [
  0, 0, 0, 0, 0, 0.005, 0.02, 0.045, 0.075, 0.1, 0.12, 0.13,
  0.13, 0.12, 0.1, 0.07, 0.04, 0.025, 0.01, 0.003, 0, 0, 0, 0,
];
const LOAD_SHAPE = [
  0.025, 0.02, 0.02, 0.02, 0.02, 0.025, 0.035, 0.05, 0.05, 0.045, 0.04, 0.04,
  0.045, 0.04, 0.04, 0.045, 0.055, 0.075, 0.085, 0.08, 0.065, 0.05, 0.04, 0.03,
];
function normalize(a: number[]): number[] {
  const s = a.reduce((x, y) => x + y, 0);
  return a.map((v) => v / s);
}
const SOLAR_N = normalize(SOLAR_SHAPE);
const LOAD_N = normalize(LOAD_SHAPE);

/** Synthetisch jaar (8760 uur) uit jaartotalen. Alleen voor schatting-modus. */
export function buildTypicalYear(exportYear: number, importYear: number): HourRecord[] {
  const days: { sf: number; lf: number }[] = [];
  for (let d = 0; d < 365; d++) {
    const seasonal = 0.5 + 0.5 * Math.cos((2 * Math.PI * (d - 172)) / 365);
    days.push({ sf: 0.35 + 1.3 * seasonal, lf: 1.25 - 0.5 * seasonal });
  }
  const solarSum = days.reduce((s, x) => s + x.sf, 0);
  const loadSum = days.reduce((s, x) => s + x.lf, 0);
  const hours: HourRecord[] = [];
  for (const day of days) {
    const dayExport = (exportYear * day.sf) / solarSum;
    const dayImport = (importYear * day.lf) / loadSum;
    for (let h = 0; h < 24; h++) {
      hours.push({ exp: dayExport * SOLAR_N[h], imp: dayImport * LOAD_N[h] });
    }
  }
  return hours;
}

/** Kern-simulatie: vult accu met overschot, leegt bij tekort. kWh naar huis. */
export function simulateShifted(hours: HourRecord[], spec: BatterySpec): number {
  let soc = 0;
  let shifted = 0;
  const eff = Math.sqrt(spec.roundTrip);
  for (const h of hours) {
    if (h.exp > 0 && soc < spec.capacity) {
      soc += Math.min(h.exp * eff, spec.capacity - soc);
    }
    if (h.imp > 0 && soc > 0) {
      const used = Math.min(h.imp, soc * eff);
      soc -= used / eff;
      shifted += used;
    }
  }
  return shifted;
}

/** CSV → uurrecords. Laatste twee numerieke kolommen = import,export. */
export function parseHourCsv(text: string): HourRecord[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const rows: number[][] = [];
  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(",", "."));
    const nums = parts.map(Number).filter((n) => !isNaN(n));
    if (nums.length >= 2) rows.push(nums);
  }
  return rows.map((r) => ({
    imp: Math.max(0, r[r.length - 2]),
    exp: Math.max(0, r[r.length - 1]),
  }));
}
