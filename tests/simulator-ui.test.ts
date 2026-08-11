import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  advanceLocalDateTime,
  automaticDataModeFromSeries,
  integrateWh,
  obstacleBounds,
} from "../src/ui/SimulatorClient";
import {
  rotationIntervalSamples,
  type SimulationKernelInput,
  type SimulationVariantWorkItem,
} from "../src/workers";
import type { WeatherPoint, WeatherSeries } from "../src/lib/weather";
import type { SceneObstacle } from "../src/ui/ThreeWorkspace";

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

describe("SimulatorClient obstacle render/physics alignment", () => {
  const wall: SceneObstacle = {
    id: "rotated-wall",
    type: "wall",
    label: "wall",
    position: [1, 2, 3],
    scale: [2, 1, 0.5],
  };

  it("uses the rendered primitive size and scale for an unrotated world AABB", () => {
    const bounds = obstacleBounds(wall);
    expect(bounds.min).toEqual([0.84, 1.955, 2.997]);
    expect(bounds.max).toEqual([1.16, 2.045, 3.003]);
  });

  it("rotates the scaled local bounds with Three's XYZ Euler pose", () => {
    const yawBounds = obstacleBounds({ ...wall, rotation: [0, Math.PI / 2, 0] });
    expect(yawBounds.min[0]).toBeCloseTo(0.997, 12);
    expect(yawBounds.max[0]).toBeCloseTo(1.003, 12);
    expect(yawBounds.min[1]).toBeCloseTo(1.955, 12);
    expect(yawBounds.max[1]).toBeCloseTo(2.045, 12);
    expect(yawBounds.min[2]).toBeCloseTo(2.84, 12);
    expect(yawBounds.max[2]).toBeCloseTo(3.16, 12);

    const rollBounds = obstacleBounds({ ...wall, rotation: [Math.PI / 2, 0, 0] });
    expect(rollBounds.min[0]).toBeCloseTo(0.84, 12);
    expect(rollBounds.max[0]).toBeCloseTo(1.16, 12);
    expect(rollBounds.min[1]).toBeCloseTo(1.997, 12);
    expect(rollBounds.max[1]).toBeCloseTo(2.003, 12);
    expect(rollBounds.min[2]).toBeCloseTo(2.955, 12);
    expect(rollBounds.max[2]).toBeCloseTo(3.045, 12);
  });

  it("uses full rendered cone extents for mountain and tree proxies", () => {
    const mountain = obstacleBounds({ ...wall, type: "mountain", position: [0, 0, 0], scale: [1, 1, 1] });
    expect(mountain.min).toEqual([-0.09, -0.09, -0.09]);
    expect(mountain.max).toEqual([0.09, 0.09, 0.09]);
    const tree = obstacleBounds({ ...wall, type: "tree", position: [0, 0, 0], scale: [1, 1, 1] });
    expect(tree.min).toEqual([-0.045, -0.06, -0.045]);
    expect(tree.max).toEqual([0.045, 0.06, 0.045]);
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

  it("loads the annual browser worker through the Vite worker bundle", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/ui/SimulatorClient.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('import SimulationWorker from "../workers/simulation.worker?worker";');
    expect(source).toContain("const worker = new SimulationWorker();");
    expect(source).not.toContain('new URL("../workers/simulation.worker.ts", import.meta.url)');
  });
});
