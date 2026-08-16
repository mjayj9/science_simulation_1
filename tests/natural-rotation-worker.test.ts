import { describe, expect, it } from "vitest";
import { integrateNaturalRotationHistory } from "../src/lib/physics/natural-rotation";
import type { WeatherPoint } from "../src/lib/weather";
import {
  rotationPhaseAngles,
  simulationInputFingerprint,
  validateKernelInput,
  type SimulationKernelInput,
} from "../src/workers";

function point(timeUtcMs: number, windSpeedMs: number): WeatherPoint {
  return {
    timeUtcMs,
    ghiWm2: 0,
    dniWm2: 0,
    dhiWm2: 0,
    ambientC: 20,
    windSpeedMs,
    windDirectionDeg: 270,
    gustMs: windSpeedMs,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

describe("natural dynamics to annual-worker schedule", () => {
  it("preserves integrated phase with one interval-mean RPM per weather step", () => {
    const start = Date.UTC(2025, 0, 1);
    const weather = [
      point(start, 1),
      point(start + 3_600_000, 8),
      point(start + 5_400_000, 3),
      point(start + 7_200_000, 0),
    ];
    const history = integrateNaturalRotationHistory({
      weather,
      maximumSubstepSeconds: 30,
      finalPointIsClosingEndpoint: true,
      model: {
        shape: "cube",
        projectedAreaM2: 0.09,
        forceApplicationRadiusM: 0.18,
        inertiaKgM2: 0.02,
        structureCentreHeightM: 10,
        referenceHeightM: 10,
        maximumRpm: 300,
        staticFrictionNm: 0.001,
        bearingViscousNmPerRadS: 0.004,
        airDragNmPerRadS2: 0.0008,
        torqueModel: {
          kind: "integrated-shape",
          provenance: {
            source: "user",
            reference: "worker integration test input",
            confidence: "low",
          },
          torqueCoefficient: (lambda) => 0.16 * (1 - lambda / 1.2),
        },
        sources: {
          projectedArea: { source: "analytic-geometry", reference: "cube face", confidence: "high" },
          forceApplicationRadius: { source: "analytic-geometry", reference: "cube corner radius", confidence: "high" },
          inertia: { source: "analytic-geometry", reference: "solid cuboid inertia", confidence: "high" },
          frictionAndDrag: { source: "user", reference: "worker integration test input", confidence: "low" },
        },
      },
    });
    const input: SimulationKernelInput = {
      mode: "annual",
      variants: [{
        variantId: "natural-cube",
        panelCount: 1,
        totalPanelAreaM2: 0.0025,
        referenceEfficiency: 0.2,
        rotation: { mode: "fixed", rpm: 0, initialAngleRad: 0.25 },
        rotationRpmByWeatherStep: history.rpmByWeatherStep,
        rotationPhaseSamples: 12,
      }],
      weather,
    };
    validateKernelInput(input);

    const closingAngle = rotationPhaseAngles({
      input,
      variant: input.variants[0],
      weather: input.weather.at(-1)!,
      stepIndex: input.weather.length - 1,
    })[0];
    const integratedAngle = history.intervals.reduce(
      (angle, interval) => angle + interval.meanRpm * 2 * Math.PI
        * interval.durationSeconds / 60,
      0.25,
    );
    const expectedAngle = ((integratedAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(closingAngle).toBeCloseTo(expectedAngle, 10);

    const changed = structuredClone(input);
    const changedSchedule = [...changed.variants[0].rotationRpmByWeatherStep!];
    changedSchedule[1] += 1e-6;
    changed.variants[0].rotationRpmByWeatherStep = changedSchedule;
    expect(simulationInputFingerprint(changed)).not.toBe(simulationInputFingerprint(input));
  });

  it("keeps controlled fixed-RPM comparison distinct from natural rotation and motor accounting", () => {
    const start = Date.UTC(2025, 0, 1);
    const weather = [point(start, 5), point(start + 3_600_000, 5)];
    const fixedRpm = 8;
    const input: SimulationKernelInput = {
      variants: ["plane", "cube", "sphere"].map((shape) => ({
        variantId: `controlled-${shape}`,
        panelCount: 1,
        totalPanelAreaM2: 0.0025,
        referenceEfficiency: 0.2,
        rotation: { mode: "fixed" as const, rpm: fixedRpm, initialAngleRad: 0 },
        motorDrive: { requiredTorqueNm: 0.02, motorEfficiency: 0.8 },
      })),
      weather,
    };
    expect(() => validateKernelInput(input)).not.toThrow();
    expect(input.variants.map((variant) => variant.rotation?.mode === "fixed"
      ? variant.rotation.rpm
      : null)).toEqual([fixedRpm, fixedRpm, fixedRpm]);
    expect(input.variants.every((variant) => variant.motorDrive !== undefined)).toBe(true);
    expect(input.variants.every((variant) => variant.rotationRpmByWeatherStep === undefined)).toBe(true);
  });
});
