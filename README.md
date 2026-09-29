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
HomeWizard P1 → Home Assistant → HA API (REST + WebSocket)
                                     │  token blijft serverside
                                     ▼
                             backend (FastAPI proxy + rekenlogica)
                                     │  schone JSON
                                     ▼
                             frontend (Vite + React, via nginx)
                             /overzicht   /advies
```

De **frontend praat alleen met de backend**, nooit direct met Home Assistant.
Het HA-token staat uitsluitend serverside (env/secret) en de app is read-only
richting HA.

## Stack

- **Backend:** FastAPI (Python 3.12), httpx + websockets voor de HA-koppeling.
- **Frontend:** Vite + React + TypeScript, react-router. Recharts kan later voor
  grafieken (fase 2).
- **Deployment:** Docker Compose (backend + nginx-frontend). Klaar voor Coolify.

## Snel starten

```bash
cp .env.example .env      # vul HA_BASE_URL en HA_TOKEN in
docker compose up --build
```

Open **http://localhost:8080** (let op: http, niet https).

> **Belangrijk:** `HA_BASE_URL` mag geen `localhost` zijn — vanuit de container
> is dat de container zelf. Gebruik het LAN-IP van je HA-host, bv.
> `http://192.168.1.50:8123`. Zie [`deploy/README.md`](deploy/README.md).

Een long-lived token maak je in HA aan onder je profiel → "Langlevende
toegangstokens".

## Projectstructuur

```
backend/          FastAPI proxy + tarief-/advieslogica
  main.py           endpoints: /health /config /now /hours
  ha_stats.py       HA recorder-statistieken via WebSocket → {imp, exp} per uur
frontend/
  src/routes/       Overzicht.tsx, Advies.tsx
  src/features/
    accu/           accu-rendementsanalyse (model + component)
    saldering/      salderingsstop-impact (model + component + tests)
  src/api.ts        praat met de backend
deploy/           deployment-notities (lokaal + Coolify)
docker-compose.yml
```

## Tests

```bash
cd frontend && npm install && npm test
```

De rekenlogica van beide analyses (`*-model.ts`) is los getest met vitest.

## Contract & aannames

Gebouwd rond een Coolblue "3 jaar Zeker" dubbeltariefcontract (piek 0,254390 /
dal 0,233699 / teruglevering 0,060000 €/kWh, geen aparte terugleverkosten).
Tarieven staan als env-variabelen en zijn aanpasbaar. De salderingsregeling
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
