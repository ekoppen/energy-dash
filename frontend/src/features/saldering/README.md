# Feature: saldering-impact analyse

Berekent wat de **salderingsstop (vanaf 1 januari 2027)** voor Eelko betekent,
op basis van echte HA-uurdata. Drie lagen in één scherm:

1. **Jaarrekening mét vs zónder saldering** → de kale "salderingsschade".
2. **Wat een accu ervan terugwint** (verschuift overschot naar eigen gebruik).
3. **Wat meer zelf-verbruiken oplevert** (gedrag: apparaten overdag draaien).

## Bestanden
- `saldering-model.ts` — pure rekenlogica. Hergebruikt `HourRecord` en
  `simulateShifted` uit `../accu/battery-model.ts`.
- `SalderingImpact.tsx` — React-component (UI + state).
- `saldering-model.test.ts` — tests (vitest).

## De kernredenering (belangrijk)
- **Met saldering** wordt je jaarexport tegen je jaarimport weggestreept tegen
  het volle inkooptarief (tot importniveau; surplus daarboven krijgt alleen het
  teruglevertarief).
- **Zonder saldering** telt álle export enkel tegen het teruglevertarief (~€0,06).
- Het verschil = de jaarlijkse schade. Voor Eelko's schatting (~3500 import,
  ~4500 export): ordegrootte €600–700/jaar. Exact getal komt uit echte uurdata.

## Databron-modi (prioriteit hoog→laag)
1. `liveHours` prop — echte HA-uurdata via de backend (recorder-statistieken van
   import- en export-entiteiten). Nauwkeurigst.
2. CSV-upload — fallback.
3. Schatting uit jaartotalen — default.

## Integratie (Advies-route)
```tsx
<SalderingImpact liveHours={hours} liveHoursSpan={hours.length}
  defaultPriceImport={0.2544} defaultPriceFeedIn={0.06} />
```
Zelfde `hours`-array als de accu-feature — één backend-endpoint voedt beide.

## Belangrijke kanttekening (P1-beperking)
De P1 meet alleen het netsaldo, niet de bruto opwek. `selfConsumed` blijft
daarom 0 en de analyse werkt op het netto import/export-saldo — wat voor de
saldering-vraag precies het juiste getal is (het gaat om wat naar/van het net
gaat). Wil je ook echt zelfconsumptie-% tonen, dan is een omvormer-sensor nodig.
