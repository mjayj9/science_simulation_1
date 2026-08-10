import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  advanceLocalDateTime,
  automaticDataModeFromSeries,
  integrateWh,
} from "../src/ui/SimulatorClient";
import {
  rotationIntervalSamples,
  type SimulationKernelInput,
  type SimulationVariantWorkItem,
} from "../src/workers";
import type { WeatherPoint, WeatherSeries } from "../src/lib/weather";

function weatherPoint(timeUtcMs: number): WeatherPoint {
  return {
    timeUtcMs,
    ghiWm2: 600,
    dniWm2: 1_000,
    dhiWm2: 100,
    ambientC: 25,
    windSpeedMs: 0,
    windDirectionDeg: 0,
    gustMs: 0,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

function automaticSeries(provider: WeatherSeries["provenance"]["provider"]): WeatherSeries {
  return {
    points: [weatherPoint(0)],
    provenance: {
      provider,
      kind: provider === "manual" ? "manual" : provider === "offline" ? "model-estimate" : "tmy",
      labelKo: "테스트",
      fetchedAt: new Date(0).toISOString(),
      temporalResolution: "1 hour",
    },
  };
}

function oneDayPeriodicEnergy(samplesPerTurn: number): number {
  const start = Date.UTC(2026, 5, 21);
  const weather = Array.from({ length: 25 }, (_, index) => weatherPoint(start + index * 3_600_000));
  const variant: SimulationVariantWorkItem = {
    variantId: "ui-daily-test",
    panelCount: 1,
    totalPanelAreaM2: 1,
    referenceEfficiency: 1,
    rotation: { mode: "fixed", rpm: 1 / 60, initialAngleRad: 0, referenceTimestamp: start },
    rotationPhaseSamples: samplesPerTurn,
  };
  const input: SimulationKernelInput = { variants: [variant], weather };
  const points = weather.map((point, stepIndex) => {
    const samples = rotationIntervalSamples({ input, variant, weather: point, stepIndex });
    const ac = samples.reduce(
      (sum, sample) => sum + Math.max(0, Math.cos(sample.angleRad)) * 100 * sample.weight,
      0,
    );
    return {
      minute: stepIndex * 60,
      ac,
      intervalMean: samples[0]?.intervalAveraged ?? false,
    };
  });
  return integrateWh(points);
}

describe("SimulatorClient time and data-mode helpers", () => {
  it("preserves date/month/year rollover during playback", () => {
    expect(advanceLocalDateTime("2026-06-21T23:30", 60)).toBe("2026-06-22T00:30");
    expect(advanceLocalDateTime("2026-12-31T23:30", 60)).toBe("2027-01-01T00:30");
  });

  it("never resolves the automatic-source tab back to manual", () => {
    expect(automaticDataModeFromSeries(null)).toBe("offline");
    expect(automaticDataModeFromSeries(automaticSeries("manual"))).toBe("offline");
    expect(automaticDataModeFromSeries(automaticSeries("offline"))).toBe("offline");
    expect(automaticDataModeFromSeries(automaticSeries("pvgis"))).toBe("pvgis-file");
  });
});

describe("SimulatorClient fixed-RPM daily integration", () => {
  it("uses an interval mean once instead of trapezoid-averaging adjacent interval means", () => {
    expect(integrateWh([
      { minute: 0, ac: 10, intervalMean: true },
      { minute: 60, ac: 1_000, intervalMean: false },
    ])).toBe(10);
    expect(integrateWh([
      { minute: 0, ac: 10, intervalMean: false },
      { minute: 60, ac: 20, intervalMean: false },
    ])).toBe(15);
  });

  it("converges full-day energy as periodic phase density increases", () => {
    const analytic = 24 * 100 / Math.PI;
    const error12 = Math.abs(oneDayPeriodicEnergy(12) - analytic);
    const error24 = Math.abs(oneDayPeriodicEnergy(24) - analytic);
    const error72 = Math.abs(oneDayPeriodicEnergy(72) - analytic);
    expect(error24).toBeLessThan(error12);
    expect(error72).toBeLessThan(error24);
    expect(error72 / analytic).toBeLessThan(0.001);
  });

  it("keeps the production UI wired to periodic quadrature and selected-panel POA", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/ui/SimulatorClient.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("rotationIntervalSamples({");
    expect(source).not.toContain("const phaseCap =");
    expect(source).not.toContain("const turnsInInterval =");
    expect(source).toContain("poa += (diagnosticPanel?.poaWm2 ?? 0) * phase.weight");
    expect(source).toContain("const daylight = solar.elevationDeg > 0;");
    expect(source).toContain("automaticWeatherSeries: safeStoredWeatherSeries(automaticWeatherSeries)");
    expect(source).toContain("selectedPanel.effectiveWm2 / 10)).toFixed(4)");
  });
});
