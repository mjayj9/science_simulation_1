import { describe, expect, it } from "vitest";
import { createComparisonSurface } from "../src/lib/geometry";
import {
  ANNUAL_TRANSIENT_ROTATION_THERMAL_LABEL_KO,
  QUASI_STEADY_ROTATION_THERMAL_LABEL_KO,
} from "../src/lib/physics";
import type { WeatherPoint } from "../src/lib/weather";
import {
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  type SimulationKernelInput,
} from "../src/workers";

const weatherPoint = (timeUtcMs: number, index: number): WeatherPoint => ({
  timeUtcMs,
  ghiWm2: index > 0 && index < 4 ? 450 : 0,
  dniWm2: 0,
  dhiWm2: index > 0 && index < 4 ? 450 : 0,
  ambientC: 22,
  windSpeedMs: 1,
  windDirectionDeg: 180,
  gustMs: 1,
  cloudFraction: 0,
  precipitationMm: 0,
});

describe("annual worker transient thermal contract", () => {
  it("labels legacy annual output as quasi-steady with no thermal history", async () => {
    const start = Date.UTC(2026, 5, 20);
    const input: SimulationKernelInput = {
      mode: "time-series",
      weather: Array.from({ length: 3 }, (_, index) => weatherPoint(start + index * 3_600_000, index)),
      variants: [{
        variantId: "legacy",
        panelCount: 1,
        totalPanelAreaM2: 0.0025,
        referenceEfficiency: 0.2,
      }],
      physics: {
        solarOverride: { elevationDeg: 45, azimuthDeg: 180 },
        inverter: false,
      },
    };
    const result = await runSimulationKernel(createSimulationRunRequest("legacy-label", input));
    expect(result.thermalModelMetadataByVariant.legacy).toMatchObject({
      labelKo: QUASI_STEADY_ROTATION_THERMAL_LABEL_KO,
      includesThermalHistory: false,
    });
    expect(result.authoritativeEnergyPathByVariant.legacy).toBe("worker-quasi-steady");
    expect(result.energyWhByVariant.legacy).toBe(result.dcEnergyWhByVariant.legacy);
    expect(result.annualTransientRotationByVariant).toBeUndefined();
  });

  it("executes full supplied intervals and exposes E00/E10/E01/E11 metadata", async () => {
    const start = Date.UTC(2026, 5, 20);
    const surface = createComparisonSurface("cylinder", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const input: SimulationKernelInput = {
      mode: "annual",
      weather: Array.from({ length: 7 }, (_, index) => weatherPoint(start + index * 3_600_000, index)),
      variants: [{
        variantId: "transient-cylinder",
        referenceEfficiency: 0.2,
        continuousSurface: createContinuousSurfaceWorkItem(surface, { landAreaM2: 0.05 }),
        rotation: { mode: "fixed", rpm: 1, initialAngleRad: 0 },
        rotationPhaseSamples: 4,
        inverter: false,
        annualTransientThermal: {
          surface,
          gammaPerC: -0.004,
          thermalNodeCount: 2,
          maximumThermalSubstepSeconds: 300,
          warmupPeriodHours: 2,
          warmupConvergenceToleranceC: 0.1,
        },
      }],
      physics: {
        location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
        inverter: false,
      },
      chunkSize: 6,
    };
    const result = await runSimulationKernel(createSimulationRunRequest("transient-annual", input));
    expect(result.thermalModelMetadataByVariant["transient-cylinder"]).toMatchObject({
      labelKo: ANNUAL_TRANSIENT_ROTATION_THERMAL_LABEL_KO,
      includesThermalHistory: true,
    });
    const decomposition = result.annualTransientRotationByVariant?.["transient-cylinder"];
    expect(decomposition).toBeDefined();
    expect(decomposition?.e11.coverage).toMatchObject({ intervals: 6, durationHours: 6 });
    expect(decomposition?.annual.closureResidualWh).toBeCloseTo(0, 12);
    expect(decomposition?.monthly[0].closureResidualWh).toBeCloseTo(0, 12);
    expect(result.authoritativeEnergyPathByVariant["transient-cylinder"])
      .toBe("annual-transient-e11");
    expect(result.dcEnergyWhByVariant["transient-cylinder"])
      .toBeCloseTo(decomposition!.e11.dcEnergyWh, 12);
    expect(result.acEnergyWhByVariant["transient-cylinder"])
      .toBeCloseTo(decomposition!.e11.acEnergyWh, 12);
    expect(result.energyWhByVariant["transient-cylinder"])
      .toBeCloseTo(decomposition!.e11.dcEnergyWh, 12);
    expect(result.monthlyEnergy[0].dcEnergyWhByVariant["transient-cylinder"])
      .toBeCloseTo(decomposition!.e11.monthly[0].dcEnergyWh, 12);
    expect(result.monthlyEnergy[0].acEnergyWhByVariant["transient-cylinder"])
      .toBeCloseTo(decomposition!.e11.monthly[0].acEnergyWh, 12);
  }, 30_000);

  it("rejects transient metadata outside annual mode", () => {
    const start = Date.UTC(2026, 5, 20);
    const surface = createComparisonSurface("plane", {
      landAreaM2: 0.05,
      planeTiltDeg: 30,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const input: SimulationKernelInput = {
      mode: "time-series",
      weather: [weatherPoint(start, 0), weatherPoint(start + 3_600_000, 1)],
      variants: [{
        variantId: "invalid",
        referenceEfficiency: 0.2,
        continuousSurface: createContinuousSurfaceWorkItem(surface, { landAreaM2: 0.05 }),
        annualTransientThermal: { surface, gammaPerC: -0.004 },
      }],
    };
    expect(() => createSimulationRunRequest("invalid", input)).not.toThrow();
    return expect(runSimulationKernel(createSimulationRunRequest("invalid-run", input)))
      .rejects.toThrow("requires annual mode");
  });
});
