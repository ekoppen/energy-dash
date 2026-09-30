# Virtuele accu + display-signaal — ontwerp

Status: ontwerp, goedgekeurd in gesprek op 2026-09-30.

## Doel

De ingebruikname van een thuisaccu nadoen zonder er een te kopen. Een virtuele
accu rekent vanaf een gekozen startdatum mee op de echte P1-data uit Home
Assistant en loopt daarna live door. Je ziet wat hij had opgeleverd, en een
display kan live tonen wat hij nu zou doen en of het een goed moment is om een
apparaat aan te zetten.

Voor wie: elke energy-dash-gebruiker met een HA-koppeling (per gebruiker eigen
instellingen, tarieven en sleutel).

Succes:
- Na het kiezen van een startdatum zie je direct de opbrengst sinds die datum,
  per dag, mét en zónder saldering.
- Een display leest met een eigen sleutel één URL uit en krijgt signaal, kleur,
  advies en de accustand.

Buiten scope: dynamische (uur)tarieven, laden op prijs, meerdere virtuele
accu's per gebruiker, het display zelf aansturen (alleen lezen), historische
tarieven (er wordt met de huidige tarieven gerekend).

## Uitgangspunten

- Vast contract (piek/dal + terugleververgoeding + terugleverkosten).
- Aanpak: **steeds opnieuw uitrekenen uit HA-uurstatistieken, met cache** — geen
  opgeslagen accutoestand, geen achtergrondtaak. Instellingen wijzigen rekent de
  hele periode opnieuw door.
- Eén rekenkern, in de backend (Python). De pagina en het display krijgen hun
  cijfers daarvandaan. De jaarschatting in Advies (browser) blijft bestaan.

## 1. Rekenregels (`backend/virtuele_accu.py`, puur, geen I/O)

Invoer: uurrecords `{start, imp, exp, imp_dal}` vanaf de startdatum,
instellingen `{capaciteit_kwh, rendement_pct, max_vermogen_kw}` en tarieven
`{piek, dal, teruglevering, terugleverkosten}`.

Per uur, in deze volgorde (gelijk aan `simulateShifted` in de browser):
1. **Laden** `geladen = min(exp, max_vermogen_kw × 1 h, (capaciteit − soc) / η)`,
   `soc += geladen × η`.
2. **Ontladen** `ontladen = min(imp, max_vermogen_kw × 1 h, soc × η)`,
   `soc −= ontladen / η`.

Met `η = √(rendement)`; de accu start leeg. Per uur wordt bewaard: `soc`,
`geladen` (niet teruggeleverd) en `ontladen` (niet ingekocht).

**Opbrengst.** Twee rekeningen over dezelfde periode, zonder en met accu
(`imp − ontladen`, `exp − geladen`), met dezelfde regels als
`billWithSaldering` / `billWithoutSaldering` in de browser (naar Python
geport), inclusief terugleverkosten. Opbrengst = verschil.
- Inkoopprijs: gewogen naar het dal-aandeel (`imp_dal / imp`) van de periode,
  zoals `gemiddeldInkooptarief`.
- **Zonder saldering** is lineair, dus ook per dag te berekenen:
  `ontladen × inkoopprijs − geladen × vergoeding + geladen × terugleverkosten`.
- **Met saldering** alleen als totaal sinds de start. Beperking: saldering is
  een jaarbegrip; bij een periode korter dan een jaar is dit een benadering.

**Nu (live).** Laadstatus = `soc` na het laatste hele uur uit HA, met
`stand_om` erbij (kan tot een uur oud zijn). Richting en vermogen volgen uit het
live P1-vermogen: bij teruglevering laden met `min(|P|, max)` zolang niet vol,
bij afname ontladen met `min(P, max)` zolang niet leeg, anders `vol`/`leeg`/`stil`.

**Borging.** Dezelfde testgevallen als `simulateShifted` (browser): met
`max_vermogen_kw` = oneindig moet het totaal van `ontladen` gelijk zijn.

## 2. Signaal (`signaal()` in dezelfde module)

Drempel `drempel_w` (standaard 300 W).

| signaal | voorwaarde | kleur |
|---|---|---|
| `goed_moment` | teruglevering > drempel en de accu kan het niet (volledig) opnemen: vol, of overschot > max vermogen | `#3ec46d` groen |
| `accu_laadt` | teruglevering > drempel en de accu neemt het op | `#f0a32a` oranje |
| `accu_ontlaadt` | afname > drempel en de accu dekt het (rest na de accu ≤ drempel) | `#2f6fed` blauw |
| `afname` | afname > drempel en wat na de accu overblijft (rest) is > drempel, ook als de accu leeg is | `#e8654f` rood |
| `rustig` | onder de drempel | `#5d6b78` grijs |
| `fout` | HA-token geweigerd of HA/apenkaas onbereikbaar | `#5d6b78` grijs |

Voor beide richtingen telt de rest na de accu: is die rest ≤ drempel, dan is het gedekt (of `rustig`), anders blijft het groen (`goed_moment`) resp. rood (`afname`).

Zonder virtuele accu (geen startdatum): alleen `goed_moment` (teruglevering >
drempel), `afname`, `rustig`, `fout`; het blok `accu` ontbreekt.
Elk signaal heeft een korte Nederlandse `advies`-tekst.

## 3. Opslag van instellingen

Het bestaande `instellingen`-document (één per gebruiker) krijgt een blok:

```json
"virtuele_accu": {
  "startdatum": "2026-06-01",
  "capaciteit_kwh": 10, "rendement_pct": 90,
  "max_vermogen_kw": 2.5, "drempel_w": 300
}
```

Zonder `startdatum` staat de virtuele accu uit.

**Leesbaar voor de server.** Het document krijgt `readPermissions:
["user:<id>", "app"]`; `writePermissions` blijft `["user:<id>"]`.
- Nieuwe documenten worden zo aangemaakt (de browser kent `userId` uit de sessie).
- Gebruikers kunnen de rechten van een bestaand document niet wijzigen (alleen de
  service-role/server kan dat via apenkaas' setDocumentPermissions); daarom zet de
  browser het om door een kopie te maken. Een
  bestaand document zonder `app` wordt bij het laden omgezet: nieuw document met
  dezelfde data en de juiste rechten aanmaken, daarna het oude verwijderen.
- De server zoekt het document van gebruiker X door de app-leesbare
  documenten van de collectie te doorlopen en het (meest recent bijgewerkte)
  document te kiezen waarvan `write_permissions` `user:X` bevat. Omdat
  gebruikers geen rechten voor een ander mogen toekennen, kan niemand een
  document namens X neerzetten.
  *ponytail: lineair doorlopen per cache-miss; prima voor tientallen
  gebruikers. Opwaarderen: document-id = gebruikers-id.*

## 4. Display-sleutel

- Collectie **`display_sleutels`** (manifest `apenkaas.json`, `createPermissions: []`,
  alleen server, schema `user_id: string`). Document-id = `sha256(sleutel)`, data
  `{ "user_id": "<id>" }`, lees/schrijf `app`. De sleutel zelf wordt nergens opgeslagen.
- Vervangen/intrekken: de server zoekt met het filter `?user_id=eq.<id>` alle
  sleuteldocumenten van de gebruiker op en verwijdert ze (bij vervangen vóór het
  aanmaken van de nieuwe). Ontkoppelen van HA raakt de sleutel niet.
- Formaat: `ed_` + 32 willekeurige bytes (base64url). Eén per gebruiker.
- Routes (met gebruikers-JWT):
  - `POST /display-sleutel` → maakt (of vervangt) de sleutel en geeft hem één keer terug.
  - `DELETE /display-sleutel` → trekt hem in.
  - `GET /display-sleutel` → `{ "actief": true|false }`.

## 5. Endpoints

**`GET /signaal`** — voor displays.
- Sleutel via `Authorization: Bearer <sleutel>` of `?sleutel=<sleutel>`.
  Onbekende sleutel → 401. De sleutel geeft alleen toegang tot deze route.
  De `?sleutel=`-vorm is voor eenvoudige apparaten zonder headers; hij kan in
  access-logs belanden (nginx), dus de header heeft de voorkeur.
- Antwoord:

```json
{
  "tijd": "2026-09-30T14:23:05+02:00",
  "vermogen_w": -1850, "tarief": "piek",
  "signaal": "accu_laadt", "kleur": "#f0a32a",
  "advies": "Overschot gaat de virtuele accu in",
  "accu": {
    "laadstatus_pct": 64, "laadstatus_kwh": 6.4, "stand_om": "14:00",
    "status": "laden", "vermogen_w": 1850,
    "opbrengst_vandaag_eur": 0.84,
    "opbrengst_sinds_start_eur": { "met_saldering": 3.20, "zonder_saldering": 41.80 }
  }
}
```

`opbrengst_vandaag_eur` is zonder saldering (per dag heeft saldering geen betekenis).

**`GET /accu`** — voor de pagina (gebruikers-JWT). Geeft `instellingen`,
`nu` (zelfde vorm als `/signaal`), `totaal` (opbrengst beide scenario's,
kWh minder teruggeleverd/ingekocht, volle cycli = totaal ontladen / capaciteit)
en `dagen`:
`[{ "datum", "opbrengst_eur", "geladen_kwh", "ontladen_kwh", "laadstatus_eind_pct" }]`.

**Cache (per proces, in het geheugen).**
- Uurberekening: per gebruiker, sleutel = (startdatum, accu-instellingen,
  tarieven); geldig tot het volgende hele uur.
- Live vermogen + tarief: per gebruiker 10 s. Een display dat vaker vraagt, raakt
  HA hooguit eens per 10 s.
- Instellingen-document: per gebruiker 60 s.

**Grenzen.** Startdatum maximaal 730 dagen terug (zelfde grens als `/hours`),
niet in de toekomst. Geweigerd HA-token: bestaande `_geweigerde_tokens`-bescherming
geldt; `/signaal` geeft dan `signaal: "fout"` met een melding (HTTP 200, zodat een
display gewoon grijs kan tonen). Alle HA-aanroepen gaan via de bestaande
SSRF/DNS-rebinding-veilige paden.

## 6. Pagina "Virtuele accu" (frontend)

Nieuw tabblad naast Overzicht, Advies en Instellingen.
- **Instellen**: startdatum, capaciteit, rendement, max vermogen, drempel;
  knop "Neem over uit Advies" (capaciteit + rendement uit `advies`). Opslaan in het
  instellingen-document; daarna `/accu` opnieuw ophalen.
- **Display-sleutel**: aanmaken/vervangen/intrekken, eenmalig tonen met
  voorbeeld (`curl -H "Authorization: Bearer …" http://…/api/signaal`).
- **Nu**: laadstatusbalk (% en kWh, "stand om"), status + vermogen, signaal met
  kleur en advies.
- **Sinds de start**: opbrengst met/zonder saldering, kWh minder
  teruggeleverd/ingekocht, volle cycli.
- **Grafiek per dag**: staaf = opbrengst zonder saldering, lijn = laadstatus aan
  het eind van de dag. Inline SVG, geen nieuwe dependency.

Geen koppeling → uitleg + link naar Instellingen. Verversen van "Nu": elke 30 s,
stopt bij `ha_token`/`geen_koppeling` (zelfde patroon als Overzicht).

## 7. Tests

Backend (pytest):
- Rekenkern: laden/ontladen, rendement, max vermogen, vol/leeg, start leeg;
  gedeelde testgevallen met `simulateShifted`; opbrengst met/zonder saldering
  inclusief terugleverkosten; dagopbrengst sommeert tot het totaal.
- Signaal: elke rij van de tabel, met en zonder accu.
- Instellingen opzoeken: kiest het document met `user:X` in
  `write_permissions`, negeert andermans documenten.
- Sleutel: aanmaken → alleen hash opgeslagen; vervangen trekt alle oude in (filter op `user_id`);
  onbekende sleutel 401; sleutel werkt niet op andere routes.
- `/signaal` met geweigerd token → `fout` zonder HA-aanroep.
- Cache: tweede aanroep binnen 10 s doet geen HA-aanroep.

Frontend (vitest): omzetten van bestaand instellingen-document (nieuw
aanmaken, oud verwijderen); nieuw document krijgt `app`-leesrecht.

Handmatig: pagina met echte HA-data, display-URL met `curl`.

## 8. Uitrol

- `apenkaas.json`: collectie `display_sleutels`; `push.mjs` tegen apenkaas-test.
- Schema `instellingen` blijft (het blok `virtuele_accu` is een object en valt
  buiten de schematypes; onbekende velden zijn toegestaan).
- Docker-stack opnieuw bouwen.
