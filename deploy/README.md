# Deployment — Docker Compose

Energy-dash werkt met Apenkaas (zelf-hosted BaaS op `apenkaas-test`,
192.168.178.202:3000). Volg eerst de inrichting hieronder, dan lokaal draaien.

## Apenkaas inrichten (eenmalig)

Via de console op http://192.168.178.202:3000/console:

1. **Tenant aanmaken:** "energy-dash", registratie aan. Noteer het tenant-id.

2. **App-sleutel aanmaken:** "energy-dash-server": niet-publiek, scopes
   `data:read`, `data:write`. Noteer de key (wordt maar één keer getoond).
   Een publieke browser-sleutel is niet nodig: de frontend gebruikt alleen de
   JWT van de ingelogde gebruiker (Apenkaas staat elke CORS-origin toe).

3. **Collecties en bucket aanmaken met het manifest.** `apenkaas.json` in deze
   repo beschrijft `instellingen`, `ha_koppeling` en de bucket `uurdata`. Maak
   in de console een tijdelijke sleutel "setup" (niet-publiek, scopes
   `data:read`, `data:write`, `storage:read`, `storage:write`) en draai vanuit
   de apenkaas-repo:
   ```bash
   APENKAAS_URL=http://192.168.178.202:3000 APENKAAS_TENANT=<tenant-id> APENKAAS_KEY=<setup-key> \
     node scripts/push.mjs ../energy-dash/apenkaas.json
   ```
   Het script print de ids als `.env`-regels. Veilig om opnieuw te draaien
   (maakt alleen aan wat ontbreekt, verwijdert nooit). Verwijder de
   setup-sleutel daarna in de console.

4. **Vul `.env` in** (zie `.env.example`; niet committen):
   ```
   APENKAAS_URL=http://192.168.178.202:3000
   APENKAAS_TENANT_ID=<tenant-id uit stap 1>
   APENKAAS_SERVER_KEY=<key uit stap 2>
   APENKAAS_KOPPELING_COLLECTION_ID=<uit stap 3>
   VITE_APENKAAS_URL=http://192.168.178.202:3000   # Apenkaas zoals de BROWSER hem ziet
   VITE_APENKAAS_TENANT_ID=<tenant-id>
   VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID=<uit stap 3>
   VITE_APENKAAS_UURDATA_BUCKET_ID=<uit stap 3>
   HA_PRIVE_TOEGESTAAN=192.168.1.1     # LAN-IP van je Home Assistant
   ```
   De CSV-upload en -download gaan via presigned URL's rechtstreeks naar de
   opslag (MinIO) van Apenkaas: die moet dus ook vanuit de browser bereikbaar zijn.

## Lokaal draaien
```bash
docker compose up --build
```
Frontend: http://localhost:8080 — praat via nginx `/api` met de backend.
Backend: intern op poort 8000 (niet extern blootgesteld).

## Home Assistant bereikbaar maken vanuit de container
De backend draait in een container en moet bij je HA kunnen. Privé-adressen
(192.168.x.x, 10.x.x.x, loopback enz.) worden standaard geweigerd als SSRF-bescherming.
Voor je eigen HA op het LAN voeg je het adres toe aan `HA_PRIVE_TOEGESTAAN`:
```
HA_PRIVE_TOEGESTAAN=192.168.1.50,192.168.1.51
```
(komma-gescheiden, geen spaties).

Let op: elke geregistreerde gebruiker kan de backend daarmee laten verbinden met
die host, op elke poort. Zet er dus alleen adressen in die je gebruikers mogen bereiken.

## Coolify (jouw homelab)
- Nieuw resource → Docker Compose → wijs naar dit `docker-compose.yml`.
- Zet alle Apenkaas-gegevens (server-key, collection-id's, bucket-id's) als
  secrets in de Coolify-UI (niet in de repo). Voeg `HA_PRIVE_TOEGESTAAN` toe
  voor je eigen LAN-HA als je die wilt koppelen.
- Laat Coolify/Traefik de externe poort + TLS afhandelen; je kunt de `ports:`
  mapping van de frontend dan weghalen en op het Traefik-netwerk aansluiten.
- Zet `CORS_ORIGINS` op de publieke frontend-URL; `VITE_APENKAAS_URL` wijst naar
  de Apenkaas-instance zoals de browser van je gebruikers hem bereikt
  (bv. `http://192.168.178.202:3000`, of in productie de publieke URL).

## Veiligheid
- **Apenkaas server-key** alleen serverside (backend). De frontend gebruikt
  de JWT van de ingelogde gebruiker (geen app-sleutel).
- **HA-tokens** liggen per gebruiker in Apenkaas en verlaten nooit de backend;
  gebruikers stellen hun URL in, maar zien het token nooit.
- **SSRF-bescherming:** backend weigert standaard privé-adressen; alleen
  adressen in `HA_PRIVE_TOEGESTAAN` mogen naar het LAN. De backend volgt geen redirects (HTTP en WebSocket); een
  redirect van een HA-URL wordt als fout afgewezen. Na de controle verbindt de backend met precies het
  goedgekeurde IP-adres (geen tweede DNS-opzoeking), zodat een domein niet tussendoor naar het LAN kan omslaan
  (DNS-rebinding); Host-header en certificaatcontrole blijven op de hostnaam.
- `.env` en secrets nooit in git (zie .gitignore).

## Uurdata: het /hours endpoint
De backend haalt uurdata uit de HA **recorder-statistieken** via de WebSocket-API
(`recorder/statistics_during_period`, period=hour). Het combineert import t1+t2
en export t1+t2 tot één `{imp, exp}`-reeks per uur — dat voedt zowel de accu- als
de saldering-analyse.

Aandachtspunten:
- De WebSocket loopt naar `ws(s)://<ha-adres>/api/websocket`, met het HA-adres
  van de gebruiker (Instellingen). Dat moet vanuit de container bereikbaar zijn
  (LAN-IP op `HA_PRIVE_TOEGESTAAN`, geen localhost). Limieten: 20 s per stap,
  berichten max 16 MiB, `days` 1 t/m 730. Fouten komen als 502 `ha_onbereikbaar`.
- De recorder moet genoeg historie hebben. Standaard bewaart HA statistieken
  lang (die worden niet gepurged zoals gewone states), dus ~een jaar terug werkt
  meestal. Heb je pas net gemeten, dan is er navenant minder data.
- Test los: `GET /api/hours?days=30` via de frontend (nginx), met een
  `Authorization: Bearer <access-token>` van een ingelogde gebruiker. De backend
  zelf (poort 8000) is niet extern blootgesteld.

## Health & herstart
- Backend heeft een `/health` endpoint; compose gebruikt dat als healthcheck.
- Frontend start pas als de backend gezond is (`depends_on: condition`).
- Beide services `restart: unless-stopped`.
