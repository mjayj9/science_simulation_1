import { describe, expect, it } from "vitest";
import { PANEL_AREA_M2 } from "../src/lib/geometry";
import type { WeatherPoint } from "../src/lib/weather";
import {
  computePhysicsStep,
  createSimulationRunRequest,
  rotationIntervalSamples,
  rotationPhaseAngles,
  runSimulationKernel,
  simulationInputFingerprint,
  validateKernelInput,
  type SimulationKernelInput,
  type SimulationPhysicsStepResult,
} from "../src/workers";

function point(timeUtcMs: number): WeatherPoint {
  return {
    timeUtcMs,
    ghiWm2: 450,
    dniWm2: 700,
    dhiWm2: 100,
    ambientC: 25,
    windSpeedMs: 0,
    windDirectionDeg: 0,
    gustMs: 0,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

function scheduledInput(times: readonly number[]): SimulationKernelInput {
  return {
    mode: "time-series",
    chunkSize: 1,
    variants: [{
      variantId: "scheduled-plane",
      panelCount: 1,
      totalPanelAreaM2: PANEL_AREA_M2,
      referenceEfficiency: 0.2,
      inverter: false,
      panels: [{
        panelId: "scheduled-panel",
        normal: { x: 0, y: 0, z: 1 },
        areaM2: PANEL_AREA_M2,
        efficiency: 0.2,
        iam: { model: "none" },
        diffuseModel: "isotropic",
        soilingLossFraction: 0,
      }],
      rotation: { mode: "fixed", rpm: 999, initialAngleRad: 0.1 },
      rotationRpmByWeatherStep: [0.25, 0.5, 0],
      rotationPhaseSamples: 12,
    }],
    weather: times.map(point),
    physics: {
      solarOverride: { azimuthDeg: 180, elevationDeg: 30 },
      panelDefaults: { soilingLossFraction: 0 },
    },
  };
}

describe("weather-step RPM schedule contract", () => {
  it("advances cumulative phase and uses the left schedule entry for each interval", () => {
    const start = Date.UTC(2026, 0, 31, 23);
    const input = scheduledInput([start, start + 60_000, start + 120_000]);
    const variant = input.variants[0];

    const firstInterval = rotationIntervalSamples({
      input,
      variant,
      weather: input.weather[0],
      stepIndex: 0,
    });
    const secondInterval = rotationIntervalSamples({
      input,
      variant,
      weather: input.weather[1],
      stepIndex: 1,
    });
    expect(firstInterval).toHaveLength(3);
    expect(secondInterval).toHaveLength(6);
    expect(firstInterval[0].angleRad).toBeCloseTo(0.1 + Math.PI / 12, 12);
    expect(secondInterval[0].angleRad).toBeCloseTo(0.1 + Math.PI / 2 + Math.PI / 12, 12);
    const closingPhase = rotationPhaseAngles({
      input,
      variant,
      weather: input.weather[2],
      stepIndex: 2,
    })[0];
    expect(closingPhase).toBeCloseTo(0.1 + Math.PI / 2 + Math.PI, 12);
    expect(firstInterval.every((sample) => sample.intervalAveraged)).toBe(true);
    expect(secondInterval.every((sample) => sample.intervalAveraged)).toBe(true);
  });

  it("uses scheduled interval-average power directly in the energy ledger", async () => {
    const start = Date.UTC(2026, 0, 1);
    const input = scheduledInput([start, start + 3_600_000, start + 7_200_000]);
    input.variants[0].rotationRpmByWeatherStep = [1 / 60, 0, 0];
    input.variants[0].rotationPhaseSamples = 72;
    const first = computePhysicsStep({
      input,
      variant: input.variants[0],
      weather: input.weather[0],
      stepIndex: 0,
    }) as SimulationPhysicsStepResult;
    const second = computePhysicsStep({
      input,
      variant: input.variants[0],
      weather: input.weather[1],
      stepIndex: 1,
    }) as SimulationPhysicsStepResult;
    const complete = await runSimulationKernel(
      createSimulationRunRequest("scheduled-energy", input),
      { yieldControl: async () => undefined },
    );

    expect(first.rotationIntervalAveraged).toBe(true);
    expect(second.rotationIntervalAveraged).toBe(true);
    expect(complete.dcEnergyWhByVariant["scheduled-plane"]).toBeCloseTo(
      first.dcPowerW + second.dcPowerW,
      10,
    );
  });

  it("fingerprints and validates the complete schedule without changing legacy fixed RPM", () => {
    const start = Date.UTC(2026, 0, 1);
    const input = scheduledInput([start, start + 60_000, start + 120_000]);
    expect(validateKernelInput(input)).toBe(input);
    const changed = structuredClone(input);
    changed.variants[0].rotationRpmByWeatherStep = [0.25, 0.51, 0];
    expect(simulationInputFingerprint(changed)).not.toBe(simulationInputFingerprint(input));

    const wrongLength = structuredClone(input);
    wrongLength.variants[0].rotationRpmByWeatherStep = [1, 2];
    expect(() => validateKernelInput(wrongLength)).toThrow(/기상 시계열 길이/);
    const staticRotation = structuredClone(input);
    staticRotation.variants[0].rotation = { mode: "static", angleRad: 0 };
    expect(() => validateKernelInput(staticRotation)).toThrow(/fixed 회전 설정|requires fixed rotation/);
    const motor = structuredClone(input);
    motor.variants[0].motorDrive = { requiredTorqueNm: 0.1, motorEfficiency: 0.8 };
    expect(() => validateKernelInput(motor)).toThrow(/cannot use motorDrive/);

    const legacy = structuredClone(input);
    delete legacy.variants[0].rotationRpmByWeatherStep;
    legacy.variants[0].rotation = { mode: "fixed", rpm: 0.25, initialAngleRad: 0.1 };
    legacy.variants[0].rotationPhaseSamples = 1;
    const legacyPhases = legacy.weather.map((weather, stepIndex) => rotationPhaseAngles({
      input: legacy,
      variant: legacy.variants[0],
      weather,
      stepIndex,
    })[0]);
    expect(legacyPhases).toEqual(phasesForLegacy(legacy));
  });
});

function phasesForLegacy(input: SimulationKernelInput): number[] {
  const initial = 0.1;
  const rpm = 0.25;
  const start = input.weather[0].timeUtcMs;
  return input.weather.map((weather) => {
    const seconds = (weather.timeUtcMs - start) / 1_000;
    const raw = initial + rpm * 2 * Math.PI * seconds / 60;
    return ((raw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  });
}
