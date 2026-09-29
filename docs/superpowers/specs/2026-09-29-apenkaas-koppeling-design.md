# Energy-dash × Apenkaas — meerdere gebruikers en opslag

Datum: 2026-09-29 · Status: ontwerp, ter review

## Doel

Energy-dash gaat van "één huishouden, één HA-token in `.env`, niets bewaard" naar
een app waar meerdere huishoudens inloggen en hun eigen gegevens terugzien.
Apenkaas (eigen BaaS, `/Volumes/DATA/dev/apenkaas`) levert inloggen en opslag.

Twee soorten gebruikers:

- **Met Home Assistant** — koppelt een eigen HA (URL + long-lived token). Die HA
  moet vanaf de energy-dash-backend bereikbaar zijn (Nabu Casa, eigen domein,
  VPN…); dat regelt de gebruiker zelf. De app geeft alleen een duidelijke
  melding als het niet lukt.
- **Zonder Home Assistant** — werkt met jaartotalen of een CSV-upload met
  uurdata; die worden bewaard.

Succes = een gebruiker registreert, koppelt HA óf uploadt een CSV, stelt
tarieven en schuifjes in, logt uit en weer in, en ziet alles terug — en een
tweede gebruiker ziet daar niets van.

## Buiten scope

- Andere slimme meters dan de HomeWizard P1 (bv. de DSMR-integratie).
- Delen van een dashboard tussen gebruikers / huishoudens met meerdere leden.
- Wijzigingen in Apenkaas zelf — alles gebruikt bestaande functionaliteit.
- Productie-uitrol: Apenkaas draait nu alleen op `apenkaas-test`
  (192.168.178.202). Deze koppeling is daarmee ook een test-opzet.

## Gekozen aanpak

Browser praat rechtstreeks met Apenkaas voor inloggen en eigen gegevens (zoals
de Supabase client-SDK met RLS); de FastAPI-backend blijft de proxy naar Home
Assistant en is de enige die HA-tokens ziet.

Verworpen: alles via de backend laten lopen (de Apenkaas-API nabouwen in Python,
veel code zonder winst), en Apenkaas alleen voor auth met een eigen database
voor tokens (twee plekken voor gegevens, eigen sleutelbeheer).

```
browser ──login/register/refresh──────────────▶ Apenkaas (tenant "energy-dash")
browser ──instellingen, uurdata (user-JWT)────▶ Apenkaas collections/bucket
browser ──/now /hours /koppeling (user-JWT)───▶ FastAPI-backend
                                                  │ /me  (wie is dit?)
                                                  │ ha_koppeling lezen (server-key)
                                                  ▼
                                               HA van díe gebruiker
```

## Apenkaas-inrichting

Eenmalig, via de Apenkaas-console:

- Tenant **energy-dash**, registratie aan.
- App-sleutel **publiek** (browser), allowed origin = frontend-URL.
- App-sleutel **server** (niet-publiek), alleen in de backend-`.env`.

| Opslag | Soort | Inhoud | Lezen | Schrijven | Aangemaakt door |
|---|---|---|---|---|---|
| `instellingen` | collection | tarieven (piek, dal, teruglevering), jaartotalen, schuifjes (capaciteit, rendement, accuprijs, levensduur, verschuiving %, saldering-scenario) | `user:<id>` | `user:<id>` | browser |
| `ha_koppeling` | collection | `ha_url`, `ha_token`, gevonden entity-id's (`active_power`, `active_tariff`, `import_t1/t2`, `export_t1/t2`) | `app` | `app` | backend |
| `uurdata` | bucket | geüploade CSV met uurdata | `user:<id>` | `user:<id>` | browser |

Eén `instellingen`-document per gebruiker (browser zoekt het eigen document op;
bestaat het niet, dan aanmaken met standaardwaarden). Het `ha_koppeling`-document
heeft het **gebruikers-id als document-id** en wordt alleen door de backend
geschreven: zo kan een gebruiker nooit een koppeling op naam van een ander zetten.
De CSV gaat naar storage omdat een jaar uurdata (~8760 regels) te groot is voor
één JSON-document.

## Inloggen (frontend)

- Nieuw scherm: inloggen / registreren / wachtwoord vergeten, tegen
  `/api/<tenant>/login`, `/register`, `/password-reset/*`.
- Access- en refresh-token in `localStorage` (blijft ingelogd na herladen, zoals
  Supabase). Bij een 401 één keer stil verversen via `/refresh`; mislukt dat →
  terug naar het inlogscherm.
- Uitlogknop in de navigatie (`/logout` + tokens wissen).
- Routes Overzicht, Advies en Instellingen zijn alleen bereikbaar als je
  ingelogd bent.

## Backend (FastAPI)

**Weg:** `HA_BASE_URL`, `HA_TOKEN`, `TARIEF_*` uit `Settings`/`.env`; het
`/config`-endpoint; de hardgecodeerde `SERIAL`/`E`-entity-id's.

**Nieuw in `.env`:** `APENKAAS_URL`, `APENKAAS_TENANT_ID`, `APENKAAS_SERVER_KEY`,
`HA_PRIVE_TOEGESTAAN` (komma-gescheiden hosts/IP's die wél privé mogen zijn).

**Gebruiker bepalen** (FastAPI-dependency, geldt voor alle endpoints behalve
`/health`): `Authorization: Bearer <user-JWT>` → `GET /api/<tenant>/me` bij
Apenkaas → gebruikers-id. Resultaat ~60 s in geheugen gecachet per token (het
Overzicht ververst elke 10 s). Geen/ongeldig token → 401.

**Endpoints:**

| Endpoint | Gedrag |
|---|---|
| `GET /health` | ongewijzigd, geen auth |
| `GET /koppeling` | `{gekoppeld: bool, ha_url?}` — nooit het token |
| `PUT /koppeling` | body `{ha_url, ha_token}` → URL-controle (zie Veiligheid) → HA bereiken → P1-sensoren zoeken → opslaan in `ha_koppeling` met server-key. Antwoord: gelukt, of een duidelijke fout |
| `DELETE /koppeling` | koppeling verwijderen |
| `GET /now` | `{vermogen_w, actief_tarief}` uit de HA van de gebruiker; prijs rekent de frontend uit met eigen tarieven |
| `GET /hours?days=` | als nu, maar met URL/token/entity-id's uit de koppeling |

Zonder koppeling geven `/now` en `/hours` **404 `geen_koppeling`**; de frontend
valt dan terug op de bestaande schattings-/CSV-modus.

**P1-detectie:** `GET /api/states` op de HA, zoek entities die eindigen op
`_active_power`, `_active_tariff`, `_total_power_import_t1/t2`,
`_total_power_export_t1/t2` met prefix `sensor.p1_meter_`. Niet alle zes
gevonden → fout "geen HomeWizard P1-meter gevonden".

CORS: `allow_methods` uitbreiden met `PUT` en `DELETE`.

## Frontend

- `api.ts`: stuurt het user-JWT mee; nieuwe calls `koppeling.get/put/delete`;
  `config()` vervalt. Klein Apenkaas-clientje (fetch-wrapper, geen SDK) voor
  auth, documenten en bucket.
- **Instellingen**-pagina: tarieven; "Home Assistant koppelen" (URL + token,
  knop "Koppelen" met resultaatmelding, "Ontkoppelen"); of jaartotalen/CSV.
- Advies-schuifjes laden bij openen uit `instellingen` en worden ~1 s na de
  laatste wijziging opgeslagen (debounce).
- CSV-upload gaat naar de `uurdata`-bucket; bij openen wordt de laatste CSV
  weer geladen.
- Overzicht rekent `prijs_kwh` uit `actief_tarief` + eigen tarieven.

## Veiligheid

- **HA-token** alleen in `ha_koppeling` (leesbaar met de server-key) en in het
  geheugen van de backend. Nooit terug naar de browser, nooit in logs.
- **SSRF:** de gebruiker kiest de URL die de backend (in het homelab) aanroept.
  Daarom: alleen `http`/`https`; hostnaam resolven en weigeren als een adres
  privé, loopback, link-local of gereserveerd is — tenzij de host in
  `HA_PRIVE_TOEGESTAAN` staat (voor Eelko's eigen LAN-HA). Geen redirects
  volgen. Ruwe HA-antwoorden gaan nooit door naar de gebruiker, alleen de
  uitkomst. Controle bij elk gebruik, niet alleen bij opslaan, en daarna
  verbinden met het goedgekeurde IP (tegen DNS-rebinding).
- **Cross-user:** `instellingen` en `uurdata` via Apenkaas-permissies
  `user:<id>`; `ha_koppeling` via document-id = gebruikers-id, alleen door de
  backend geschreven.
- Server-key alleen in backend-`.env`; `.env.example` bijwerken met
  placeholders.

## Foutafhandeling

| Situatie | Status | Melding aan gebruiker |
|---|---|---|
| niet ingelogd / token verlopen | 401 | naar inlogscherm (na mislukte refresh) |
| geen koppeling | 404 `geen_koppeling` | schattings-modus + link naar Instellingen |
| HA niet bereikbaar / timeout | 502 | "Je Home Assistant is niet bereikbaar" |
| HA weigert token | 502 | "Home Assistant accepteert het token niet" |
| geen P1 gevonden | 422 | "Geen HomeWizard P1-meter gevonden" |
| URL geweigerd (privé-adres) | 422 | "Dit adres is niet toegestaan" |
| Apenkaas onbereikbaar | 503 | "Apenkaas is even niet bereikbaar" |

Backend logt fouten met gebruikers-id, zonder token.

## Testen

- **Backend (pytest, nieuw):** auth-dependency met nagebootste Apenkaas
  (`httpx.MockTransport`): geldig, ongeldig, cache; P1-detectie (compleet,
  incompleet); URL-controle (publiek ok, 192.168.x geweigerd, allowlist ok,
  localhost geweigerd); `/now` zonder koppeling → 404.
- **Frontend:** bestaande `saldering-model.test.ts` blijft groen; build slaagt.
- **Handmatig in de browser tegen `apenkaas-test`:** registreren → koppelen →
  Overzicht/Advies met live data → schuifjes wijzigen → uitloggen/inloggen →
  alles terug. Tweede gebruiker: CSV-route, ziet niets van gebruiker 1.
