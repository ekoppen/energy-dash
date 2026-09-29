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

export async function bewaarCsv(text: string | null): Promise<void> {
  for (const f of await lijst()) {
    await authFetch(`${APENKAAS_API}/storage/files/${f.id}`, { method: "DELETE" });
  }
  if (text === null) return;
  const blob = new Blob([text], { type: "text/csv" });
  const r = await authFetch(`${APENKAAS_API}/storage/buckets/${BUCKET}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bestandsnaam: "uurdata.csv", mimeType: "text/csv", grootte: blob.size }),
  });
  if (!r.ok) throw new Error(`CSV opslaan mislukt (${r.status})`);
  const { uploadUrl, fields } = await r.json();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields as Record<string, string>)) form.append(k, v);
  form.append("file", blob);
  const up = await fetch(uploadUrl, { method: "POST", body: form });
  if (!up.ok) throw new Error(`CSV uploaden mislukt (${up.status})`);
}
