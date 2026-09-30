// saldering-model.ts
// Rekent de gevolgen van de salderingsstop door op basis van ECHTE uurdata.
//
// Kern-inzicht: saldering rekent per jaar op TOTALEN (jaarexport wordt van
// jaarimport afgetrokken tegen vol tarief). Zonder saldering telt alleen de
// export die je OP HETZELFDE MOMENT zelf gebruikt tegen vol tarief; de rest
// (netto naar het net) krijgt alleen het lage teruglevertarief. Daarom is
// uurdata nodig — het momentane saldo bepaalt de schade.
//
// Deze module is puur (geen React) en deelt HourRecord met battery-model.ts.

import { HourRecord, BatterySpec, simulateShifted } from "../accu/battery-model";

export interface Tariffs {
  /** gemiddeld/relevant inkooptarief, €/kWh (bv. 0.2544 piek of een mix) */
  priceImport: number;
  /** teruglevertarief na saldering, €/kWh (Coolblue: 0.06) */
  priceFeedIn: number;
  /** terugleverkosten van de leverancier, €/kWh over alle teruglevering (default 0) */
  exportCost?: number;
}

/** Wat elke teruggeleverde kWh aan terugleverkosten kost. */
// ponytail: kosten over álle teruglevering, zoals de meeste leveranciers nu rekenen;
// sommige rekenen alleen over het netto-overschot of een staffel — voeg dat toe als het nodig is.
function exportCosts(t: SalderingTotals, tar: Tariffs): number {
  return t.gridExport * (tar.exportCost ?? 0);
}

/** Waarde van een kWh die je zelf gebruikt i.p.v. terug te leveren (zonder saldering). */
function shiftedKwhValue(tar: Tariffs): number {
  return tar.priceImport - tar.priceFeedIn + (tar.exportCost ?? 0);
}

/**
 * Gemiddeld inkooptarief, gewogen naar het echte dal-aandeel van de import
 * (imp_dal uit de P1-teller T1). Zonder dal-gegevens (CSV/schatting): het
 * gemiddelde van piek en dal.
 */
export function gemiddeldInkooptarief(hours: HourRecord[] | undefined, piek: number, dal: number): number {
  let imp = 0;
  let impDal = 0;
  let heeftDal = false;
  for (const h of hours ?? []) {
    imp += h.imp;
    if (h.imp_dal !== undefined) { impDal += h.imp_dal; heeftDal = true; }
  }
  if (!heeftDal || imp <= 0) return (piek + dal) / 2;
  const aandeelDal = impDal / imp;
  return aandeelDal * dal + (1 - aandeelDal) * piek;
}

export interface SalderingTotals {
  /** totaal van het net afgenomen (kWh) */
  gridImport: number;
  /** totaal aan het net teruggeleverd (kWh) */
  gridExport: number;
  /** bruto opgewekt en direct zelf gebruikt — niet meetbaar met alleen P1;
   *  hier afgeleid als (verbruik dat samenvalt met opwek). Zie note. */
  selfConsumed: number;
}

export interface BillBreakdown {
  /** kosten van afgenomen stroom, € */
  importCost: number;
  /** opbrengst/verrekening van teruglevering, € (positief = voordeel) */
  exportValue: number;
  /** netto variabele stroomkosten, € (importCost − exportValue) */
  net: number;
}

export interface SalderingImpact {
  totals: SalderingTotals;
  /** rekening zoals nu, mét saldering */
  withSaldering: BillBreakdown;
  /** rekening vanaf 2027, zónder saldering */
  withoutSaldering: BillBreakdown;
  /** het verschil per jaar (de "salderingsschade"), € */
  yearlyImpact: number;
  /** hoeveel van de export je op het moment zelf gebruikte, kWh */
  simultaneousSelfUse: number;
  /** hoeveel export netto naar het net ging (verliest waarde), kWh */
  netExportToGrid: number;
}

/**
 * Sommeert uurdata tot jaartotalen, met de momentane zelf-consumptie.
 * Bij P1-data is imp/exp al het NETTO uursaldo (na eigen verbruik), dus
 * "gelijktijdig zelf gebruikt" zit al verwerkt in een lagere exp. Wat we hier
 * meten is het netto dat nog naar het net gaat — dat is wat waarde verliest.
 */
export function sumTotals(hours: HourRecord[]): SalderingTotals {
  let gridImport = 0;
  let gridExport = 0;
  for (const h of hours) {
    gridImport += h.imp;
    gridExport += h.exp;
  }
  // Met alleen P1-data kennen we bruto-opwek niet; selfConsumed laten we 0
  // tenzij later een opwek-sensor beschikbaar is. De analyse werkt op het
  // netto-saldo, wat voor de saldering-vraag het relevante getal is.
  return { gridImport, gridExport, selfConsumed: 0 };
}

/** Rekening MET saldering: jaarexport wordt tegen vol tarief weggestreept. */
export function billWithSaldering(t: SalderingTotals, tar: Tariffs): BillBreakdown {
  // Salderen kan tot het niveau van je import; overschot daarboven krijgt
  // alleen het teruglevertarief.
  const salderable = Math.min(t.gridExport, t.gridImport);
  const surplus = Math.max(0, t.gridExport - t.gridImport);
  const importCost = t.gridImport * tar.priceImport;
  // Gesaldeerde export bespaart vol tarief; surplus levert teruglevertarief op.
  const exportValue = salderable * tar.priceImport + surplus * tar.priceFeedIn - exportCosts(t, tar);
  return { importCost, exportValue, net: importCost - exportValue };
}

/** Rekening ZONDER saldering: alle export telt alleen tegen teruglevertarief. */
export function billWithoutSaldering(t: SalderingTotals, tar: Tariffs): BillBreakdown {
  const importCost = t.gridImport * tar.priceImport;
  const exportValue = t.gridExport * tar.priceFeedIn - exportCosts(t, tar);
  return { importCost, exportValue, net: importCost - exportValue };
}

/**
 * Volledige salderingsimpact uit uurdata. yearScale normaliseert naar 1 jaar
 * als de data een andere periode beslaat (8760 / aantal_uren).
 */
export function analyseSaldering(opts: {
  hours: HourRecord[];
  tariffs: Tariffs;
  yearScale?: number;
}): SalderingImpact {
  const { hours, tariffs } = opts;
  const yearScale = opts.yearScale ?? 1;

  const raw = sumTotals(hours);
  const totals: SalderingTotals = {
    gridImport: raw.gridImport * yearScale,
    gridExport: raw.gridExport * yearScale,
    selfConsumed: raw.selfConsumed * yearScale,
  };

  const withSaldering = billWithSaldering(totals, tariffs);
  const withoutSaldering = billWithoutSaldering(totals, tariffs);
  const yearlyImpact = withoutSaldering.net - withSaldering.net;

  const simultaneousSelfUse = 0; // vereist bruto-opwek; zie note in sumTotals
  const netExportToGrid = totals.gridExport;

  return {
    totals,
    withSaldering,
    withoutSaldering,
    yearlyImpact,
    simultaneousSelfUse,
    netExportToGrid,
  };
}

// ---------------------------------------------------------------------------
// Wat wint een ACCU terug van de salderingsschade?
// ---------------------------------------------------------------------------

export interface BatteryRecovery {
  /** kWh die de accu verschuift van overschot naar eigen verbruik */
  shiftedKwh: number;
  /** € die de accu per jaar terugwint t.o.v. de situatie zonder saldering */
  recoveredPerYear: number;
  /** resterende schade na accu, € (impact − teruggewonnen) */
  remainingImpact: number;
}

export function batteryRecovery(opts: {
  hours: HourRecord[];
  spec: BatterySpec;
  tariffs: Tariffs;
  yearlyImpact: number;
  yearScale?: number;
}): BatteryRecovery {
  const { hours, spec, tariffs, yearlyImpact } = opts;
  const yearScale = opts.yearScale ?? 1;

  const shiftedKwh = simulateShifted(hours, spec) * yearScale;
  // Elke verschoven kWh: je gebruikt 'm zelf (vermijdt inkoop, vol tarief)
  // i.p.v. 'm voor het lage teruglevertarief weg te geven (en er
  // terugleverkosten over te betalen).
  const valuePerKwh = shiftedKwhValue(tariffs);
  const recoveredPerYear = shiftedKwh * valuePerKwh;
  const remainingImpact = Math.max(0, yearlyImpact - recoveredPerYear);

  return { shiftedKwh, recoveredPerYear, remainingImpact };
}

// ---------------------------------------------------------------------------
// Wat levert MEER ZELF-VERBRUIKEN op (gedrag)?
// Simuleert het verschuiven van een deel van het verbruik naar de zon-uren.
// ---------------------------------------------------------------------------

export interface BehaviourEffect {
  /** aangenomen extra zelf-verbruik als fractie van export (0..1) */
  shiftFraction: number;
  /** kWh die van net-export naar direct zelf-verbruik verschuift */
  shiftedKwh: number;
  /** € die dit per jaar oplevert zonder saldering */
  savingPerYear: number;
}

/**
 * Eenvoudig gedragsmodel: als je een fractie f van je overschot naar het moment
 * van opwek verschuift (apparaten overdag draaien), gebruik je die kWh zelf.
 * Zonder saldering is dat weer het volle prijsverschil waard.
 */
export function behaviourEffect(opts: {
  totals: SalderingTotals;
  tariffs: Tariffs;
  shiftFraction: number;
}): BehaviourEffect {
  const { totals, tariffs, shiftFraction } = opts;
  const f = Math.min(1, Math.max(0, shiftFraction));
  const shiftedKwh = totals.gridExport * f;
  const savingPerYear = shiftedKwh * shiftedKwhValue(tariffs);
  return { shiftFraction: f, shiftedKwh, savingPerYear };
}

// ---------------------------------------------------------------------------
// Live: wat is een kWh op dit moment waard (Overzicht)?
// ---------------------------------------------------------------------------

export const SALDERING_STOPT = new Date("2027-01-01T00:00:00+01:00");

/**
 * Prijs of waarde per kWh op dit moment. Bij afname: je inkooptarief.
 * Bij teruglevering: t/m 2026 gesaldeerd (je inkooptarief), daarna de
 * terugleververgoeding — in beide gevallen min de terugleverkosten.
 */
// ponytail: live weten we niet of je dit jaar al boven je import uitkomt (dan is
// ook nu alleen de vergoeding van toepassing); daarvoor is het jaarsaldo nodig.
export function prijsNu(o: {
  inkooptarief: number;
  terugleververgoeding: number;
  terugleverkosten: number;
  teruglevert: boolean;
  moment: Date;
}): { waarde: number; uitleg: string } {
  if (!o.teruglevert) return { waarde: o.inkooptarief, uitleg: "per kWh, jouw inkooptarief" };
  if (o.moment < SALDERING_STOPT) {
    return { waarde: o.inkooptarief - o.terugleverkosten, uitleg: "per teruggeleverde kWh: gesaldeerd, min terugleverkosten" };
  }
  return { waarde: o.terugleververgoeding - o.terugleverkosten, uitleg: "per teruggeleverde kWh: vergoeding min terugleverkosten" };
}
