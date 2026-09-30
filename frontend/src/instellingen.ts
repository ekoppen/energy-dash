// instellingen.ts — één Apenkaas-document per gebruiker met tarieven en
// schuifjes. Alleen die gebruiker mag het lezen/schrijven (standaard user:<id>).
import { APENKAAS_API, authFetch } from "./auth";

export interface AdviesWaarden {
  exportYear: number; importYear: number;
  capacity: number; roundTrip: number; shiftPct: number; saldering: "nu" | "af2027";
  accuPrijs: number; levensduur: number;
}
export interface Instellingen {
  tarief_piek: number; tarief_dal: number; tarief_teruglevering: number; tarief_terugleverkosten: number;
  /** netto vaste kosten per maand (vastrecht + netbeheer − vermindering energiebelasting); mag negatief */
  vaste_kosten_maand: number;
  advies: Partial<AdviesWaarden>;
}

export const STANDAARD: Instellingen = { tarief_piek: 0.25439, tarief_dal: 0.233699, tarief_teruglevering: 0.06, tarief_terugleverkosten: 0, vaste_kosten_maand: 0, advies: {} };

const DOCS = `${APENKAAS_API}/collections/${import.meta.env.VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID}/documents`;
const JSON_HEADERS = { "Content-Type": "application/json" };

async function ok(r: Response) {
  if (!r.ok) throw new Error(`Apenkaas gaf ${r.status} bij instellingen`);
  return r.json();
}

async function laad(): Promise<{ id: string; data: Instellingen }> {
  const lijst = await ok(await authFetch(`${DOCS}?limit=1`));
  const doc = lijst.documents[0];
  if (doc) return { id: doc.id, data: { ...STANDAARD, ...doc.data } };
  const nieuw = await ok(await authFetch(DOCS, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ data: STANDAARD }) }));
  return { id: nieuw.id, data: STANDAARD };
}

// Gelijktijdige aanroepen (StrictMode draait effects dubbel) delen één verzoek,
// anders ontstaan bij de eerste login twee documenten.
let bezig: Promise<{ id: string; data: Instellingen }> | null = null;
export function laadInstellingen() {
  bezig ??= laad().finally(() => { bezig = null; });
  return bezig;
}

// Elke pagina schrijft alleen haar eigen deel: we laden eerst de actuele versie
// en leggen daar alleen `deel` overheen, zodat Instellingen en Advies elkaars
// sleutels niet met een oude kopie overschrijven.
export async function bewaarInstellingen(id: string, deel: Partial<Instellingen>): Promise<void> {
  const { data } = await laad();
  await ok(await authFetch(`${DOCS}/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ data: { ...data, ...deel } }) }));
}
