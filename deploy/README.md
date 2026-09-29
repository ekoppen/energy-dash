# Deployment — Docker Compose

## Lokaal draaien
```bash
cp .env.example .env      # vul HA_BASE_URL en HA_TOKEN in
docker compose up --build
```
Frontend: http://localhost:8080 — praat via nginx `/api` met de backend.
Backend: intern op poort 8000 (niet extern blootgesteld).

## Belangrijk: Home Assistant bereikbaar maken vanuit de container
De backend draait in een container en moet bij je HA kunnen. `HA_BASE_URL`
mag GEEN `localhost` zijn (dat is de container zelf). Gebruik:
- het LAN-IP van je HA-host, bv. `http://192.168.1.50:8123`, of
- de hostname die vanuit het Docker-netwerk resolvet.
Draait HA als container op dezelfde Docker-host, dan kan de servicenaam of
`host.docker.internal` werken — hangt af van je netwerkopzet.

## Long-lived token
HA → klik je profiel (linksonder) → onderaan "Langlevende toegangstokens" →
token aanmaken. Zet de waarde in `.env` (of Coolify secret). Read-only gebruik.

## Coolify (jouw homelab)
- Nieuw resource → Docker Compose → wijs naar dit `docker-compose.yml`.
- Zet `HA_BASE_URL`, `HA_TOKEN`, en de tarieven als environment variables /
  secrets in de Coolify-UI (niet in de repo).
- Laat Coolify/Traefik de externe poort + TLS afhandelen; je kunt de `ports:`
  mapping van de frontend dan weghalen en op het Traefik-netwerk aansluiten.
- `CORS_ORIGINS` op de publieke frontend-URL zetten.

## Veiligheid
- Token alleen serverside (backend). De frontend krijgt 'm nooit te zien.
- Backend staat alleen GET-endpoints toe en is read-only richting HA.
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
