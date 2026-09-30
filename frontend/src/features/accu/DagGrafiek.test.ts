import { describe, expect, it } from "vitest";
import { asStappen } from "./DagGrafiek";

describe("asStappen", () => {
  it("geeft ronde stappen vanaf 0 die het maximum omvatten", () => {
    expect(asStappen(0, 1.69)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(asStappen(0, 0.07)).toEqual([0, 0.02, 0.04, 0.06, 0.08]);
  });
  it("loopt door onder nul bij negatieve dagen", () => {
    const s = asStappen(-0.3, 1.2);
    expect(s[0]).toBeLessThanOrEqual(-0.3);
    expect(s).toContain(0);
    expect(s[s.length - 1]).toBeGreaterThanOrEqual(1.2);
  });
});
