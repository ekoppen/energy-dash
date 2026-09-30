// saldering-model.test.ts — draai met vitest.
import { describe, it, expect } from "vitest";
import { buildTypicalYear, HourRecord } from "../accu/battery-model";
import {
  sumTotals,
  billWithSaldering,
  billWithoutSaldering,
  analyseSaldering,
  batteryRecovery,
  behaviourEffect,
  gemiddeldInkooptarief,
  prijsNu,
} from "./saldering-model";

const tar = { priceImport: 0.2544, priceFeedIn: 0.06 };

describe("sumTotals", () => {
  it("telt import en export op", () => {
    const hours: HourRecord[] = [{ imp: 2, exp: 1 }, { imp: 0, exp: 3 }];
    const t = sumTotals(hours);
    expect(t.gridImport).toBe(2);
    expect(t.gridExport).toBe(4);
  });
});

describe("saldering vs geen saldering", () => {
  it("zonder saldering is de netto rekening hoger (of gelijk) dan met", () => {
    const t = { gridImport: 3500, gridExport: 4500, selfConsumed: 0 };
    const w = billWithSaldering(t, tar);
    const wo = billWithoutSaldering(t, tar);
    expect(wo.net).toBeGreaterThan(w.net);
  });

  it("saldering streept tot importniveau tegen vol tarief, surplus tegen feedin", () => {
    const t = { gridImport: 1000, gridExport: 1500, selfConsumed: 0 };
    const w = billWithSaldering(t, tar);
    // 1000 gesaldeerd @0.2544 + 500 surplus @0.06
    expect(w.exportValue).toBeCloseTo(1000 * 0.2544 + 500 * 0.06, 4);
  });

  it("impact is positief bij netto teruglevering", () => {
    const hours = buildTypicalYear(4500, 3500);
    const res = analyseSaldering({ hours, tariffs: tar });
    expect(res.yearlyImpact).toBeGreaterThan(0);
  });
});

describe("batteryRecovery", () => {
  it("wint een deel van de schade terug, nooit negatief resterend", () => {
    const hours = buildTypicalYear(4500, 3500);
    const impact = analyseSaldering({ hours, tariffs: tar });
    const rec = batteryRecovery({
      hours,
      spec: { capacity: 10, roundTrip: 0.9 },
      tariffs: tar,
      yearlyImpact: impact.yearlyImpact,
    });
    expect(rec.recoveredPerYear).toBeGreaterThan(0);
    expect(rec.remainingImpact).toBeGreaterThanOrEqual(0);
  });
});

describe("behaviourEffect", () => {
  it("schaalt lineair met de verschoven fractie", () => {
    const totals = { gridImport: 3500, gridExport: 4500, selfConsumed: 0 };
    const a = behaviourEffect({ totals, tariffs: tar, shiftFraction: 0.2 });
    const b = behaviourEffect({ totals, tariffs: tar, shiftFraction: 0.4 });
    expect(b.savingPerYear).toBeCloseTo(2 * a.savingPerYear, 4);
  });

  it("begrenst fractie tussen 0 en 1", () => {
    const totals = { gridImport: 3500, gridExport: 4500, selfConsumed: 0 };
    const over = behaviourEffect({ totals, tariffs: tar, shiftFraction: 1.5 });
    expect(over.shiftFraction).toBe(1);
  });
});

describe("terugleverkosten", () => {
  const t = { gridImport: 1000, gridExport: 1500, selfConsumed: 0 };
  const metKosten = { ...tar, exportCost: 0.1 };

  it("gaan in beide scenario's af van de waarde van alle teruglevering", () => {
    expect(billWithSaldering(t, metKosten).exportValue).toBeCloseTo(1000 * 0.2544 + 500 * 0.06 - 1500 * 0.1, 4);
    expect(billWithoutSaldering(t, metKosten).exportValue).toBeCloseTo(1500 * 0.06 - 1500 * 0.1, 4);
  });

  it("maken een verschoven kWh (accu, gedrag) meer waard", () => {
    const zonder = behaviourEffect({ totals: t, tariffs: tar, shiftFraction: 0.5 });
    const met = behaviourEffect({ totals: t, tariffs: metKosten, shiftFraction: 0.5 });
    expect(met.savingPerYear - zonder.savingPerYear).toBeCloseTo(750 * 0.1, 4);
  });
});

describe("gemiddeldInkooptarief", () => {
  it("weegt piek en dal naar het echte dal-aandeel van de import", () => {
    const hours: HourRecord[] = [{ imp: 3, exp: 0, imp_dal: 3 }, { imp: 1, exp: 0, imp_dal: 0 }];
    expect(gemiddeldInkooptarief(hours, 0.3, 0.2)).toBeCloseTo(0.75 * 0.2 + 0.25 * 0.3, 6);
  });

  it("valt terug op het gemiddelde van piek en dal zonder dal-gegevens", () => {
    expect(gemiddeldInkooptarief([{ imp: 1, exp: 0 }], 0.3, 0.2)).toBeCloseTo(0.25, 6);
    expect(gemiddeldInkooptarief(undefined, 0.3, 0.2)).toBeCloseTo(0.25, 6);
  });
});

describe("prijsNu", () => {
  const basis = { inkooptarief: 0.25, terugleververgoeding: 0.06, terugleverkosten: 0.1 };
  it("toont bij afname het inkooptarief", () => {
    expect(prijsNu({ ...basis, teruglevert: false, moment: new Date("2026-09-30") }).waarde).toBe(0.25);
  });
  it("saldeert teruglevering t/m 2026, min terugleverkosten", () => {
    expect(prijsNu({ ...basis, teruglevert: true, moment: new Date("2026-12-31T12:00:00+01:00") }).waarde).toBeCloseTo(0.15, 6);
  });
  it("geeft vanaf 2027 alleen de vergoeding, min terugleverkosten (kan negatief)", () => {
    expect(prijsNu({ ...basis, teruglevert: true, moment: new Date("2027-01-01T00:00:00+01:00") }).waarde).toBeCloseTo(-0.04, 6);
  });
});
