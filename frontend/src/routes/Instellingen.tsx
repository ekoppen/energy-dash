import React, { useEffect, useState } from "react";
import { api, ApiFout, KoppelingStatus } from "../api";
import { bewaarInstellingen, Instellingen as Inst, laadInstellingen } from "../instellingen";

const C = { bg: "#0f1419", panel: "#171e26", line: "#2a3744", ink: "#e8eef3", sub: "#8b9aa8", accent: "#f0a32a", good: "#3ec46d", bad: "#e8654f" };
const input = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, width: "100%", boxSizing: "border-box" as const };
const knop = { background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const paneel = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, marginBottom: 20, display: "grid", gap: 14 };
const melding = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Instellingen() {
  const [doc, setDoc] = useState<{ id: string; data: Inst } | null>(null);
  const [tarievenStatus, setTarievenStatus] = useState<string | null>(null);
  const [koppeling, setKoppeling] = useState<KoppelingStatus | null>(null);
  const [haUrl, setHaUrl] = useState("");
  const [haToken, setHaToken] = useState("");
  const [koppelStatus, setKoppelStatus] = useState<{ ok: boolean; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    laadInstellingen().then(setDoc).catch((e) => setTarievenStatus(melding(e)));
    api.koppeling.get().then(setKoppeling).catch((e) => setKoppelStatus({ ok: false, tekst: melding(e) }));
  }, []);

  const zetTarief = (key: "tarief_piek" | "tarief_dal" | "tarief_teruglevering", v: string) =>
    doc && setDoc({ ...doc, data: { ...doc.data, [key]: Number(v) } });

  const bewaarTarieven = async () => {
    if (!doc) return;
    const { tarief_piek, tarief_dal, tarief_teruglevering } = doc.data;
    try { await bewaarInstellingen(doc.id, { tarief_piek, tarief_dal, tarief_teruglevering }); setTarievenStatus("Opgeslagen ✓"); }
    catch (e) { setTarievenStatus(melding(e)); }
  };

  const koppel = async (e: React.FormEvent) => {
    e.preventDefault();
    setBezig(true);
    setKoppelStatus(null);
    try {
      setKoppeling(await api.koppeling.put(haUrl, haToken));
      setHaToken("");
      setKoppelStatus({ ok: true, tekst: "Verbinding gelukt, P1-meter gevonden ✓" });
    } catch (err) {
      setKoppelStatus({ ok: false, tekst: err instanceof ApiFout ? err.message : melding(err) });
    } finally {
      setBezig(false);
    }
  };

  const ontkoppel = async () => {
    try { setKoppeling(await api.koppeling.delete()); setKoppelStatus(null); }
    catch (e) { setKoppelStatus({ ok: false, tekst: melding(e) }); }
  };

  return (
    <div style={{ background: C.bg, minHeight: "100%", padding: "32px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 24px" }}>Instellingen</h1>

        <section style={paneel}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Tarieven (€/kWh)</h2>
          {doc && (["tarief_piek", "tarief_dal", "tarief_teruglevering"] as const).map((k) => (
            <label key={k} style={{ fontSize: 13, color: C.sub }}>
              {{ tarief_piek: "Piek", tarief_dal: "Dal", tarief_teruglevering: "Teruglevering" }[k]}
              <input style={input} type="number" step="0.0001" min="0" value={doc.data[k]} onChange={(e) => zetTarief(k, e.target.value)} />
            </label>
          ))}
          <div><button style={knop} onClick={bewaarTarieven} disabled={!doc}>Opslaan</button></div>
          {tarievenStatus && <div style={{ fontSize: 13, color: C.sub }}>{tarievenStatus}</div>}
        </section>

        <section style={paneel}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Home Assistant</h2>
          {koppeling?.gekoppeld ? (
            <>
              <div style={{ fontSize: 14 }}>Gekoppeld met <b>{koppeling.ha_url}</b></div>
              <div><button style={{ ...knop, background: "transparent", color: C.sub, border: `1px solid ${C.line}` }} onClick={ontkoppel}>Ontkoppelen</button></div>
            </>
          ) : (
            <form onSubmit={koppel} style={{ display: "grid", gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
                Vul een adres in dat vanaf internet bereikbaar is (bv. je Nabu Casa-URL) en een
                langlevend toegangstoken (HA → profiel → Beveiliging). Geen Home Assistant? Vul dan bij
                Advies je jaartotalen in of laad een CSV — die worden bewaard.
              </p>
              <label style={{ fontSize: 13, color: C.sub }}>Adres
                <input style={input} type="url" required placeholder="https://jouw-ha.ui.nabu.casa" value={haUrl} onChange={(e) => setHaUrl(e.target.value)} />
              </label>
              <label style={{ fontSize: 13, color: C.sub }}>Token
                <input style={input} type="password" required autoComplete="off" value={haToken} onChange={(e) => setHaToken(e.target.value)} />
              </label>
              <div><button style={knop} disabled={bezig}>{bezig ? "Verbinden…" : "Koppelen"}</button></div>
            </form>
          )}
          {koppelStatus && <div role="status" style={{ fontSize: 13, color: koppelStatus.ok ? C.good : C.bad }}>{koppelStatus.tekst}</div>}
        </section>
      </div>
    </div>
  );
}
