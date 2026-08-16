import { describe, expect, it } from "vitest";
import {
  OPTICAL_SPHERE_FIXTURE,
  RESEARCH_CONDITION_MATRIX,
  ROTATING_DISK_FIXTURE,
  runOpticalGeometryBenchmark,
  runResearchReproductionAudit,
  runRotatingThermalBenchmark,
} from "../src/lib/research/benchmarks";

describe("source-equivalent research reproduction", () => {
  it("keeps A-D unevaluated and excludes them from successful benchmark counts", () => {
    const audit = runResearchReproductionAudit();
    const original = audit.filter((row) => row.studyId.startsWith("research:"));
    const evaluated = audit.filter((row) => row.verdict !== "not-evaluated");

    expect(original).toHaveLength(4);
    expect(original.every((row) => row.verdict === "not-evaluated" && row.metrics.length === 0)).toBe(true);
    expect(evaluated.map((row) => row.studyId)).toEqual(["source:E", "source:F"]);
    expect(evaluated.every((row) => row.verdict === "pass")).toBe(true);
  });

  it("reproduces the AIP day-81 spherical direct-beam values without an output multiplier", () => {
    const result = runOpticalGeometryBenchmark();
    const surface = result.metrics.find((metric) => metric.metric.includes("sphere surface"));
    const land = result.metrics.find((metric) => metric.metric.includes("ground-occupied"));

    expect(result.verdict).toBe("pass");
    expect(surface?.reportedValue).toBe(OPTICAL_SPHERE_FIXTURE.reportedSurfaceEnergyMJm2);
    expect(land?.reportedValue).toBe(OPTICAL_SPHERE_FIXTURE.reportedLandEnergyMJm2);
    expect(surface?.simulatedValue).toBeCloseTo(8.3535332654, 7);
    expect(land?.simulatedValue).toBeCloseTo(33.4141330617, 7);
    expect((land?.simulatedValue ?? 0) / (surface?.simulatedValue ?? 1)).toBeCloseTo(4, 12);
    for (const metric of result.metrics) {
      expect(metric.absoluteError).toBeCloseTo(Math.abs(metric.simulatedValue - metric.reportedValue), 12);
      expect(metric.relativeErrorPercent).toBeLessThanOrEqual(metric.tolerancePercent);
      expect(metric.verdict).toBe("pass");
    }
  });

  it("recomputes experiment-1 rotating-disk Reynolds and Nusselt values inside published uncertainty", () => {
    const result = runRotatingThermalBenchmark();
    const reynolds = result.metrics.find((metric) => metric.metric.includes("Reynolds"));
    const nusselt = result.metrics.find((metric) => metric.metric.includes("Nusselt"));

    expect(result.verdict).toBe("pass");
    expect(reynolds?.reportedValue).toBe(ROTATING_DISK_FIXTURE.reportedReynolds);
    expect(reynolds?.simulatedValue).toBeCloseTo(82_955.0512602, 6);
    expect(reynolds?.relativeErrorPercent).toBeCloseTo(1.1357066546, 8);
    expect(nusselt?.simulatedValue).toBeCloseTo(103.6869068076, 8);
    expect(reynolds?.relativeErrorPercent).toBeLessThanOrEqual(1.72);
    expect(nusselt?.relativeErrorPercent).toBeLessThanOrEqual(2.16);
    expect(result.sensitivity[0].upperValue).not.toBeCloseTo(result.sensitivity[0].lowerValue, 4);
  });

  it("is deterministic and closes every numeric error calculation", () => {
    const first = runResearchReproductionAudit();
    const second = runResearchReproductionAudit();
    expect(second).toEqual(first);
    for (const study of first) {
      for (const metric of study.metrics) {
        const expectedRelative = Math.abs(metric.simulatedValue - metric.reportedValue)
          / Math.abs(metric.reportedValue) * 100;
        expect(metric.relativeErrorPercent).toBeCloseTo(expectedRelative, 12);
      }
    }
  });

  it("publishes the requested condition categories for every A-F study", () => {
    expect(RESEARCH_CONDITION_MATRIX.map((row) => row.studyId)).toEqual([
      "research:A",
      "research:B",
      "research:C",
      "research:D",
      "source:E",
      "source:F",
    ]);
    for (const row of RESEARCH_CONDITION_MATRIX) {
      expect(row.geometry.length).toBeGreaterThan(10);
      expect(row.areaBasis.length).toBeGreaterThan(10);
      expect(row.sourceAndSpectrum.length).toBeGreaterThan(10);
      expect(row.incidence.length).toBeGreaterThan(10);
      expect(row.weather.length).toBeGreaterThan(10);
      expect(row.albedoAndReflector.length).toBeGreaterThan(10);
      expect(row.thermalAndConvection.length).toBeGreaterThan(10);
      expect(row.electricalConnection.length).toBeGreaterThan(10);
      expect(row.measuredQuantity.length).toBeGreaterThan(10);
      expect(row.primarySourceUrls.length).toBeGreaterThan(0);
      expect(row.primarySourceUrls.every((url) => url.startsWith("https://"))).toBe(true);
    }
  });
});
