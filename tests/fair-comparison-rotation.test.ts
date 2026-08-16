import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAND_AREA_M2,
  DEFAULT_MAX_HEIGHT_M,
  calculateComparisonGeometry,
  commonMaximumHeightM,
  createComparisonSurface,
  type ComparisonShapeKind,
} from "../src/lib/geometry";
import {
  motorDrivePowerW,
  rpmToAngularVelocity,
  solveEnvironmentalAverageRpm,
  simulateTransientSurfaceHistory,
} from "../src/lib/physics";
import { getOfflineWeather } from "../src/lib/weather";

const SHAPES: readonly ComparisonShapeKind[] = [
  "plane", "cube", "sphere", "hemisphere", "cylinder", "cone",
];

describe("official equal-land/equal-height geometry contract", () => {
  it("derives H_max from A_land and uses it for default cylinders/cones", () => {
    expect(DEFAULT_MAX_HEIGHT_M).toBeCloseTo(
      2 * Math.sqrt(DEFAULT_LAND_AREA_M2 / Math.PI),
      15,
    );
    for (const landAreaM2 of [0.0125, 0.05, 0.2]) {
      const hMax = commonMaximumHeightM(landAreaM2);
      const cylinder = calculateComparisonGeometry("cylinder", { landAreaM2 });
      const cone = calculateComparisonGeometry("cone", { landAreaM2 });
      expect(cylinder.dimensions.heightM).toBeCloseTo(hMax, 14);
      expect(cone.dimensions.heightM).toBeCloseTo(hMax, 14);
      expect(cylinder.constraints.commonMaximumHeightM).toBeCloseTo(hMax, 14);
      expect(cylinder.constraints.officialComparisonEligible).toBe(true);
      expect(cone.constraints.officialComparisonEligible).toBe(true);
    }
  });

  it("keeps every official comparison shape at or below the common H_max", () => {
    for (const landAreaM2 of [0.0125, 0.05, 0.2]) {
      const hMax = commonMaximumHeightM(landAreaM2);
      for (const shape of SHAPES) {
        const geometry = calculateComparisonGeometry(shape, { landAreaM2 });
        const surface = createComparisonSurface(shape, { landAreaM2 });
        const maximumSampleY = Math.max(
          ...surface.zones.flatMap((zone) => zone.samples.map((sample) => sample.position[1])),
        );
        const effectiveHeightM = geometry.constraints.effectiveHeightM;
        expect(effectiveHeightM, `${shape} at A_land=${landAreaM2}`)
          .toBeLessThanOrEqual(hMax + 1e-12);
        expect(maximumSampleY, `${shape} world top at A_land=${landAreaM2}`).toBeLessThanOrEqual(hMax + 1e-12);
        expect(geometry.constraints.commonMaximumHeightM, shape).toBeCloseTo(hMax, 14);
        expect(geometry.constraints.heightExceeded, shape).toBe(false);
      }
    }
  });

  it("counts support clearance inside H_max and keeps actual world samples below it", () => {
    const landAreaM2 = 0.05;
    const hMax = commonMaximumHeightM(landAreaM2);
    const clearanceM = 0.01;
    expect(() => createComparisonSurface("sphere", {
      landAreaM2,
      groundClearanceM: clearanceM,
    })).toThrow(/maximum height/);
    expect(() => createComparisonSurface("cylinder", {
      landAreaM2,
      groundClearanceM: clearanceM,
      cylinderHeightM: hMax,
    })).toThrow(/H_max minus ground clearance/);

    const cylinder = createComparisonSurface("cylinder", {
      landAreaM2,
      groundClearanceM: clearanceM,
    });
    const samples = cylinder.zones.flatMap((zone) => zone.samples);
    const maximumSampleY = Math.max(...samples.map((sample) => sample.position[1]));
    expect(cylinder.comparison.dimensions.heightM).toBeCloseTo(hMax - clearanceM, 14);
    expect(cylinder.comparison.constraints.groundClearanceM).toBe(clearanceM);
    expect(cylinder.comparison.constraints.effectiveHeightM).toBeCloseTo(hMax, 14);
    expect(maximumSampleY).toBeLessThanOrEqual(hMax + 1e-12);
  });

  it("rejects H > H_max and excludes a valid custom cylinder height from official ranking", () => {
    const landAreaM2 = 0.05;
    const hMax = commonMaximumHeightM(landAreaM2);
    expect(() => calculateComparisonGeometry("cylinder", {
      landAreaM2,
      cylinderHeightM: hMax * 1.001,
    })).toThrow(/0 < H <= H_max/);
    expect(() => calculateComparisonGeometry("cone", {
      landAreaM2,
      coneHeightM: hMax * 1.001,
    })).toThrow(/0 < H <= H_max/);

    const custom = calculateComparisonGeometry("cylinder", {
      landAreaM2,
      cylinderHeightM: 0.8 * hMax,
    });
    expect(custom.constraints.feasible).toBe(true);
    expect(custom.constraints.officialComparisonEligible).toBe(false);
    expect(custom.constraints.officialComparisonExclusionReasons).toContain("user-custom-height");
  });

  it.each(SHAPES)("keeps rotating %s swept footprint at A_land", (shape) => {
    const landAreaM2 = 0.05;
    const geometry = calculateComparisonGeometry(shape, {
      landAreaM2,
      footprintMode: "swept",
      planeTiltDeg: 30,
    });
    expect(geometry.footprint.selectedMode).toBe("swept");
    expect(geometry.landAreaM2).toBeCloseTo(landAreaM2, 12);
    expect(geometry.footprint.sweptAreaM2).toBeCloseTo(landAreaM2, 12);
    expect(geometry.footprintIndex).toBeCloseTo(100, 10);
    expect(geometry.constraints.landAreaExceeded).toBe(false);
  });
});

describe("environmental mean-RPM torque balance", () => {
  it("returns physical zero for a smooth axisymmetric shape without self-starting hardware", () => {
    const result = solveEnvironmentalAverageRpm({
      shape: "cylinder",
      referenceWindSpeedMS: 4,
      referenceHeightM: 10,
      structureCentreHeightM: 1,
      rotorRadiusM: 0.12,
      rotorAreaM2: 0.06,
      maximumRpm: 120,
    });
    expect(result.finalRpm).toBe(0);
    expect(result.unconstrainedRpm).toBe(0);
    expect(result.confidence).toBe("high");
    expect(result.warning).toMatch(/자가 기동 토크/);
  });

  it("solves C_Q(lambda) torque equilibrium and then applies the safety limit", () => {
    const input = {
      shape: "cylinder" as const,
      referenceWindSpeedMS: 6,
      referenceHeightM: 10,
      structureCentreHeightM: 2,
      rotorRadiusM: 0.15,
      rotorAreaM2: 0.12,
      maximumRpm: 10_000,
      staticFrictionNm: 0.001,
      bearingViscousNmPerRadS: 0.004,
      airDragNmPerRadS2: 0.0008,
      selfStarting: {
        kind: "user-cq" as const,
        source: "user" as const,
        torqueCoefficient: (lambda: number) => Math.max(0, 0.18 * (1 - lambda / 1.4)),
      },
    };
    const unconstrained = solveEnvironmentalAverageRpm(input);
    expect(unconstrained.finalRpm).toBeGreaterThan(0);
    expect(unconstrained.safetyLimited).toBe(false);
    expect(Math.abs(unconstrained.torqueResidualNm)).toBeLessThan(1e-10);
    expect(unconstrained.aerodynamicTorqueNm).toBeCloseTo(unconstrained.lossTorqueNm, 10);

    const limited = solveEnvironmentalAverageRpm({ ...input, maximumRpm: 5 });
    expect(limited.unconstrainedRpm).toBeCloseTo(unconstrained.unconstrainedRpm, 8);
    expect(limited.finalRpm).toBeCloseTo(5, 14);
    expect(limited.safetyLimited).toBe(true);
    expect(limited.torqueResidualNm).toBeGreaterThan(0);
  });

  it("computes external-motor demand as tau*|omega|/eta", () => {
    const requiredTorqueNm = 0.2;
    const rpm = -30;
    const motorEfficiency = 0.8;
    expect(motorDrivePowerW({ requiredTorqueNm, rpm, motorEfficiency })).toBeCloseTo(
      requiredTorqueNm * Math.abs(rpmToAngularVelocity(rpm)) / motorEfficiency,
      14,
    );
  });
});

describe("axisymmetric optical-only rotation regression", () => {
  it.each(["sphere", "cylinder", "cone"] as const)(
    "keeps %s Y-rotation energy gain near zero when temperature feedback is disabled",
    (shape) => {
      const surface = createComparisonSurface(shape, {
        landAreaM2: 0.05,
        azimuthSamples: 64,
        meridionalSegments: 8,
      });
      const start = Date.UTC(2026, 5, 21, 0);
      const weather = getOfflineWeather({
        latitudeDeg: 37.5665,
        longitudeDeg: 126.978,
        elevationM: 38,
        start,
        end: start + 12 * 3_600_000,
        stepMinutes: 60,
        offlinePreset: "clear",
        seed: `axisymmetric-no-thermal-${shape}`,
      }, { now: new Date(0) }).points;
      const common = {
        surface,
        weather,
        location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
        referenceEfficiency: 0.2,
        // gamma=0 makes electrical output independent of the thermal history.
        gammaPerC: 0,
        inverter: false as const,
        iam: { model: "none" as const },
        diffuseModel: "isotropic" as const,
        config: { maximumSubstepSeconds: 300 },
      };
      const stationary = simulateTransientSurfaceHistory({
        ...common,
        rpm: 0,
      });
      const rotating = simulateTransientSurfaceHistory({
        ...common,
        rpm: 3,
      });
      const relativeGain = (rotating.acEnergyWh - stationary.acEnergyWh)
        / stationary.acEnergyWh;

      expect(stationary.acEnergyWh).toBeGreaterThan(0);
      expect(Number.isFinite(relativeGain)).toBe(true);
      expect(Math.abs(relativeGain)).toBeLessThan(5e-4);
    },
    30_000,
  );
});
