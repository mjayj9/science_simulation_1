import { describe, expect, it } from "vitest";
import { createComparisonSurface } from "../src/lib/geometry";
import {
  integrateNaturalRotationHistory,
  type NaturalRotationParameterSource,
  type NaturalRotationShapeModel,
} from "../src/lib/physics/natural-rotation";
import { simulateAnnualRotationDecomposition } from "../src/lib/physics/annual-transient";
import type { WeatherPoint } from "../src/lib/weather";

const ANALYTIC: NaturalRotationParameterSource = {
  source: "analytic-geometry",
  reference: "calculation-based no-C_Q regression fixture",
  confidence: "high",
};
const USER: NaturalRotationParameterSource = {
  source: "user",
  reference: "calculation-based friction fixture; no torque coefficient supplied",
  confidence: "low",
};

function weatherBoundaries(startMs: number): WeatherPoint[] {
  return Array.from({ length: 5 }, (_, index) => ({
    timeUtcMs: startMs + index * 3_600_000,
    ghiWm2: 600,
    dniWm2: 0,
    dhiWm2: 600,
    ambientC: 24,
    windSpeedMs: 15,
    windDirectionDeg: 270,
    gustMs: 15,
    cloudFraction: 0,
    precipitationMm: 0,
  }));
}

function symmetricCylinderWithoutCq(): NaturalRotationShapeModel {
  return {
    shape: "cylinder",
    projectedAreaM2: 0.05,
    forceApplicationRadiusM: 0.1,
    inertiaKgM2: 0.004,
    structureCentreHeightM: 1,
    referenceHeightM: 10,
    maximumRpm: 300,
    staticFrictionNm: 0.001,
    bearingViscousNmPerRadS: 0.004,
    airDragNmPerRadS2: 0.0008,
    sources: {
      projectedArea: ANALYTIC,
      forceApplicationRadius: ANALYTIC,
      inertia: ANALYTIC,
      frictionAndDrag: USER,
    },
  };
}

describe("required combined physics regressions", () => {
  it("makes a no-C_Q natural schedule exactly equal to held-static annual energy", () => {
    const weather = weatherBoundaries(Date.UTC(2026, 5, 21, 8));
    const natural = integrateNaturalRotationHistory({
      weather,
      model: symmetricCylinderWithoutCq(),
      maximumSubstepSeconds: 300,
      finalPointIsClosingEndpoint: true,
    });
    expect(natural.rpmByWeatherStep).toEqual([0, 0, 0, 0, 0]);

    const common = {
      surface: createComparisonSurface("cylinder", {
        landAreaM2: 0.05,
        azimuthSamples: 16,
        meridionalSegments: 4,
      }),
      weather,
      location: { latitudeDeg: 0, longitudeDeg: 0 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false as const,
      diffuseModel: "isotropic" as const,
      thermalMesh: { targetNodeCount: 2 },
      thermalConfig: { maximumSubstepSeconds: 300 },
      warmup: false as const,
      opticalPhaseSamples: 4,
      convectionPhaseSamples: 4,
    };
    const heldStatic = simulateAnnualRotationDecomposition(common);
    const noCqNatural = simulateAnnualRotationDecomposition({
      ...common,
      rpmByWeatherStep: natural.rpmByWeatherStep,
    });

    expect(noCqNatural.annual).toEqual(heldStatic.annual);
    expect(noCqNatural.e00.acEnergyWh).toBeGreaterThan(0);
    for (const history of [noCqNatural.e00, noCqNatural.e10, noCqNatural.e01, noCqNatural.e11]) {
      expect(history.acEnergyWh).toBe(noCqNatural.e00.acEnergyWh);
      expect(history.dcEnergyWh).toBe(noCqNatural.e00.dcEnergyWh);
    }
  });
});
