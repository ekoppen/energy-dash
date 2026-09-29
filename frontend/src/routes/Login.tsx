import React, { useState } from "react";
import { login, registreer } from "../auth";

const C = { bg: "#0f1419", panel: "#171e26", line: "#2a3744", ink: "#e8eef3", sub: "#8b9aa8", accent: "#f0a32a", bad: "#e8654f" };
const input = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, width: "100%", boxSizing: "border-box" as const };

export default function Login() {
  const [modus, setModus] = useState<"login" | "registreer">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault();
    setFout(null);
    setBezig(true);
    try {
      await (modus === "login" ? login(email, password) : registreer(email, password));
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "grid", placeItems: "center", padding: 16, fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <form onSubmit={verstuur} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, width: "100%", maxWidth: 360, display: "grid", gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{modus === "login" ? "Inloggen" : "Account maken"}</h1>
        <label style={{ fontSize: 13, color: C.sub }}>E-mail
          <input style={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ fontSize: 13, color: C.sub }}>Wachtwoord
          <input style={input} type="password" autoComplete={modus === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {fout && <div role="alert" style={{ color: C.bad, fontSize: 13 }}>{fout}</div>}
        <button disabled={bezig} style={{ background: C.accent, color: "#1a1205", border: "none", borderRadius: 9, padding: "11px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          {bezig ? "Bezig…" : modus === "login" ? "Inloggen" : "Account maken"}
        </button>
        <button type="button" onClick={() => setModus(modus === "login" ? "registreer" : "login")} style={{ background: "transparent", color: C.sub, border: "none", fontSize: 13, cursor: "pointer" }}>
          {modus === "login" ? "Nog geen account? Maak er een" : "Heb je al een account? Log in"}
        </button>
      </form>
    </div>
  );
}
