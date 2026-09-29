// api.ts — praat met de backend-proxy, nooit direct met Home Assistant.
import type { HourRecord } from "./features/accu/battery-model";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`API ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export interface NowData {
  vermogen_w: number;
  actief_tarief: "dal" | "piek";
  prijs_kwh: number;
}
export interface ConfigData {
  tarief_piek: number;
  tarief_dal: number;
  tarief_teruglevering: number;
}

export const api = {
  now: () => get<NowData>("/now"),
  config: () => get<ConfigData>("/config"),
  // Uurdata voor accu- en saldering-features. Backend-endpoint is nog TODO
  // (fase 1); tot die tijd vangen de componenten dit af met schatting/CSV.
  hours: (days = 365) => get<HourRecord[]>(`/hours?days=${days}`),
};
