import { describe, expect, it } from "vitest";
import { createContinuousSurface } from "../src/lib/geometry";
import { DEFAULT_ELECTRICAL } from "../src/lib/physics";
import type { WeatherPoint } from "../src/lib/weather";
import {
  CONTINUOUS_SURFACE_MODEL_VERSION,
  SIMULATION_CACHE_VERSION,
  SIMULATION_WORKER_PROTOCOL_VERSION,
  computePhysicsStep,
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  simulationInputFingerprint,
  validateKernelInput,
  type SimulationKernelInput,
  type SimulationResultRow,
} from "../src/workers";

const HOUR_MS = 3_600_000;

function point(timeUtcMs: number, irradianceWm2 = 1_000): WeatherPoint {
  return {
    timeUtcMs,
    ghiWm2: irradianceWm2,
    dniWm2: irradianceWm2,
    dhiWm2: 0,
    ambientC: 25,
    windSpeedMs: 0,
    windDirectionDeg: 0,
    gustMs: 0,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

const CONNECTION = {
  nominalCellAreaM2: 0.01,
  parallelStrings: 2,
  cellsPerBypassSubstring: 5,
  bypassForwardVoltageV: 0.5,
  stringWiringResistanceOhm: 0,
  arrayWiringResistanceOhm: 0,
  cellIvModel: "piecewise-nameplate",
  circuitSamples: 512,
} as const;

function pairedInput(
  weather: WeatherPoint[],
  mutateEngineering?: (input: SimulationKernelInput) => void,
): SimulationKernelInput {
  const surface = createContinuousSurface("sphere", 16);
  const shared = {
    landAreaM2: surface.dimensions.footprintM2,
    surfaceOptions: {
      albedo: 0,
      iam: { model: "none" as const },
      diffuseModel: "isotropic" as const,
      soilingLossFraction: 0,
    },
  };
  const input: SimulationKernelInput = {
    mode: "annual",
    maximumGapHours: 6,
    chunkSize: 24,
    variants: [
      {
        variantId: "ideal",
        referenceEfficiency: 0.2,
        inverter: false,
        continuousSurface: createContinuousSurfaceWorkItem(surface, shared),
      },
      {
        variantId: "engineering",
        referenceEfficiency: 0.2,
        inverter: false,
        continuousSurface: createContinuousSurfaceWorkItem(surface, {
          ...shared,
          electricalModel: "explicit-series-parallel-bypass",
          engineeringConnection: CONNECTION,
        }),
      },
    ],
    weather,
    physics: {
      solarOverride: { azimuthDeg: 180, elevationDeg: 45 },
      electrical: { mode: "simple", config: DEFAULT_ELECTRICAL },
      panelDefaults: { soilingLossFraction: 0 },
      inverter: false,
    },
  };
  mutateEngineering?.(input);
  return input;
}

async function run(input: SimulationKernelInput, requestId: string) {
  const rows: SimulationResultRow[] = [];
  const complete = await runSimulationKernel(createSimulationRunRequest(requestId, input), {
    onChunk: (event) => { rows.push(...event.rows); },
    yieldControl: async () => undefined,
  });
  return { rows, complete };
}

function regionSum(
  row: SimulationResultRow,
  field: "dcPowerW" | "acPowerW",
): number {
  return Object.values(row.surfaceRegionsByVariant.engineering)
    .reduce((sum, region) => sum + region[field], 0);
}

describe("continuous-surface engineering electrical worker", () => {
  it("bumps protocol/cache/model identity and fingerprints connection changes", () => {
    expect(SIMULATION_WORKER_PROTOCOL_VERSION).toBe(4);
    expect(SIMULATION_CACHE_VERSION).toBe(5);
    expect(CONTINUOUS_SURFACE_MODEL_VERSION).toBe("continuous-pv-electrical-v2");
    const start = Date.UTC(2026, 5, 21, 3);
    const input = pairedInput([point(start), point(start + HOUR_MS)]);
    const baseline = simulationInputFingerprint(input);
    expect(baseline).toMatch(/^sim-v4-cache-v5-/);
    const changed = structuredClone(input);
    const surface = changed.variants[1].continuousSurface!;
    if (surface.electricalModel !== "explicit-series-parallel-bypass") throw new Error("fixture");
    surface.engineeringConnection.cellsPerBypassSubstring += 1;
    expect(simulationInputFingerprint(changed)).not.toBe(baseline);
  });

  it("requires an explicit, bounded engineering cell density and topology", () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = pairedInput([point(start), point(start + HOUR_MS)]);
    expect(validateKernelInput(input)).toBe(input);
    const missing = structuredClone(input);
    (missing.variants[1].continuousSurface as unknown as Record<string, unknown>).engineeringConnection = undefined;
    expect(() => validateKernelInput(missing)).toThrow(/engineeringConnection is required/);
    const tooDense = structuredClone(input);
    const surface = tooDense.variants[1].continuousSurface!;
    if (surface.electricalModel !== "explicit-series-parallel-bypass") throw new Error("fixture");
    surface.engineeringConnection.nominalCellAreaM2 = 1e-9;
    expect(() => validateKernelInput(tooDense)).toThrow(/maximum is 4096/);
    const unsupportedTransient = structuredClone(input);
    const variant = unsupportedTransient.variants[1];
    variant.annualTransientThermal = {
      surface: createContinuousSurface("sphere", 16),
      gammaPerC: -0.004,
    };
    expect(() => validateKernelInput(unsupportedTransient)).toThrow(/does not yet support explicit/);
  });

  it("uses the explicit connection at uniform weather without exceeding the local-MPP surface upper bound", async () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = pairedInput([point(start), point(start + HOUR_MS)]);
    input.physics!.solarOverride = { azimuthDeg: 180, elevationDeg: 90 };
    const { rows, complete } = await run(input, "engineering-uniform");
    rows.forEach((row) => {
      const ideal = row.dcPowerWByVariant.ideal;
      const engineering = row.dcPowerWByVariant.engineering;
      expect(engineering).toBeLessThanOrEqual(ideal + 1e-9);
      expect(engineering).toBeGreaterThan(0);
      expect(row.mismatchLossFractionByVariant.engineering).toBeGreaterThan(0);
      expect(row.bypassActiveCountByVariant.engineering).toBe(0);
      expect(regionSum(row, "dcPowerW")).toBeCloseTo(engineering, 11);
      expect(regionSum(row, "acPowerW")).toBeCloseTo(row.acPowerWByVariant.engineering, 11);
    });
    expect(complete.dcEnergyWhByVariant.engineering)
      .toBeLessThanOrEqual(complete.dcEnergyWhByVariant.ideal + 1e-9);
  });

  it("reports mismatch and bypass for a nonuniform curved-surface connection", async () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = pairedInput([point(start), point(start + HOUR_MS)], (candidate) => {
      const shaded = candidate.variants[1];
      const surface = shaded.continuousSurface!;
      if (surface.electricalModel !== "explicit-series-parallel-bypass") throw new Error("fixture");
      surface.engineeringConnection.parallelStrings = 1;
      surface.engineeringConnection.cellsPerBypassSubstring = 1;
      shaded.obstacleBounds = [{
        min: { x: -0.04, y: 0.02, z: -0.4 },
        max: { x: 0.04, y: 0.35, z: 0.4 },
      }];
    });
    input.physics!.solarOverride = { azimuthDeg: 270, elevationDeg: 30 };
    const { rows } = await run(input, "engineering-nonuniform");
    expect(rows.some((row) => row.mismatchLossFractionByVariant.engineering > 0)).toBe(true);
    expect(rows.every((row) => row.dcPowerWByVariant.engineering > 0)).toBe(true);
    expect(rows.some((row) => row.bypassActiveCountByVariant.engineering > 0)).toBe(true);
    rows.forEach((row) => {
      expect(regionSum(row, "dcPowerW")).toBeCloseTo(row.dcPowerWByVariant.engineering, 11);
    });
  });

  it("returns exact zero at night for both electrical models", async () => {
    const start = Date.UTC(2026, 5, 21, 15);
    const input = pairedInput([point(start), point(start + HOUR_MS)]);
    input.physics!.solarOverride = { azimuthDeg: 180, elevationDeg: -5 };
    const { rows, complete } = await run(input, "engineering-night");
    rows.forEach((row) => {
      expect(row.dcPowerWByVariant).toEqual({ ideal: 0, engineering: 0 });
      expect(row.acPowerWByVariant).toEqual({ ideal: 0, engineering: 0 });
      expect(row.bypassActiveCountByVariant.engineering).toBe(0);
      expect(row.mismatchLossFractionByVariant.engineering).toBe(0);
    });
    expect(complete.dcEnergyWhByVariant).toEqual({ ideal: 0, engineering: 0 });
  });

  it("integrates every actual interval and is deterministic for identical annual input", async () => {
    const start = Date.UTC(2026, 0, 1);
    const weather = Array.from({ length: 25 }, (_, index) =>
      point(start + index * HOUR_MS, index % 24 >= 6 && index % 24 <= 18 ? 750 : 0),
    );
    const input = pairedInput(weather);
    const first = await run(input, "engineering-annual-a");
    const second = await run(structuredClone(input), "engineering-annual-b");
    expect(first.complete.steps).toBe(25);
    expect(first.complete.intervals).toBe(24);
    expect(first.complete.durationHours).toBe(24);
    expect(first.complete.dcEnergyWhByVariant.engineering).toBeGreaterThan(0);
    expect(first.complete.dcEnergyWhByVariant.engineering)
      .toBeLessThanOrEqual(first.complete.dcEnergyWhByVariant.ideal + 1e-8);
    expect(second.complete.dcEnergyWhByVariant).toEqual(first.complete.dcEnergyWhByVariant);
    expect(second.complete.acEnergyWhByVariant).toEqual(first.complete.acEnergyWhByVariant);
    expect(second.rows.map((row) => row.mismatchLossFractionByVariant))
      .toEqual(first.rows.map((row) => row.mismatchLossFractionByVariant));
  });

  it("passes engineering DC voltage/current into the inverter MPPT contract", () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = pairedInput([point(start), point(start + HOUR_MS)]);
    const engineering = input.variants[1];
    engineering.inverter = {
      ratedAcPowerW: 100,
      nominalEfficiency: 0.96,
      mpptMinVoltageV: 100,
      mpptMaxVoltageV: 200,
      maxDcVoltageV: 300,
      maxInputCurrentA: 100,
      startPowerW: 0,
      nightConsumptionW: 0,
      wiringLossFraction: 0,
    };
    const result = computePhysicsStep({
      input,
      variant: engineering,
      weather: input.weather[0],
      stepIndex: 0,
    });
    if (typeof result === "number") throw new Error("unexpected numeric result");
    expect(result.dcPowerW).toBe(0);
    expect(result.acPowerW).toBe(0);
    expect(result.inverterStatus).toBe("mppt-voltage-limited");
  });
});
