import { describe, expect, it } from "vitest";
import type { ComparisonShapeKind } from "../src/lib/geometry";
import {
  deriveAnalyticShapeRotationParameters,
  integrateNaturalRotationHistory,
  type NaturalRotationParameterSource,
  type NaturalRotationShapeModel,
} from "../src/lib/physics/natural-rotation";
import { solveEnvironmentalAverageRpm } from "../src/lib/physics/rotation";
import type { WeatherPoint } from "../src/lib/weather";

function weatherPoint(timeUtcMs: number, windSpeedMs: number, windDirectionDeg = 270): WeatherPoint {
  return {
    timeUtcMs,
    ghiWm2: 0,
    dniWm2: 0,
    dhiWm2: 0,
    ambientC: 20,
    windSpeedMs,
    windDirectionDeg,
    gustMs: windSpeedMs,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

const ANALYTIC: NaturalRotationParameterSource = {
  source: "analytic-geometry",
  reference: "explicit test geometry",
  confidence: "high",
};
const USER: NaturalRotationParameterSource = {
  source: "user",
  reference: "test fixture user input; not a literature value",
  confidence: "low",
};

function selfStartingModel(
  overrides: Partial<NaturalRotationShapeModel> = {},
): NaturalRotationShapeModel {
  return {
    shape: "cylinder",
    projectedAreaM2: 0.12,
    forceApplicationRadiusM: 0.15,
    inertiaKgM2: 0.025,
    structureCentreHeightM: 10,
    referenceHeightM: 10,
    maximumRpm: 300,
    staticFrictionNm: 0.001,
    bearingViscousNmPerRadS: 0.004,
    airDragNmPerRadS2: 0.0008,
    torqueModel: {
      kind: "integrated-shape",
      provenance: USER,
      torqueCoefficient: (lambda) => 0.18 * (1 - lambda / 1.4),
    },
    sources: {
      projectedArea: ANALYTIC,
      forceApplicationRadius: ANALYTIC,
      inertia: ANALYTIC,
      frictionAndDrag: USER,
    },
    ...overrides,
  };
}

function yearlyWeather(year: number): WeatherPoint[] {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const points: WeatherPoint[] = [];
  for (let timeUtcMs = start; timeUtcMs <= end; timeUtcMs += 3_600_000) {
    points.push(weatherPoint(timeUtcMs, 4));
  }
  return points;
}

describe("shape-specific natural-rotation geometry", () => {
  it("derives distinct projected area, force radius, and vertical-axis inertia", () => {
    const inputs: Record<ComparisonShapeKind, Parameters<typeof deriveAnalyticShapeRotationParameters>[0]> = {
      plane: { shape: "plane", widthM: 2, depthM: 0.1, heightM: 1, massKg: 4 },
      cube: { shape: "cube", widthM: 2, depthM: 2, heightM: 2, massKg: 4 },
      sphere: { shape: "sphere", widthM: 2, depthM: 2, heightM: 2, radiusM: 1, massKg: 4 },
      hemisphere: { shape: "hemisphere", widthM: 2, depthM: 2, heightM: 1, radiusM: 1, massKg: 4 },
      cylinder: { shape: "cylinder", widthM: 2, depthM: 2, heightM: 3, radiusM: 1, massKg: 4 },
      cone: { shape: "cone", widthM: 2, depthM: 2, heightM: 3, radiusM: 1, massKg: 4 },
    };
    const result = Object.fromEntries(
      Object.entries(inputs).map(([shape, input]) => [
        shape,
        deriveAnalyticShapeRotationParameters(input),
      ]),
    ) as Record<ComparisonShapeKind, ReturnType<typeof deriveAnalyticShapeRotationParameters>>;

    expect(result.sphere.projectedAreaM2).toBeCloseTo(Math.PI, 14);
    expect(result.hemisphere.projectedAreaM2).toBeCloseTo(Math.PI / 2, 14);
    expect(result.cylinder.projectedAreaM2).toBeCloseTo(6, 14);
    expect(result.cone.projectedAreaM2).toBeCloseTo(3, 14);
    expect(result.sphere.inertiaKgM2).toBeCloseTo(8 / 3, 14);
    expect(result.cylinder.inertiaKgM2).toBeCloseTo(26 / 7, 14);
    expect(result.cone.inertiaKgM2).toBeCloseTo(2, 14);
    expect(result.cube.inertiaKgM2).toBeCloseTo(4.8, 14);
    expect(result.plane.forceApplicationRadiusM).toBeCloseTo(Math.hypot(2, 0.1) / 2, 14);
    expect(result.cube.forceApplicationRadiusM).toBeCloseTo(Math.SQRT2, 14);
  });

  it("evaluates plane and cube silhouettes from wind azimuth minus body yaw", () => {
    const plane = deriveAnalyticShapeRotationParameters({
      shape: "plane", widthM: 2, depthM: Math.sqrt(3), heightM: 1,
      planeSlantLengthM: 2, planeTiltDeg: 30, planeAzimuthDeg: 0, massKg: 4,
    });
    expect(plane.directionalAerodynamics.evaluate(0, 0).projectedAreaM2).toBeCloseTo(2, 14);
    expect(plane.directionalAerodynamics.evaluate(Math.PI / 2, 0).projectedAreaM2)
      .toBeCloseTo(0, 14);

    const cube = deriveAnalyticShapeRotationParameters({
      shape: "cube", widthM: 2, depthM: 2, heightM: 2, massKg: 4,
    });
    expect(cube.directionalAerodynamics.evaluate(0, 0)).toEqual({
      projectedAreaM2: 4,
      forceApplicationRadiusM: 1,
    });
    expect(cube.directionalAerodynamics.evaluate(Math.PI / 4, 0).projectedAreaM2)
      .toBeCloseTo(4 * Math.SQRT2, 14);
    expect(cube.directionalAerodynamics.evaluate(Math.PI / 4, 0).forceApplicationRadiusM)
      .toBeCloseTo(Math.SQRT2, 14);
  });

  it("uses the per-weather-direction cube silhouette in aerodynamic impulse", () => {
    const analytic = deriveAnalyticShapeRotationParameters({
      shape: "cube", widthM: 2, depthM: 2, heightM: 2, massKg: 4,
    });
    const start = Date.UTC(2025, 0, 1);
    const run = (directionDeg: number) => integrateNaturalRotationHistory({
      weather: [weatherPoint(start, 5, directionDeg), weatherPoint(start + 1_000, 5, directionDeg)],
      maximumSubstepSeconds: 1,
      model: {
        ...selfStartingModel(), shape: "cube", maximumRpm: 0,
        projectedAreaM2: analytic.projectedAreaM2,
        forceApplicationRadiusM: analytic.forceApplicationRadiusM,
        inertiaKgM2: analytic.inertiaKgM2,
        directionalAerodynamics: analytic.directionalAerodynamics,
      },
    });
    const face = run(0).intervals[0];
    const diagonal = run(45).intervals[0];
    expect(diagonal.meanProjectedAreaM2 / face.meanProjectedAreaM2).toBeCloseTo(Math.SQRT2, 12);
    expect(diagonal.aerodynamicImpulseNmS / face.aerodynamicImpulseNmS).toBeCloseTo(2, 12);
  });

  it.each([
    "plane", "cube", "sphere", "hemisphere", "cylinder", "cone",
  ] as const)("keeps %s at zero without an explicit self-starting C_Q", (shape) => {
    const start = Date.UTC(2025, 0, 1);
    const result = integrateNaturalRotationHistory({
      weather: [weatherPoint(start, 20), weatherPoint(start + 3_600_000, 20)],
      maximumSubstepSeconds: 60,
      model: {
        ...selfStartingModel(),
        shape,
        torqueModel: undefined,
      },
    });

    expect(result.rpmByWeatherStep).toEqual([0, 0]);
    expect(result.instantaneousRpmByWeatherStep).toEqual([0, 0]);
    expect(result.annual.timeWeightedMeanRpm).toBe(0);
    expect(result.audit.symmetricNoSelfStartingDefault).toBe(true);
    expect(result.audit.torqueCoefficientInput).toBe("absent");
  });
});

describe("weather-interval natural-rotation dynamics", () => {
  it("integrates I*domega/dt at every interval and closes the impulse balance", () => {
    const start = Date.UTC(2025, 0, 31, 23);
    const result = integrateNaturalRotationHistory({
      weather: [
        weatherPoint(start, 2),
        weatherPoint(start + 3_600_000, 8),
        weatherPoint(start + 2 * 3_600_000, 4),
      ],
      timezoneOffsetMinutes: 0,
      maximumSubstepSeconds: 30,
      finalPointIsClosingEndpoint: true,
      model: selfStartingModel(),
    });

    expect(result.intervals).toHaveLength(2);
    expect(result.rpmByWeatherStep).toHaveLength(3);
    expect(result.annual.integratedHours).toBeCloseTo(2, 14);
    expect(result.months[0].durationHours).toBeCloseTo(1, 14);
    expect(result.months[1].durationHours).toBeCloseTo(1, 14);
    expect(result.annual.timeWeightedMeanRpm).toBeCloseTo(
      (result.intervals[0].meanRpm + result.intervals[1].meanRpm) / 2,
      12,
    );
    expect(result.intervals.every((interval) =>
      Math.abs(interval.dynamicBalanceResidualNmS) < 1e-10)).toBe(true);
    expect(result.annual.maximumAbsoluteDynamicBalanceResidualNmS).toBeLessThan(1e-12);
    expect(Math.abs(result.annual.totalDynamicBalanceResidualNmS)).toBeLessThan(1e-10);
    expect(result.audit.equation).toBe(
      "I*domega/dt=tau_aero(V,omega,shape)-tau_loss(omega)",
    );
    expect(Math.abs(result.audit.phaseScheduleClosureRad)).toBeLessThan(1e-9);
    expect(result.audit.rotationScheduleDefinition).toBe(
      "interval-time-mean-rpm; prefix-phase equals integrated omega",
    );
  });

  it("does not substitute solve(mean wind) for interval-resolved nonlinear wind", () => {
    const steadyBase = {
      shape: "cylinder" as const,
      referenceHeightM: 10,
      structureCentreHeightM: 10,
      rotorRadiusM: 0.15,
      rotorAreaM2: 0.12,
      maximumRpm: 300,
      staticFrictionNm: 0.001,
      bearingViscousNmPerRadS: 0.004,
      airDragNmPerRadS2: 0.0008,
      selfStarting: {
        kind: "user-cq" as const,
        source: "user" as const,
        torqueCoefficient: (lambda: number) => 0.18 * (1 - lambda / 1.4),
      },
    };
    const solveMeanWindRpm = solveEnvironmentalAverageRpm({
      ...steadyBase,
      referenceWindSpeedMS: 4,
    }).finalRpm;
    const meanOfIntervalSolutionsRpm = (
      solveEnvironmentalAverageRpm({ ...steadyBase, referenceWindSpeedMS: 0 }).finalRpm
      + solveEnvironmentalAverageRpm({ ...steadyBase, referenceWindSpeedMS: 8 }).finalRpm
    ) / 2;

    expect(Math.abs(solveMeanWindRpm - meanOfIntervalSolutionsRpm)).toBeGreaterThan(1);

    const start = Date.UTC(2025, 0, 1);
    const variable = integrateNaturalRotationHistory({
      weather: [
        weatherPoint(start, 0),
        weatherPoint(start + 3_600_000, 8),
        weatherPoint(start + 2 * 3_600_000, 0),
      ],
      maximumSubstepSeconds: 30,
      model: selfStartingModel(),
    });
    const constantMean = integrateNaturalRotationHistory({
      weather: [
        weatherPoint(start, 4),
        weatherPoint(start + 3_600_000, 4),
        weatherPoint(start + 2 * 3_600_000, 4),
      ],
      maximumSubstepSeconds: 30,
      model: selfStartingModel(),
    });
    expect(Math.abs(
      variable.annual.timeWeightedMeanRpm - constantMean.annual.timeWeightedMeanRpm,
    )).toBeGreaterThan(0.1);
  });

  it("is deterministic for identical weather, model, and initial state", () => {
    const start = Date.UTC(2025, 5, 1);
    const input = {
      weather: [
        weatherPoint(start, 3),
        weatherPoint(start + 3_600_000, 7),
        weatherPoint(start + 2 * 3_600_000, 2),
      ],
      maximumSubstepSeconds: 45,
      model: selfStartingModel(),
    };
    expect(integrateNaturalRotationHistory(input)).toEqual(
      integrateNaturalRotationHistory(input),
    );
  });

  it("excludes an auxiliary passive rotor until footprint, height, and shadow are counted", () => {
    const start = Date.UTC(2025, 0, 1);
    const incomplete = integrateNaturalRotationHistory({
      weather: [weatherPoint(start, 5), weatherPoint(start + 60_000, 5)],
      model: selfStartingModel({
        torqueModel: {
          kind: "auxiliary-rotor",
          provenance: USER,
          torqueCoefficient: () => 0.1,
          auxiliaryRotor: {
            footprintAreaM2: 0.01,
            assemblyHeightM: 0.3,
            shadowLossFraction: 0.02,
            footprintIncludedInLandConstraint: true,
            heightIncludedInCommonEnvelope: false,
            shadowIncludedInPvYield: false,
          },
        },
      }),
    });
    expect(incomplete.audit.officialComparisonEligible).toBe(false);
    expect(incomplete.audit.exclusionReasons).toEqual([
      "auxiliary-CQ-reference-area-missing",
      "auxiliary-CQ-reference-radius-missing",
      "auxiliary-height-not-in-H_max",
      "auxiliary-shadow-not-in-PV-yield",
    ]);
    expect(incomplete.intervals[0].aerodynamicImpulseNmS).toBe(0);
  });
});

describe("full-year closing endpoint accounting", () => {
  it.each([
    [2025, 8_760],
    [2024, 8_784],
  ] as const)("integrates year %i as %i hours and never integrates past the closing point", (year, hours) => {
    const result = integrateNaturalRotationHistory({
      weather: yearlyWeather(year),
      finalPointIsClosingEndpoint: true,
      // No C_Q makes this cheap while still exercising every annual interval.
      maximumSubstepSeconds: 3_600,
      model: { ...selfStartingModel(), torqueModel: undefined },
    });

    expect(result.intervals).toHaveLength(hours);
    expect(result.rpmByWeatherStep).toHaveLength(hours + 1);
    expect(result.annual.integratedHours).toBe(hours);
    expect(result.months.reduce((sum, month) => sum + month.durationHours, 0)).toBe(hours);
    expect(result.annual.totalSubsteps).toBe(hours);
    expect(result.rpmByWeatherStep.at(-1)).toBe(0);
    expect(result.audit.finalPointIsClosingEndpoint).toBe(true);
  }, 30_000);
});
