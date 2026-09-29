# energy-dash

Een persoonlijk energiedashboard dat live data uit **Home Assistant**
(HomeWizard P1-meter) ophaalt en presenteert in twee weergaven: een **overzicht**
(wat gebeurt er nu) en een **advies**-scherm dat, op basis van een vast
dubbeltariefcontract, de financiële gevolgen van de salderingsstop (2027) en de
rendabiliteit van een thuisaccu doorrekent — op je eigen verbruiksdata.

## Wat het doet

- **Overzicht** — live vermogen, actief tarief en actuele prijs, elke 10s ververst.
- **Advies → Salderingsstop 2027** — je jaarrekening mét vs. zónder saldering
  (de "salderingsschade"), hoeveel een accu daarvan terugwint, en wat meer
  zelf-verbruiken oplevert. Gevoed met je echte HA-uurdata.
- **Advies → Accu-analyse** — terugverdientijd, ROI en jaarbesparing van een
  thuisaccu, met schuiven voor capaciteit, prijs, levensduur en rendement, en
  een saldering-scenario (nu vs. vanaf 2027).

Zonder live data draaien beide analyses in een schatting-modus (jaartotalen of
CSV-upload), zodat het scherm altijd bruikbaar is.

## Architectuur

```
browser ──login/register/refresh──────────────▶ Apenkaas (tenant "energy-dash")
browser ──instellingen, uurdata (user-JWT)────▶ Apenkaas collections/bucket
browser ──/now /hours /koppeling (user-JWT)───▶ FastAPI-backend
                                                  │ /me  (wie is dit?)
                                                  │ ha_koppeling lezen (server-key)
                                                  ▼
                                               HA van díe gebruiker
```

De **frontend praat rechtstreeks met Apenkaas voor inloggen en eigen gegevens**
(instellingen, schuifjes, CSV's). De **FastAPI-backend** blijft de proxy naar Home
Assistant en is de enige die HA-tokens ziet. HA-tokens staan per gebruiker in
Apenkaas (collection `ha_koppeling`, alleen leesbaar met de server-key) en
komen nooit in de browser.

## Stack

- **Backend:** FastAPI (Python 3.12), httpx + websockets voor de HA-koppeling.
- **Frontend:** Vite + React + TypeScript, react-router. Recharts kan later voor
  grafieken (fase 2).
- **Deployment:** Docker Compose (backend + nginx-frontend). Klaar voor Coolify.

## Snel starten

Energy-dash vereist nu Apenkaas (zelf-hosted BaaS) voor inloggen en opslag. Zie
[`deploy/README.md`](deploy/README.md) voor de inrichting.

```bash
cp .env.example .env      # vul Apenkaas-gegevens in
docker compose up --build
```

Open **http://localhost:8080** (let op: http, niet https). Je ziet het inlogscherm.
Registreer een account, koppel je Home Assistant of upload een CSV.

## Projectstructuur

```
backend/          FastAPI proxy + auth + tarief-/advieslogica
  main.py           endpoints: /health /koppeling /now /hours
  ha_stats.py       HA recorder-statistieken via WebSocket → {imp, exp} per uur
frontend/
  src/routes/       Login.tsx, Overzicht.tsx, Advies.tsx, Instellingen.tsx
  src/features/
    accu/           accu-rendementsanalyse (model + component)
    saldering/      salderingsstop-impact (model + component + tests)
  src/api.ts        praat met de backend; auth.ts/instellingen.ts/uurdata.ts met Apenkaas
deploy/           deployment-notities (lokaal + Coolify)
docker-compose.yml
```

## Tests

```bash
cd backend && .venv/bin/pytest -q
cd frontend && npm test && npm run build
```

Backend: auth, URL-controle, P1-detectie. Frontend: rekenlogica en build.

## Contract & aannames

Gebouwd rond een Coolblue "3 jaar Zeker" dubbeltariefcontract (piek 0,254390 /
dal 0,233699 / teruglevering 0,060000 €/kWh, geen aparte terugleverkosten).
Tarieven stel je per gebruiker in bij Instellingen (dit contract is de startwaarde). De salderingsregeling
stopt per 1 januari 2027 — dat scenario is de kern van de advieslogica.

## Beperking

De P1-meter meet alleen het netsaldo, niet de bruto zonne-opwek. Een exact
"zelfconsumptie-percentage" vereist een aparte omvormer-sensor; de analyses
werken daarom op het netto import/export-saldo (voor de saldering-vraag is dat
juist het relevante getal).

## Status

Werkend fundament: live overzicht, beide advies-analyses op echte uurdata,
volledig gecontaineriseerd. Uitbreidingen (dag-/maandgrafieken, energiebalans,
meer adviesregels) staan op de rol.

---

*Persoonlijk project. Indicatieve berekeningen, geen financieel advies.*
