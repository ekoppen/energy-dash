// instellingen.ts — één Apenkaas-document per gebruiker met tarieven en
// schuifjes. Leesbaar voor de gebruiker én de server (die rekent er de virtuele accu
// en het display-signaal mee); schrijven alleen door de gebruiker.
import { APENKAAS_API, authFetch, getSessie } from "./auth";

export interface VirtueleAccu {
  /** "YYYY-MM-DD"; ontbreekt = virtuele accu uit */
  startdatum?: string;
  capaciteit_kwh: number; rendement_pct: number; max_vermogen_kw: number; drempel_w: number;
}

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
  virtuele_accu: VirtueleAccu;
}

export const STANDAARD: Instellingen = { tarief_piek: 0.25439, tarief_dal: 0.233699, tarief_teruglevering: 0.06, tarief_terugleverkosten: 0, vaste_kosten_maand: 0, advies: {},
  virtuele_accu: { capaciteit_kwh: 10, rendement_pct: 90, max_vermogen_kw: 2.5, drempel_w: 300 } };

const DOCS = `${APENKAAS_API}/collections/${import.meta.env.VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID}/documents`;
const JSON_HEADERS = { "Content-Type": "application/json" };

async function ok(r: Response) {
  if (!r.ok) throw new Error(`Apenkaas gaf ${r.status} bij instellingen`);
  return r.json();
}

interface Doc { id: string; data: Partial<Instellingen>; read_permissions?: string[] }

function rechten() {
  const uid = getSessie()?.userId;
  return { readPermissions: [`user:${uid}`, "app"], writePermissions: [`user:${uid}`] };
}

const heeftApp = (d: Doc) => (d.read_permissions ?? []).includes("app");

async function maak(data: Partial<Instellingen>): Promise<string> {
  const nieuw = await ok(await authFetch(DOCS, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ data, ...rechten() }) }));
  return nieuw.id;
}

const verwijder = (id: string) => authFetch(`${DOCS}/${id}`, { method: "DELETE" }).catch(() => {});

// Eén document per gebruiker, leesbaar voor de server. Apenkaas kan rechten van een
// bestaand document niet wijzigen: een oud document wordt vervangen door een kopie
// met de juiste rechten. Blijft er door een half gelukte omzetting een extra kopie
// over, dan wint het document mét app-leesrecht en gaat de rest weg.
async function laad(): Promise<{ id: string; data: Instellingen }> {
  const docs: Doc[] = (await ok(await authFetch(`${DOCS}?limit=10`))).documents;
  const goed = docs.find(heeftApp);
  if (goed) {
    for (const d of docs) if (d.id !== goed.id) await verwijder(d.id);
    return { id: goed.id, data: { ...STANDAARD, ...goed.data } };
  }
  const oud = docs[0];
  const data = { ...STANDAARD, ...(oud?.data ?? {}) };
  const id = await maak(data);
  for (const d of docs) await verwijder(d.id);
  return { id, data };
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
