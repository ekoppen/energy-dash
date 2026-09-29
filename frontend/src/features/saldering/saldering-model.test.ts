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
