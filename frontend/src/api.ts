// api.ts — praat met de backend-proxy, nooit direct met Home Assistant.
import type { HourRecord } from "./features/accu/battery-model";
import { authFetch } from "./auth";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiFout extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, melding: string) {
    super(melding);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${BASE}${path}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFout(r.status, j.detail?.code ?? "onbekend", j.detail?.melding ?? `API ${path} → ${r.status}`);
  return j as T;
}

export interface NowData { vermogen_w: number; actief_tarief: "dal" | "piek" }
export interface KoppelingStatus { gekoppeld: boolean; ha_url: string | null }

export interface AccuNu { laadstatus_pct: number; laadstatus_kwh: number; stand_om: string | null; status: "laden" | "ontladen" | "vol" | "leeg" | "stil"; vermogen_w: number; opbrengst_vandaag_eur: number; opbrengst_sinds_start_eur: { met_saldering: number; zonder_saldering: number } }
export interface Signaal { tijd: string; vermogen_w?: number; tarief?: "dal" | "piek"; signaal: string; kleur: string; advies: string; accu?: AccuNu }
export interface AccuDag { datum: string; opbrengst_eur: number; geladen_kwh: number; ontladen_kwh: number; laadstatus_eind_pct: number }
export interface AccuData { instellingen: { startdatum: string | null; capaciteit_kwh: number; rendement_pct: number; max_vermogen_kw: number; drempel_w: number }; nu: Signaal; totaal: { met_saldering: number; zonder_saldering: number; minder_teruggeleverd_kwh: number; minder_ingekocht_kwh: number; cycli: number } | null; dagen: AccuDag[] }

export const api = {
  accu: () => call<AccuData>("/accu"),
  displaySleutel: {
    get: () => call<{ actief: boolean }>("/display-sleutel"),
    maak: () => call<{ sleutel: string }>("/display-sleutel", { method: "POST" }),
    intrek: () => call<{ actief: boolean }>("/display-sleutel", { method: "DELETE" }),
  },
  now: () => call<NowData>("/now"),
  hours: (days = 365) => call<HourRecord[]>(`/hours?days=${days}`),
  koppeling: {
    get: () => call<KoppelingStatus>("/koppeling"),
    put: (ha_url: string, ha_token: string) => call<KoppelingStatus>("/koppeling", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ha_url, ha_token }),
    }),
    delete: () => call<KoppelingStatus>("/koppeling", { method: "DELETE" }),
  },
};
