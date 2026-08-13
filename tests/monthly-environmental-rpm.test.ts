import { describe, expect, it } from "vitest";
import {
  solveMonthlyEnvironmentalAverageRpm,
  type EnvironmentalAverageRpmInput,
} from "../src/lib/physics";
import type { WeatherPoint } from "../src/lib/weather";

function weatherPoint(timeUtc: string, windSpeedMs: number): WeatherPoint {
  return {
    timeUtcMs: Date.parse(timeUtc),
    ghiWm2: 0,
    dniWm2: 0,
    dhiWm2: 0,
    ambientC: 20,
    windSpeedMs,
    windDirectionDeg: 0,
    gustMs: windSpeedMs,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

const SELF_STARTING_BASE: Omit<EnvironmentalAverageRpmInput, "referenceWindSpeedMS"> = {
  shape: "cylinder",
  referenceHeightM: 10,
  structureCentreHeightM: 2,
  rotorRadiusM: 0.15,
  rotorAreaM2: 0.12,
  maximumRpm: 10_000,
  staticFrictionNm: 0.001,
  bearingViscousNmPerRadS: 0.004,
  airDragNmPerRadS2: 0.0008,
  selfStarting: {
    kind: "user-cq",
    source: "user",
    torqueCoefficient: (lambda) => Math.max(0, 0.18 * (1 - lambda / 1.4)),
  },
};

describe("monthly environmental mean-RPM schedule", () => {
  it("maps UTC samples to local calendar months and uses each arithmetic wind mean", () => {
    const weather: readonly WeatherPoint[] = [
      weatherPoint("2025-01-31T15:00:00Z", 2),
      weatherPoint("2025-02-28T14:59:00Z", 6),
      weatherPoint("2025-02-28T15:00:00Z", 8),
    ];
    const schedule = solveMonthlyEnvironmentalAverageRpm({
      weather,
      timezoneOffsetMinutes: 9 * 60,
      baseInput: SELF_STARTING_BASE,
    });

    expect(schedule.months).toHaveLength(12);
    expect(schedule.months.map((entry) => entry.localMonth)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(schedule.months[1]).toMatchObject({
      localMonth: 2,
      sampleCount: 2,
      meanReferenceWindSpeedMS: 4,
      missingWeather: false,
    });
    expect(schedule.months[1].result.referenceWindSpeedMS).toBe(4);
    expect(schedule.months[2]).toMatchObject({
      localMonth: 3,
      sampleCount: 1,
      meanReferenceWindSpeedMS: 8,
      missingWeather: false,
    });
    expect(schedule.months[2].result.referenceWindSpeedMS).toBe(8);
    expect(schedule.months[0].sampleCount).toBe(0);
    expect(schedule.rpmByWeatherStep).toEqual([
      schedule.months[1].result.finalRpm,
      schedule.months[1].result.finalRpm,
      schedule.months[2].result.finalRpm,
    ]);
  });

  it("keeps missing months explicit at a deterministic zero instead of inventing wind", () => {
    const schedule = solveMonthlyEnvironmentalAverageRpm({
      weather: [weatherPoint("2025-01-15T00:00:00Z", 5)],
      timezoneOffsetMinutes: 0,
      baseInput: SELF_STARTING_BASE,
    });

    for (const entry of schedule.months.slice(1)) {
      expect(entry.missingWeather).toBe(true);
      expect(entry.sampleCount).toBe(0);
      expect(entry.meanReferenceWindSpeedMS).toBeNull();
      expect(entry.result.referenceWindSpeedMS).toBe(0);
      expect(entry.result.finalRpm).toBe(0);
      expect(entry.result.warning).toMatch(/기상 표본이 없어/);
    }
  });

  it("returns twelve physical zeroes for an axisymmetric body without self-starting hardware", () => {
    const weather = Array.from({ length: 12 }, (_, monthIndex) =>
      weatherPoint(new Date(Date.UTC(2025, monthIndex, 15)).toISOString(), monthIndex + 1));
    const schedule = solveMonthlyEnvironmentalAverageRpm({
      weather,
      timezoneOffsetMinutes: 0,
      baseInput: { ...SELF_STARTING_BASE, selfStarting: undefined },
    });

    expect(schedule.months).toHaveLength(12);
    expect(schedule.months.every((entry) => entry.result.finalRpm === 0)).toBe(true);
    expect(schedule.months.every((entry) => entry.result.unconstrainedRpm === 0)).toBe(true);
    expect(schedule.months.every((entry) => entry.result.warning?.includes("자가 기동 토크"))).toBe(true);
    expect(schedule.rpmByWeatherStep).toEqual(Array<number>(12).fill(0));
  });

  it("solves a torque equilibrium independently for all twelve monthly wind means", () => {
    const weather = Array.from({ length: 24 }, (_, index) => {
      const monthIndex = Math.floor(index / 2);
      return weatherPoint(
        new Date(Date.UTC(2025, monthIndex, index % 2 === 0 ? 5 : 20)).toISOString(),
        4 + monthIndex * 0.2 + (index % 2) * 0.4,
      );
    });
    const schedule = solveMonthlyEnvironmentalAverageRpm({
      weather,
      timezoneOffsetMinutes: 0,
      baseInput: SELF_STARTING_BASE,
    });

    for (const [monthIndex, entry] of schedule.months.entries()) {
      expect(entry.sampleCount).toBe(2);
      expect(entry.meanReferenceWindSpeedMS).toBeCloseTo(4.2 + monthIndex * 0.2, 12);
      expect(entry.result.finalRpm).toBeGreaterThan(0);
      expect(entry.result.safetyLimited).toBe(false);
      expect(Math.abs(entry.result.torqueResidualNm)).toBeLessThan(1e-10);
      expect(entry.result.aerodynamicTorqueNm).toBeCloseTo(entry.result.lossTorqueNm, 10);
    }
  });

  it("keeps the next-year closing endpoint out of monthly wind statistics", () => {
    const weather = [
      weatherPoint("2025-01-01T00:00:00Z", 4),
      weatherPoint("2025-07-01T00:00:00Z", 6),
      weatherPoint("2026-01-01T00:00:00Z", 80),
    ];
    const schedule = solveMonthlyEnvironmentalAverageRpm({
      weather,
      timezoneOffsetMinutes: 0,
      finalPointIsClosingEndpoint: true,
      baseInput: SELF_STARTING_BASE,
    });

    expect(schedule.months[0].sampleCount).toBe(1);
    expect(schedule.months[0].meanReferenceWindSpeedMS).toBe(4);
    expect(schedule.rpmByWeatherStep).toHaveLength(weather.length);
    expect(schedule.rpmByWeatherStep.at(-1)).toBe(schedule.months[0].result.finalRpm);
  });

  it("rejects unreasonable offsets and invalid weather timestamps or wind speeds", () => {
    const solve = (weather: readonly WeatherPoint[], timezoneOffsetMinutes = 0) =>
      solveMonthlyEnvironmentalAverageRpm({
        weather,
        timezoneOffsetMinutes,
        baseInput: SELF_STARTING_BASE,
      });

    expect(() => solve([], Number.NaN)).toThrow(/timezoneOffsetMinutes must be finite/);
    expect(() => solve([], 14 * 60 + 1)).toThrow(/UTC-14:00\.\.UTC\+14:00/);
    expect(() => solve([weatherPoint("not-a-date", 3)])).toThrow(/timeUtcMs must be finite/);
    expect(() => solve([weatherPoint("2025-01-01T00:00:00Z", -0.1)])).toThrow(
      /windSpeedMs must be finite and nonnegative/,
    );
  });
});
