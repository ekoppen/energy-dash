// uurdata.ts — de geüploade CSV per gebruiker in Apenkaas-storage (bucket uurdata).
// Upload gaat via een presigned POST rechtstreeks naar MinIO; per gebruiker één bestand.
import { APENKAAS_API, authFetch } from "./auth";

const BUCKET = import.meta.env.VITE_APENKAAS_UURDATA_BUCKET_ID;

interface Bestand { id: string; aangemaakt_op: string }

async function lijst(): Promise<Bestand[]> {
  const r = await authFetch(`${APENKAAS_API}/storage/buckets/${BUCKET}/files`);
  if (!r.ok) throw new Error(`Apenkaas gaf ${r.status} bij uurdata`);
  return r.json();
}

export async function laadCsv(): Promise<string | null> {
  const nieuwste = (await lijst()).sort((a, b) => b.aangemaakt_op.localeCompare(a.aangemaakt_op))[0];
  if (!nieuwste) return null;
  const r = await authFetch(`${APENKAAS_API}/storage/files/${nieuwste.id}/download`);
  if (!r.ok) return null;
  const { downloadUrl } = await r.json();
  const bestand = await fetch(downloadUrl);
  return bestand.ok ? bestand.text() : null;
}

const verwijder = (id: string) => authFetch(`${APENKAAS_API}/storage/files/${id}`, { method: "DELETE" });

// Eerst uploaden, pas daarna de oude bestanden weghalen: een mislukte upload
// mag de vorige CSV niet kosten.
export async function bewaarCsv(text: string | null): Promise<void> {
  const oud = await lijst();
  if (text === null) {
    for (const f of oud) await verwijder(f.id);
    return;
  }
  const blob = new Blob([text], { type: "text/csv" });
  const r = await authFetch(`${APENKAAS_API}/storage/buckets/${BUCKET}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bestandsnaam: "uurdata.csv", mimeType: "text/csv", grootte: blob.size }),
  });
  if (!r.ok) throw new Error(`CSV opslaan mislukt (${r.status})`);
  const { id, uploadUrl, fields } = await r.json();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields as Record<string, string>)) form.append(k, v);
  form.append("file", blob);
  let up: Response;
  try { up = await fetch(uploadUrl, { method: "POST", body: form }); }
  catch { await verwijder(id).catch(() => {}); throw new Error("CSV uploaden mislukt (opslag niet bereikbaar)"); }
  if (!up.ok) { await verwijder(id).catch(() => {}); throw new Error(`CSV uploaden mislukt (${up.status})`); }
  for (const f of oud) await verwijder(f.id);
}
