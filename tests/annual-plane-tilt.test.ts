import { describe, expect, it } from "vitest";
import { optimizeWeatherDrivenAnnualPlaneTilt } from "../src/lib/compare";
import { DEFAULT_ELECTRICAL, DEFAULT_INVERTER, DEFAULT_THERMAL } from "../src/lib/physics";
import { getOfflineWeather } from "../src/lib/weather";

const LOCATION = {
  latitudeDeg: 37.5665,
  longitudeDeg: 126.978,
  elevationM: 38,
  applyRefraction: false,
} as const;

const WEATHER = getOfflineWeather({
  ...LOCATION,
  start: "2025-01-01T00:00:00Z",
  end: "2026-01-01T00:00:00Z",
  stepMinutes: 180,
  offlinePreset: "clear",
  seed: "annual-plane-optimizer-test",
}).points;

function input(overrides: Partial<Parameters<typeof optimizeWeatherDrivenAnnualPlaneTilt>[0]> = {}) {
  return {
    weather: WEATHER,
    location: LOCATION,
    landAreaM2: 0.05,
    maximumHeightM: 0.4,
    supportHeightM: 0.02,
    planeAzimuthDeg: 180,
    optics: {
      albedo: 0.2,
      iam: { model: "ashrae" as const, b0: 0.05 },
      soilingLossFraction: 0.02,
      diffuseModel: "hay-davies" as const,
    },
    electrical: { ...DEFAULT_ELECTRICAL },
    thermal: { ...DEFAULT_THERMAL },
    inverter: { ...DEFAULT_INVERTER, ratedAcPowerW: 100 },
    ...overrides,
  };
}

describe("weather-driven annual AC plane tilt", () => {
  it("converges to the same annual-AC optimum as the search is refined", () => {
    const coarse = optimizeWeatherDrivenAnnualPlaneTilt(input({
      coarseStepDeg: 10,
      toleranceDeg: 0.2,
    }));
    const refined = optimizeWeatherDrivenAnnualPlaneTilt(input({
      coarseStepDeg: 3,
      toleranceDeg: 0.02,
    }));

    expect(refined.annualAcEnergyWh).toBeGreaterThan(0);
    expect(coarse.tiltDeg).toBeCloseTo(refined.tiltDeg, 1);
    expect(coarse.annualAcEnergyWh / refined.annualAcEnergyWh).toBeCloseTo(1, 4);
    expect(refined.tiltDeg).toBeGreaterThan(0);
    expect(refined.tiltDeg).toBeLessThanOrEqual(refined.physicalMaximumTiltDeg + 1e-10);
    expect(coarse.totalHeightM).toBeLessThanOrEqual(0.4 + 1e-10);
  });

  it("clips the optimum to the square-footprint height envelope", () => {
    const landAreaM2 = 0.05;
    const supportHeightM = 0.02;
    const maximumHeightM = 0.04;
    const expectedMaximumTiltDeg = Math.atan(
      (maximumHeightM - supportHeightM) / Math.sqrt(landAreaM2),
    ) * 180 / Math.PI;
    const result = optimizeWeatherDrivenAnnualPlaneTilt(input({
      landAreaM2,
      supportHeightM,
      maximumHeightM,
      toleranceDeg: 0.001,
    }));

    expect(result.physicalMaximumTiltDeg).toBeCloseTo(expectedMaximumTiltDeg, 10);
    expect(result.tiltDeg).toBeCloseTo(expectedMaximumTiltDeg, 2);
    expect(result.totalHeightM).toBeLessThanOrEqual(maximumHeightM + 1e-10);
    expect(result.verticalRiseM).toBeCloseTo(maximumHeightM - supportHeightM, 8);
    expect(result.activeAreaM2).toBeCloseTo(
      landAreaM2 / Math.cos(result.tiltDeg * Math.PI / 180),
      10,
    );
  });

  it("runs the explicit soiling, Faiman, temperature-DC, and inverter chain", () => {
    const clean = optimizeWeatherDrivenAnnualPlaneTilt(input({
      optics: {
        albedo: 0.2,
        iam: { model: "ashrae", b0: 0.05 },
        soilingLossFraction: 0,
      },
    }));
    const soiled = optimizeWeatherDrivenAnnualPlaneTilt(input({
      optics: {
        albedo: 0.2,
        iam: { model: "ashrae", b0: 0.05 },
        soilingLossFraction: 0.15,
      },
    }));
    const hotter = optimizeWeatherDrivenAnnualPlaneTilt(input({
      thermal: { u0Wm2K: 8, u1WsM3K: 0 },
    }));
    const lowerEfficiencyInverter = optimizeWeatherDrivenAnnualPlaneTilt(input({
      inverter: { ...DEFAULT_INVERTER, ratedAcPowerW: 100, nominalEfficiency: 0.8 },
    }));

    expect(clean.annualAcEnergyWh).toBeGreaterThan(soiled.annualAcEnergyWh);
    expect(clean.annualAcEnergyWh).toBeGreaterThan(hotter.annualAcEnergyWh);
    expect(clean.annualAcEnergyWh).toBeGreaterThan(lowerEfficiencyInverter.annualAcEnergyWh);
  });
});
