# energy-dash

Een persoonlijk energiedashboard dat live data uit **Home Assistant**
(HomeWizard P1-meter) ophaalt en presenteert in twee weergaven: een **overzicht**
(wat gebeurt er nu) en een **advies**-scherm dat, op basis van een vast
dubbeltariefcontract, de financiële gevolgen van de salderingsstop (2027) en de
rendabiliteit van een thuisaccu doorrekent — op je eigen verbruiksdata.

## Wat het doet

- **Overzicht** — live vermogen, actief tarief en actuele prijs, elke 10s ververst.
  Lever je terug, dan de waarde van die teruglevering (t/m 2026 gesaldeerd, daarna de
  vergoeding), min terugleverkosten.
- **Advies → Salderingsstop 2027** — je jaarrekening mét vs. zónder saldering
  (de "salderingsschade"), hoeveel een accu daarvan terugwint, en wat meer
  zelf-verbruiken oplevert. Gevoed met je echte HA-uurdata.
- **Advies → Accu-analyse** — terugverdientijd, ROI en jaarbesparing van een
  thuisaccu, met schuiven voor capaciteit, prijs, levensduur en rendement, en
  een saldering-scenario (nu vs. vanaf 2027).
- **Tarieven** — piek, dal, terugleververgoeding, terugleverkosten en netto vaste
  kosten per maand. Advies weegt piek/dal naar je echte dal-aandeel (P1-teller T1) en
  toont naast de variabele kosten ook je totale jaarrekening.
- **Virtuele accu** — kies een startdatum ("ingebruikname"); een virtuele thuisaccu rekent
  vanaf die dag uur voor uur mee op je echte HA-data en loopt daarna live door:
  laadstatus, opbrengst per dag en sinds de start (met en zonder saldering), volle cycli.
- **Display-signaal** — `GET /api/signaal` met een eigen display-sleutel geeft een
  kleur + advies ("goed moment: zet een apparaat aan", "accu laadt", "je koopt in", …)
  en de accustand, voor een display of lampje. De sleutel kan alleen dit lezen.

Zonder live data draaien beide analyses in een schatting-modus (jaartotalen of
CSV-upload), zodat het scherm altijd bruikbaar is.

## Architectuur

```
browser ──login/register/refresh──────────────▶ Apenkaas (tenant "energy-dash")
browser ──instellingen, uurdata (user-JWT)────▶ Apenkaas collections/bucket
browser ──/now /hours /koppeling /accu (JWT)─▶ FastAPI-backend
display ──/signaal (display-sleutel)──────────▶   │ /me  (wie is dit?)
                                                  │ ha_koppeling, instellingen,
                                                  │ display_sleutels lezen (server-key)
                                                  ▼
                                               HA van díe gebruiker
```

De **frontend praat rechtstreeks met Apenkaas voor inloggen en eigen gegevens**
(instellingen, schuifjes, CSV's). De **FastAPI-backend** blijft de proxy naar Home
Assistant en is de enige die HA-tokens ziet. HA-tokens staan per gebruiker in
Apenkaas (collection `ha_koppeling`, alleen leesbaar met de server-key) en
komen nooit in de browser. Het instellingen-document is leesbaar voor de gebruiker
én de server (die rekent er de virtuele accu en het signaal mee); schrijven kan
alleen de gebruiker zelf. Van display-sleutels bewaart de server alleen een sha256.

## Stack

- **Backend:** FastAPI (Python 3.12), httpx + websockets voor de HA-koppeling.
- **Frontend:** Vite + React + TypeScript, react-router. Grafieken als inline SVG
  (geen grafiekbibliotheek).
- **Deployment:** Docker Compose (backend + nginx-frontend). Draait op **lan01**
  (zie hieronder); klaar voor Coolify.

## Snel starten

Energy-dash vereist nu Apenkaas (zelf-hosted BaaS) voor inloggen en opslag. Zie
[`deploy/README.md`](deploy/README.md) voor de inrichting.

```bash
cp .env.example .env      # vul Apenkaas-gegevens in
docker compose up --build
```

Open **http://localhost:8080** (let op: http, niet https). Je ziet het inlogscherm.
Registreer een account, koppel je Home Assistant of upload een CSV.

## Waar het draait

- **lan01** (192.168.178.124), map `~/dockers/energy-dash` (git clone van deze repo):
  **http://192.168.178.124:8080**. Bijwerken:
  ```bash
  ssh lan01 'cd ~/dockers/energy-dash && git pull --ff-only && docker compose up --build -d'
  ```
  `.env` staat alleen op de server (niet in git); nieuwe variabelen eerst daar toevoegen.
- **Apenkaas:** apenkaas-test (http://192.168.178.202:3000), tenant `energy-dash`.
- De kopie op de Mac mini is alleen voor ontwikkeling (`docker compose start`/`stop`).
- Controleer bij een uitrol altijd ook `docker compose build`: de Docker-context is
  `./frontend`, dus wat lokaal bouwt hoeft daar niet te bouwen.

## Projectstructuur

```
backend/          FastAPI proxy + auth + tarief-/advieslogica
  main.py           endpoints: /health /koppeling /now /hours /accu /signaal /display-sleutel
  ha_stats.py       HA recorder-statistieken via WebSocket → {start_ms, imp, exp, imp_dal} per uur
  virtuele_accu.py  pure rekenkern: simulatie, rekeningen, dagreeks, signaal
  accu_dienst.py    caches (instellingen 60 s, live 10 s, uurberekening per uur) + antwoorden
  apenkaas.py       Apenkaas-client (server-key) + kies_instellingen
  display_sleutel.py  sleutel maken en hashen
frontend/
  src/routes/       Login.tsx, Overzicht.tsx, Advies.tsx, VirtueleAccu.tsx, Instellingen.tsx
  src/features/
    accu/           accu-rendementsanalyse (model + component) + DagGrafiek (virtuele accu)
    saldering/      salderingsstop-impact (model + component + tests)
  src/api.ts        praat met de backend; auth.ts/instellingen.ts/uurdata.ts met Apenkaas
deploy/           deployment-notities (Apenkaas inrichten, lokaal, Coolify)
testdata/         gedeelde testgevallen backend ↔ browser (accu-simulatie)
apenkaas.json     manifest voor apenkaas/scripts/push.mjs (collecties + bucket)
docs/superpowers/ ontwerpen (specs) en uitvoeringsplannen
docker-compose.yml
```

## Tests

```bash
cd backend && .venv/bin/pytest -q
cd frontend && npm test && npm run build
```

Backend: auth, URL-controle, P1-detectie, virtuele accu, signaal, display-sleutels,
caches. Frontend: rekenlogica, instellingen-document (eigendom + omzetten) en build.
Testbestanden doen niet mee in de productie-build (`tsconfig.json` exclude).

## Contract & aannames

Gebouwd rond een Coolblue "3 jaar Zeker" dubbeltariefcontract (startwaarden piek
0,254390 / dal 0,233699 / teruglevering 0,060000 €/kWh, terugleverkosten 0).
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
