import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFout, NowData } from "../api";
import { Instellingen, laadInstellingen, STANDAARD } from "../instellingen";
import { prijsNu } from "../features/saldering/saldering-model";

// Overzichtsdashboard (scherm 1). Toont de live situatie uit de backend.
// Dit is een startpunt: fase 2 van docs/PLAN.md breidt dit uit met dag-/
// maandgrafieken en de energiebalans.

const C = {
  bg: "#0f1419", panel: "#171e26", line: "#2a3744",
  ink: "#e8eef3", sub: "#8b9aa8", dim: "#5d6b78",
  import: "#2f6fed", export: "#2e9e3f", accent: "#f0a32a",
};
const euro = (n: number) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export default function Overzicht() {
  const [now, setNow] = useState<NowData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tar, setTar] = useState<Instellingen>(STANDAARD);
  const [geenKoppeling, setGeenKoppeling] = useState(false);
  const [tokenGeweigerd, setTokenGeweigerd] = useState(false);

  useEffect(() => {
    laadInstellingen().then((d) => setTar(d.data)).catch(() => {});
    let t: ReturnType<typeof setInterval> | undefined;
    // Zonder (werkende) koppeling heeft verversen geen zin; blijven proberen met een
    // geweigerd token laat HA bovendien het IP van de server blokkeren.
    const load = () => api.now().then((n) => { setNow(n); setErr(null); }).catch((e) => {
      if (e instanceof ApiFout && e.code === "geen_koppeling") { setGeenKoppeling(true); clearInterval(t); }
      else if (e instanceof ApiFout && e.code === "ha_token") { setTokenGeweigerd(true); setNow(null); clearInterval(t); }
      else setErr(e instanceof Error ? e.message : String(e));
    });
    load();
    t = setInterval(load, 10000); // elke 10s verversen
    return () => clearInterval(t);
  }, []);

  const teruglevert = now ? now.vermogen_w < 0 : false;
  const prijs = prijsNu({
    inkooptarief: now?.actief_tarief === "dal" ? tar.tarief_dal : tar.tarief_piek,
    terugleververgoeding: tar.tarief_teruglevering,
    terugleverkosten: tar.tarief_terugleverkosten,
    teruglevert,
    moment: new Date(),
  });

  return (
    <div style={{ background: C.bg, minHeight: "100%", padding: "32px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.accent, fontWeight: 600, marginBottom: 8 }}>Live overzicht</div>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 24px", lineHeight: 1.1 }}>Je energie, nu</h1>

        {err && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, color: C.sub, fontSize: 13 }}>
            Kon geen live data ophalen ({err}).
          </div>
        )}

        {tokenGeweigerd && (
          <div role="status" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, color: C.sub, fontSize: 14 }}>
            Home Assistant accepteert je token niet meer (verlopen of verwijderd). Maak in HA een nieuw
            token aan en <Link to="/instellingen" style={{ color: C.accent }}>koppel opnieuw</Link>.
          </div>
        )}

        {geenKoppeling && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, color: C.sub, fontSize: 14 }}>
            Nog geen Home Assistant gekoppeld. <Link to="/instellingen" style={{ color: C.accent }}>Koppel je HA</Link> voor live data,
            of bekijk <Link to="/advies" style={{ color: C.accent }}>Advies</Link> op basis van je jaartotalen.
          </div>
        )}

        {now && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Card label="Vermogen nu" value={`${now.vermogen_w.toLocaleString("nl-NL")} W`}
              color={teruglevert ? C.export : C.import}
              hint={teruglevert ? "je levert terug 🟢" : "je neemt af 🔴"} />
            <Card label="Actief tarief" value={now.actief_tarief === "dal" ? "Dal" : "Piek"} color={C.ink} />
            <Card label={teruglevert ? "Waarde teruglevering nu" : "Prijs nu"} value={euro(prijs.waarde)} color={teruglevert ? C.export : C.accent} hint={prijs.uitleg} />
          </div>
        )}

        {!now && !err && !geenKoppeling && !tokenGeweigerd && <div style={{ color: C.dim, fontSize: 14 }}>Laden…</div>}
      </div>
    </div>
  );
}

function Card({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22 }}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: color || C.ink, lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}
