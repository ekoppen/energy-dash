import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AccuData, ApiFout } from "../api";
import DagGrafiek from "../features/accu/DagGrafiek";
import { bewaarInstellingen, laadInstellingen, STANDAARD, VirtueleAccu as Inst } from "../instellingen";

const C = { bg: "#0f1419", panel: "#171e26", line: "#2a3744", ink: "#e8eef3", sub: "#8b9aa8", dim: "#5d6b78", accent: "#f0a32a", good: "#3ec46d", bad: "#e8654f" };
const paneel = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22, marginBottom: 20 };
const input = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", fontSize: 14, width: "100%", boxSizing: "border-box" as const };
const knop = { background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const euro = (n: number) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vandaag = () => new Date().toISOString().slice(0, 10);
const minDatum = () => new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
const STATUS: Record<string, string> = { laden: "laadt", ontladen: "ontlaadt", vol: "vol", leeg: "leeg", stil: "staat stil" };

export default function VirtueleAccu() {
  const [docId, setDocId] = useState<string | null>(null);
  const [inst, setInst] = useState<Inst>(STANDAARD.virtuele_accu);
  const [advies, setAdvies] = useState<{ capacity?: number; roundTrip?: number }>({});
  const [data, setData] = useState<AccuData | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [geenKoppeling, setGeenKoppeling] = useState(false);
  const [sleutelActief, setSleutelActief] = useState(false);
  const [nieuweSleutel, setNieuweSleutel] = useState<string | null>(null);

  const haal = (vers = false) => api.accu(vers).then((d) => { setData(d); setMelding(null); }).catch((e) => {
    if (e instanceof ApiFout && (e.code === "geen_koppeling" || e.code === "ha_token")) { setGeenKoppeling(true); return "stop"; }
    setMelding(e instanceof Error ? e.message : String(e));
  });

  useEffect(() => {
    laadInstellingen().then((d) => { setDocId(d.id); setInst({ ...STANDAARD.virtuele_accu, ...d.data.virtuele_accu }); setAdvies(d.data.advies); })
      .catch((e) => setMelding(e instanceof Error ? e.message : String(e)));
    api.displaySleutel.get().then((s) => setSleutelActief(s.actief)).catch(() => {});
    let t: ReturnType<typeof setInterval> | undefined;
    haal().then((r) => { if (r === "stop") clearInterval(t); });
    t = setInterval(() => haal().then((r) => { if (r === "stop") clearInterval(t); }), 30_000);
    return () => clearInterval(t);
  }, []);

  const zet = (k: keyof Inst, v: string) => setInst({ ...inst, [k]: k === "startdatum" ? (v || undefined) : Number(v) });

  const bewaar = async () => {
    if (!docId) return;
    try { await bewaarInstellingen(docId, { virtuele_accu: inst }); setMelding("Opgeslagen ✓ — opnieuw doorgerekend"); await haal(true); }
    catch (e) { setMelding(e instanceof Error ? e.message : String(e)); }
  };

  const neemOver = () => setInst({ ...inst, capaciteit_kwh: advies.capacity ?? inst.capaciteit_kwh, rendement_pct: advies.roundTrip ?? inst.rendement_pct });

  const maakSleutel = async () => {
    if (sleutelActief && !window.confirm("De huidige display-sleutel stopt dan met werken. Doorgaan?")) return;
    try { setNieuweSleutel((await api.displaySleutel.maak()).sleutel); setSleutelActief(true); }
    catch (e) { setMelding(e instanceof Error ? e.message : String(e)); }
  };
  const intrek = async () => {
    try { await api.displaySleutel.intrek(); setSleutelActief(false); setNieuweSleutel(null); }
    catch (e) { setMelding(e instanceof Error ? e.message : String(e)); }
  };

  const nu = data?.nu;
  const accu = nu?.accu;

  return (
    <div style={{ background: C.bg, minHeight: "100%", padding: "32px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.accent, fontWeight: 600, marginBottom: 8 }}>Virtuele accu</div>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Wat had een accu gedaan?</h1>
        <p style={{ color: C.sub, fontSize: 14, margin: "0 0 24px", maxWidth: 680, lineHeight: 1.5 }}>
          Kies een startdatum: de accu rekent vanaf die dag mee op je echte meterdata en loopt daarna live door.
          Gerekend met je huidige tarieven.
        </p>
        {melding && <div role="status" style={{ color: C.sub, fontSize: 13, marginBottom: 12 }}>{melding}</div>}
        {geenKoppeling && (
          <div style={{ ...paneel, color: C.sub, fontSize: 14 }}>
            Koppel eerst (opnieuw) je Home Assistant via <Link to="/instellingen" style={{ color: C.accent }}>Instellingen</Link>.
          </div>
        )}

        {nu && (
          <section style={{ ...paneel, borderColor: nu.kleur }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span style={{ width: 16, height: 16, borderRadius: 8, background: nu.kleur, display: "inline-block" }} />
              <b>{nu.advies}</b>
            </div>
            {accu ? (
              <>
                <div style={{ background: C.bg, borderRadius: 8, height: 18, overflow: "hidden", border: `1px solid ${C.line}` }}>
                  <div style={{ width: `${accu.laadstatus_pct}%`, height: "100%", background: C.accent }} />
                </div>
                <div style={{ fontSize: 13, color: C.sub, marginTop: 8 }}>
                  {accu.laadstatus_pct}% ({accu.laadstatus_kwh} kWh){accu.stand_om && ` · stand om ${accu.stand_om}`} ·
                  nu: {STATUS[accu.status]}{accu.vermogen_w > 0 && ` met ${Math.round(accu.vermogen_w)} W`} ·
                  vandaag {euro(accu.opbrengst_vandaag_eur)}
                </div>
              </>
            ) : <div style={{ fontSize: 13, color: C.sub }}>Kies hieronder een startdatum om de virtuele accu aan te zetten.</div>}
          </section>
        )}

        {data?.totaal && (
          <section style={paneel}>
            <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>Sinds {data.instellingen.startdatum}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 18, marginBottom: 18 }}>
              <Getal label="Opbrengst zonder saldering" waarde={euro(data.totaal.zonder_saldering)} kleur={C.good} hint="het scenario vanaf 2027" />
              <Getal label="Opbrengst mét saldering" waarde={euro(data.totaal.met_saldering)} hint="nu, t/m 2026 (benadering)" />
              <Getal label="Minder teruggeleverd" waarde={`${Math.round(data.totaal.minder_teruggeleverd_kwh)} kWh`} />
              <Getal label="Minder ingekocht" waarde={`${Math.round(data.totaal.minder_ingekocht_kwh)} kWh`} />
              <Getal label="Volle laadcycli" waarde={data.totaal.cycli.toLocaleString("nl-NL")} />
            </div>
            <DagGrafiek dagen={data.dagen} />
          </section>
        )}

        <section style={{ ...paneel, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Instellen</h2>
          <label style={{ fontSize: 13, color: C.sub }}>Startdatum (ingebruikname)
            <input style={input} type="date" min={minDatum()} max={vandaag()} value={inst.startdatum ?? ""} onChange={(e) => zet("startdatum", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Capaciteit (kWh)
            <input style={input} type="number" min="0.5" step="0.5" value={inst.capaciteit_kwh} onChange={(e) => zet("capaciteit_kwh", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Rendement (%)
            <input style={input} type="number" min="50" max="100" step="1" value={inst.rendement_pct} onChange={(e) => zet("rendement_pct", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Max. laad-/ontlaadvermogen (kW)
            <input style={input} type="number" min="0.5" step="0.1" value={inst.max_vermogen_kw} onChange={(e) => zet("max_vermogen_kw", e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: C.sub }}>Drempel voor het display (W)
            <input style={input} type="number" min="0" step="50" value={inst.drempel_w} onChange={(e) => zet("drempel_w", e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={knop} onClick={bewaar} disabled={!docId}>Opslaan en doorrekenen</button>
            <button style={{ ...knop, background: "transparent", color: C.sub, border: `1px solid ${C.line}` }} onClick={neemOver}>Neem over uit Advies</button>
            {inst.startdatum && <button style={{ ...knop, background: "transparent", color: C.sub, border: `1px solid ${C.line}` }} onClick={() => setInst({ ...inst, startdatum: undefined })}>Accu uitzetten</button>}
          </div>
        </section>

        <section style={{ ...paneel, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Display</h2>
          <p style={{ margin: 0, fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
            Een display kan het signaal hierboven uitlezen met een eigen sleutel. Die sleutel kan alleen dit
            signaal lezen, niets wijzigen.
          </p>
          {nieuweSleutel && (
            <div style={{ background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 10, padding: 12, fontSize: 13 }}>
              <div style={{ marginBottom: 6 }}>Je nieuwe sleutel (wordt maar één keer getoond):</div>
              <code style={{ wordBreak: "break-all", color: C.accent }}>{nieuweSleutel}</code>
              <div style={{ marginTop: 10, color: C.sub }}>Voorbeeld:</div>
              <code style={{ wordBreak: "break-all" }}>{`curl -H "Authorization: Bearer ${nieuweSleutel}" ${window.location.origin}/api/signaal`}</code>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={knop} onClick={maakSleutel}>{sleutelActief ? "Nieuwe sleutel maken" : "Display-sleutel maken"}</button>
            {sleutelActief && <button style={{ ...knop, background: "transparent", color: C.bad, border: `1px solid ${C.line}` }} onClick={intrek}>Intrekken</button>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Getal({ label, waarde, kleur, hint }: { label: string; waarde: string; kleur?: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: kleur ?? C.ink }}>{waarde}</div>
      {hint && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
