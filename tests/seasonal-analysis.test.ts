import { describe, expect, it } from "vitest";
import { selectSeoulSeasonalPeriods } from "../src/lib/compare";
import type { WeatherPoint } from "../src/lib/weather";

function day(date: string, ambientC: number, windSpeedMs: number, cloudFraction: number): WeatherPoint[] {
  return [0, 12, 23].map((hour) => ({
    timeUtcMs: Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`),
    ghiWm2: hour === 12 ? 800 * (1 - 0.7 * cloudFraction) : 0,
    dniWm2: hour === 12 ? 900 * (1 - cloudFraction) : 0,
    dhiWm2: hour === 12 ? 120 : 0,
    ambientC: ambientC - Math.abs(12 - hour) * 0.2,
    windSpeedMs,
    windDirectionDeg: 220,
    gustMs: windSpeedMs + 2,
    cloudFraction,
    precipitationMm: 0,
  }));
}

describe("Seoul seasonal case selection", () => {
  it("selects real source days for all required periods without assuming rotation gain", () => {
    const points = [
      ...day("2026-01-15", 5, 2, 0.3),
      ...day("2026-06-21", 31, 1, 0.1),
      ...day("2026-07-20", 38, 4, 0.1),
      ...day("2026-08-10", 32, 5, 0.85),
      ...day("2026-12-15", 2, 3, 0.5),
    ].sort((left, right) => left.timeUtcMs - right.timeUtcMs);
    const selected = selectSeoulSeasonalPeriods(points);
    expect(selected.map((period) => period.id)).toEqual([
      "annual", "summer", "summer-solstice", "hottest-day",
      "clear-calm-hot", "clear-windy-hot", "cloudy-windy",
    ]);
    expect(selected.find((period) => period.id === "summer-solstice")?.startLocalDate).toBe("2026-06-21");
    expect(selected.find((period) => period.id === "hottest-day")?.startLocalDate).toBe("2026-07-20");
    expect(selected.find((period) => period.id === "clear-calm-hot")?.startLocalDate).toBe("2026-06-21");
    expect(selected.find((period) => period.id === "clear-windy-hot")?.startLocalDate).toBe("2026-07-20");
    expect(selected.find((period) => period.id === "cloudy-windy")?.startLocalDate).toBe("2026-08-10");
    expect(JSON.stringify(selected)).not.toMatch(/gain|이득/i);
  });

  it("marks the nearest observed fallback when an exact weather category is absent", () => {
    const points = [
      ...day("2026-06-20", 30, 2.5, 0.4),
      ...day("2026-08-20", 33, 2.2, 0.45),
    ].sort((left, right) => left.timeUtcMs - right.timeUtcMs);
    const selected = selectSeoulSeasonalPeriods(points);
    expect(selected.find((period) => period.id === "clear-calm-hot")?.exactCriteriaMatch).toBe(false);
    expect(selected.find((period) => period.id === "cloudy-windy")?.selectionReasonKo).toContain("조건을 만족한 날이 없어");
  });
});
