// auth.ts — inloggen bij Apenkaas en een fetch die het user-JWT meestuurt.
// Sessie in localStorage (blijft ingelogd na herladen, zoals Supabase).
import { useEffect, useState } from "react";

export const APENKAAS_API = `${import.meta.env.VITE_APENKAAS_URL}/api/${import.meta.env.VITE_APENKAAS_TENANT_ID}`;
const KEY = "energy-dash.sessie";

export interface Sessie { accessToken: string; refreshToken: string; userId: string; email: string }

export function getSessie(): Sessie | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}

function setSessie(s: Sessie | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("sessie"));
}

export function useSessie(): Sessie | null {
  const [s, setS] = useState(getSessie);
  useEffect(() => {
    const update = () => setS(getSessie());
    window.addEventListener("sessie", update);
    return () => window.removeEventListener("sessie", update);
  }, []);
  return s;
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${APENKAAS_API}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? `Apenkaas gaf ${r.status}`);
  return j;
}

export async function login(email: string, password: string) {
  const j = await post("/login", { email, password });
  setSessie({ accessToken: j.accessToken, refreshToken: j.refreshToken, userId: j.user.id, email: j.user.email });
}

export async function registreer(email: string, password: string) {
  await post("/register", { email, password });
  await login(email, password);
}

export async function logout() {
  const s = getSessie();
  setSessie(null);
  if (s) await post("/logout", { refreshToken: s.refreshToken }).catch(() => {});
}

let bezigMetVerversen: Promise<boolean> | null = null;

async function ververs(): Promise<boolean> {
  const s = getSessie();
  if (!s) return false;
  try {
    const j = await post("/refresh", { refreshToken: s.refreshToken });
    setSessie({ ...s, accessToken: j.accessToken, refreshToken: j.refreshToken });
    return true;
  } catch {
    setSessie(null);
    return false;
  }
}

export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const doe = () => {
    const h = new Headers(init.headers);
    const s = getSessie();
    if (s) h.set("Authorization", `Bearer ${s.accessToken}`);
    return fetch(url, { ...init, headers: h });
  };
  let r = await doe();
  if (r.status === 401 && getSessie()) {
    // Eén refresh voor alle gelijktijdige 401s: Apenkaas roteert refresh-tokens.
    bezigMetVerversen ??= ververs().finally(() => { bezigMetVerversen = null; });
    if (await bezigMetVerversen) r = await doe();
  }
  if (r.status === 401) setSessie(null);
  return r;
}
