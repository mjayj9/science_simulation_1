import { describe, expect, it } from "vitest";
import { optimizeAnnualFixedPlaneTilt } from "../src/lib/compare";

describe("annual fixed-plane tilt optimization", () => {
  it("numerically locates an interior energy maximum", () => {
    const result = optimizeAnnualFixedPlaneTilt({
      evaluateAnnualEnergyWh: (tiltDeg) => 5_000 - (tiltDeg - 33.4) ** 2,
      coarseStepDeg: 5,
      toleranceDeg: 0.001,
    });

    expect(result.tiltDeg).toBeCloseTo(33.4, 2);
    expect(result.annualEnergyWh).toBeCloseTo(5_000, 3);
    expect(result.method).toBe("bounded-grid-golden-section");
    expect(result.evaluations).toBeGreaterThan(10);
  });

  it("keeps a boundary optimum inside the physical search range", () => {
    const result = optimizeAnnualFixedPlaneTilt({
      evaluateAnnualEnergyWh: (tiltDeg) => 500 - tiltDeg,
      minimumTiltDeg: 0,
      maximumTiltDeg: 75,
    });

    expect(result.tiltDeg).toBe(0);
    expect(result.annualEnergyWh).toBe(500);
  });

  it("rejects invalid energy evaluators rather than hiding them", () => {
    expect(() => optimizeAnnualFixedPlaneTilt({
      evaluateAnnualEnergyWh: () => Number.NaN,
    })).toThrow(/finite nonnegative/);
  });
});
