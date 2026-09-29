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

export const api = {
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
