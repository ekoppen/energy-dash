# Deployment — Docker Compose

Energy-dash werkt met Apenkaas (zelf-hosted BaaS op `apenkaas-test`,
192.168.178.202:3000). Volg eerst de inrichting hieronder, dan lokaal draaien.

## Apenkaas inrichten (eenmalig)

Via de console op http://192.168.178.202:3000/console:

1. **Tenant aanmaken:** "energy-dash", registratie aan. Noteer het tenant-id.

2. **App-sleutels aanmaken:**
   - "energy-dash-server": niet-publiek, scopes `data:read`, `data:write`.
     Noteer de key (wordt maar één keer getoond).
   - "energy-dash-browser": publiek, allowed origin = frontend-URL
     (lokaal: `http://localhost:8080`).

3. **Collection "instellingen"**: geen verplichte velden, create-regel `users`.
   Noteer het id.

4. **Collection "ha_koppeling"**: create-regel leeg (alleen de server maakt aan).
   Noteer het id.

5. **Bucket "uurdata"**: create-regel `users`, max 5 MB, mimetypes `text/csv`.
   Noteer het id.

6. **Vul `.env` in** (zie `.env.example`; niet committen):
   ```
   APENKAAS_URL=http://192.168.178.202:3000
   APENKAAS_TENANT_ID=<tenant-id uit stap 1>
   APENKAAS_SERVER_KEY=<key uit stap 2a>
   APENKAAS_KOPPELING_COLLECTION_ID=<id uit stap 4>
   VITE_APENKAAS_URL=http://192.168.178.202:3000
   VITE_APENKAAS_TENANT_ID=<tenant-id>
   VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID=<id uit stap 3>
   VITE_APENKAAS_UURDATA_BUCKET_ID=<id uit stap 5>
   HA_PRIVE_TOEGESTAAN=192.168.1.1     # LAN-IP van je Home Assistant
   ```

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
(komma-gescheiden, geen spaties). Zo kunt je gebruikers hun LAN-HA koppelen
zonder dat ze een buitenip hoeven te gebruiken.

## Coolify (jouw homelab)
- Nieuw resource → Docker Compose → wijs naar dit `docker-compose.yml`.
- Zet alle Apenkaas-gegevens (server-key, collection-id's, bucket-id's) als
  secrets in de Coolify-UI (niet in de repo). Voeg `HA_PRIVE_TOEGESTAAN` toe
  voor je eigen LAN-HA als je die wilt koppelen.
- Laat Coolify/Traefik de externe poort + TLS afhandelen; je kunt de `ports:`
  mapping van de frontend dan weghalen en op het Traefik-netwerk aansluiten.
- Zet `CORS_ORIGINS` op de publieke frontend-URL; `VITE_APENKAAS_URL` wijst naar
  de Apenkaas-instance die je gebruikers bereiken (localhost voor test, extern
  IP voor productie).

## Veiligheid
- **Apenkaas server-key** alleen serverside (backend). De frontend gebruikt
  aparte publieke credentials.
- **HA-tokens** liggen per gebruiker in Apenkaas en verlaten nooit de backend;
  gebruikers stellen hun URL in, maar zien het token nooit.
- **SSRF-bescherming:** backend weigert standaard privé-adressen; alleen
  adressen in `HA_PRIVE_TOEGESTAAN` mogen naar het LAN. Geen open redirects.
- `.env` en secrets nooit in git (zie .gitignore).

## Uurdata: het /hours endpoint
De backend haalt uurdata uit de HA **recorder-statistieken** via de WebSocket-API
(`recorder/statistics_during_period`, period=hour). Het combineert import t1+t2
en export t1+t2 tot één `{imp, exp}`-reeks per uur — dat voedt zowel de accu- als
de saldering-analyse.

Aandachtspunten:
- De WebSocket loopt naar `ws(s)://<ha-host>:8123/api/websocket`. `HA_BASE_URL`
  moet dus vanuit de container bereikbaar zijn (LAN-IP, geen localhost).
- De recorder moet genoeg historie hebben. Standaard bewaart HA statistieken
  lang (die worden niet gepurged zoals gewone states), dus ~een jaar terug werkt
  meestal. Heb je pas net gemeten, dan is er navenant minder data.
- Test los: `GET http://<host>:8000/hours?days=30` (via de frontend: /api/hours).

## Health & herstart
- Backend heeft een `/health` endpoint; compose gebruikt dat als healthcheck.
- Frontend start pas als de backend gezond is (`depends_on: condition`).
- Beide services `restart: unless-stopped`.
