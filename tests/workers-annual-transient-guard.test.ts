import { describe, expect, it } from "vitest";
import {
  createComparisonSurface,
  type IdealSurfaceModel,
} from "../src/lib/geometry";
import type { WeatherPoint } from "../src/lib/weather";
import {
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  validateKernelInput,
  type SimulationKernelInput,
  type SimulationResultRow,
} from "../src/workers";

const LAND_AREA_M2 = 0.05;

function weatherBoundaries(startMs: number, hours = 4): WeatherPoint[] {
  return Array.from({ length: hours + 1 }, (_, index) => ({
    timeUtcMs: startMs + index * 3_600_000,
    ghiWm2: 600,
    dniWm2: 0,
    dhiWm2: 600,
    ambientC: 24,
    windSpeedMs: 1,
    windDirectionDeg: 180,
    gustMs: 1,
    cloudFraction: 0,
    precipitationMm: 0,
  }));
}

function plane(): IdealSurfaceModel {
  return createComparisonSurface("plane", {
    landAreaM2: LAND_AREA_M2,
    planeTiltDeg: 0,
    planeAzimuthDeg: 180,
    azimuthSamples: 16,
    meridionalSegments: 4,
  });
}

function transientInput(surface: IdealSurfaceModel = plane()): SimulationKernelInput {
  return {
    mode: "annual",
    // +12 reporting offset moves the first interval across a month boundary,
    // while longitude 0 keeps this UTC interval in daylight.
    reportingOffsetMinutes: 12 * 60,
    weather: weatherBoundaries(Date.UTC(2026, 0, 31, 11), 4),
    variants: [{
      variantId: "transient",
      referenceEfficiency: 0.2,
      continuousSurface: createContinuousSurfaceWorkItem(surface, {
        landAreaM2: LAND_AREA_M2,
      }),
      rotation: { mode: "fixed", rpm: 2, initialAngleRad: 0 },
      rotationPhaseSamples: 2,
      inverter: false,
      annualTransientThermal: {
        surface,
        gammaPerC: -0.004,
        thermalNodeCount: 2,
        maximumThermalSubstepSeconds: 600,
        warmupPeriodHours: 1,
        warmupConvergenceToleranceC: 1_000,
      },
    }],
    physics: {
      location: { latitudeDeg: 0, longitudeDeg: 0 },
      inverter: false,
    },
    chunkSize: 5,
  };
}

function withTransientSurface(
  input: SimulationKernelInput,
  surface: IdealSurfaceModel,
): SimulationKernelInput {
  input.variants[0].annualTransientThermal!.surface = surface;
  return input;
}

describe("annual transient authoritative guard rails", () => {
  it("requires the thermal surface to match area, height, sample count and every sample tuple", () => {
    const source = plane();
    const altered = (mutate: (copy: IdealSurfaceModel) => void) => {
      const copy = structuredClone(source) as IdealSurfaceModel;
      mutate(copy);
      return withTransientSurface(transientInput(source), copy);
    };

    expect(() => validateKernelInput(altered((copy) => {
      copy.dimensions.activeAreaM2 += 1e-4;
    }))).toThrow(/active area must match/);
    expect(() => validateKernelInput(altered((copy) => {
      copy.dimensions.heightM += 1e-4;
    }))).toThrow(/height must match/);

    const denser = createComparisonSurface("plane", {
      landAreaM2: LAND_AREA_M2,
      planeTiltDeg: 0,
      planeAzimuthDeg: 180,
      azimuthSamples: 16,
      meridionalSegments: 6,
    });
    expect(() => validateKernelInput(withTransientSurface(transientInput(source), denser)))
      .toThrow(/sample count must match/);

    expect(() => validateKernelInput(altered((copy) => {
      (copy.zones[0].samples[0].position as unknown as number[])[0] += 1e-4;
    }))).toThrow(/position\.x must match/);
    expect(() => validateKernelInput(altered((copy) => {
      (copy.zones[0].samples[0].normal as unknown as number[])[1] -= 1e-4;
    }))).toThrow(/normal\.y must match/);
    expect(() => validateKernelInput(altered((copy) => {
      copy.zones[0].samples[0].areaM2 += 1e-4;
    }))).toThrow(/sample 0 area must match/);

    // Numerical serialization noise below the explicit tolerance remains valid.
    expect(() => validateKernelInput(altered((copy) => {
      (copy.zones[0].samples[0].position as unknown as number[])[0] += 1e-11;
    }))).not.toThrow();
  });

  it("rejects unsupported obstacles, tracking, and engineering electrical topology", () => {
    const obstacle = transientInput();
    obstacle.variants[0].obstacleBounds = [];
    expect(() => validateKernelInput(obstacle)).toThrow(/does not support obstacleBounds/);

    const tracking = transientInput();
    tracking.variants[0].rotation = undefined;
    tracking.variants[0].rotationPhaseSamples = undefined;
    tracking.variants[0].planeTracking = {
      mode: "dual-axis",
      centreM: { x: 0, y: 0, z: 0 },
    };
    expect(() => validateKernelInput(tracking)).toThrow(/does not support planeTracking/);

    const engineering = transientInput();
    const surface = engineering.variants[0].annualTransientThermal!.surface;
    engineering.variants[0].continuousSurface = createContinuousSurfaceWorkItem(surface, {
      landAreaM2: LAND_AREA_M2,
      electricalModel: "explicit-series-parallel-bypass",
      engineeringConnection: {
        nominalCellAreaM2: 0.01,
        parallelStrings: 1,
        cellsPerBypassSubstring: 2,
        cellIvModel: "piecewise-nameplate",
      },
    });
    expect(() => validateKernelInput(engineering))
      .toThrow(/does not yet support explicit engineering electrical connections/);
  });

  it("closes every monthly E history to its annual value and clears quasi-steady regions", async () => {
    const result = await runSimulationKernel(createSimulationRunRequest(
      "transient-monthly-closure",
      transientInput(),
    ));
    const decomposition = result.annualTransientRotationByVariant!.transient;
    expect(decomposition.monthly).toHaveLength(2);

    for (const key of ["e00", "e10", "e01", "e11"] as const) {
      const history = decomposition[key];
      expect(history.monthly.reduce((sum, month) => sum + month.dcEnergyWh, 0))
        .toBeCloseTo(history.dcEnergyWh, 10);
      expect(history.monthly.reduce((sum, month) => sum + month.grossAcEnergyWh, 0))
        .toBeCloseTo(history.grossAcEnergyWh, 10);
      expect(history.monthly.reduce((sum, month) => sum + month.acEnergyWh, 0))
        .toBeCloseTo(history.acEnergyWh, 10);
      expect(history.monthly.reduce((sum, month) => sum + month.motorEnergyWh, 0))
        .toBeCloseTo(history.motorEnergyWh, 10);
    }

    for (const key of ["e00Wh", "e10Wh", "e01Wh", "e11Wh"] as const) {
      expect(decomposition.monthly.reduce((sum, month) => sum + month[key], 0))
        .toBeCloseTo(decomposition.annual[key], 10);
    }
    expect(result.monthlyEnergy.reduce(
      (sum, month) => sum + month.acEnergyWhByVariant.transient,
      0,
    )).toBeCloseTo(result.acEnergyWhByVariant.transient, 10);
    expect(result.surfaceRegionEnergyWhByVariant.transient).toEqual({});
  }, 30_000);

  it("clips net AC at zero in rows, months and annual E11 when motor demand dominates", async () => {
    const input = transientInput();
    input.variants[0].rotation = { mode: "fixed", rpm: 60, initialAngleRad: 0 };
    input.variants[0].motorDrive = {
      requiredTorqueNm: 100,
      motorEfficiency: 1,
    };
    const rows: SimulationResultRow[] = [];
    const result = await runSimulationKernel(
      createSimulationRunRequest("transient-motor-clipping", input),
      {
        onChunk(event) {
          rows.push(...event.rows);
        },
      },
    );
    const decomposition = result.annualTransientRotationByVariant!.transient;

    expect(rows).toHaveLength(input.weather.length);
    expect(rows.every((row) => row.acPowerWByVariant.transient === 0)).toBe(true);
    expect(rows.every((row) => (row.motorPowerWByVariant?.transient ?? 0) > 0)).toBe(true);
    expect(decomposition.e00.motorEnergyWh).toBe(0);
    for (const history of [decomposition.e10, decomposition.e01, decomposition.e11]) {
      expect(history.grossAcEnergyWh).toBeGreaterThan(0);
      expect(history.motorEnergyWh).toBeGreaterThan(history.grossAcEnergyWh);
      expect(history.acEnergyWh).toBe(0);
      expect(history.monthly.every((month) => month.acEnergyWh === 0)).toBe(true);
    }
    expect(result.dcEnergyWhByVariant.transient).toBeGreaterThan(0);
    expect(result.acEnergyWhByVariant.transient).toBe(0);
    expect(result.monthlyEnergy.every(
      (month) => month.acEnergyWhByVariant.transient === 0,
    )).toBe(true);
    expect(result.motorEnergyWhByVariant!.transient)
      .toBeCloseTo(decomposition.e11.motorEnergyWh, 10);
    expect(result.monthlyEnergy.reduce(
      (sum, month) => sum + (month.motorEnergyWhByVariant?.transient ?? 0),
      0,
    )).toBeCloseTo(result.motorEnergyWhByVariant!.transient, 10);
    expect(decomposition.annual.closureResidualWh).toBeCloseTo(0, 12);
  }, 30_000);
});
