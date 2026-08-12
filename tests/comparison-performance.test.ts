import { describe, expect, it } from "vitest";
import {
  integrateSeriesWh,
  normalizedAnnualEnergy,
  summarizeDailyPerformance,
  type PerformanceSeriesPoint,
} from "../src/lib/compare";

const points: PerformanceSeriesPoint[] = [
  { minute: 0, acPowerW: 0, directOpticalW: 0, diffuseOpticalW: 0, groundOpticalW: 0 },
  { minute: 360, acPowerW: 0, directOpticalW: 0, diffuseOpticalW: 0, groundOpticalW: 0 },
  { minute: 720, acPowerW: 10, directOpticalW: 8, diffuseOpticalW: 2, groundOpticalW: 0 },
  { minute: 1080, acPowerW: 0, directOpticalW: 0, diffuseOpticalW: 0, groundOpticalW: 0 },
  { minute: 1440, acPowerW: 0, directOpticalW: 0, diffuseOpticalW: 0, groundOpticalW: 0 },
];

describe("토지·PV 면적 성능 지표", () => {
  it("원본 점을 평활화하지 않고 사다리꼴 에너지로 적분한다", () => {
    expect(integrateSeriesWh(points, (point) => point.acPowerW)).toBeCloseTo(60, 12);
    expect(integrateSeriesWh(points, (point) => point.acPowerW, { endMinute: 720 })).toBeCloseTo(30, 12);
    expect(integrateSeriesWh(points, (point) => point.acPowerW, { startMinute: 720 })).toBeCloseTo(30, 12);
  });

  it("토지와 PV 정규화, 발전구간 변동계수와 광학 성분을 분리한다", () => {
    const result = summarizeDailyPerformance(points, 0.05, 0.2);
    expect(result.energyWh).toBeCloseTo(60, 12);
    expect(result.energyWhPerLandM2).toBeCloseTo(1200, 12);
    expect(result.energyWhPerPvM2).toBeCloseTo(300, 12);
    expect(result.generationStartMinute).toBe(720);
    expect(result.generationEndMinute).toBe(720);
    expect(result.coefficientOfVariation).toBe(0);
    expect(result.opticalShares).toEqual({ direct: 0.8, diffuse: 0.2, ground: 0 });
  });

  it("연간 결과를 kWh, kWh/m²-land, kWh/m²-PV로 동시에 변환한다", () => {
    expect(normalizedAnnualEnergy(20_000, 0.05, 0.2)).toEqual({
      kWh: 20,
      kWhPerLandM2: 400,
      kWhPerPvM2: 100,
    });
  });

  it("동일한 A_land에서 절대 발전량과 토지면적당 발전량의 순위·상대비를 보존한다", () => {
    const landAreaM2 = 0.05;
    const annualWh = [18_250, 21_900, 12_775, 21_900, 7_300, 16_425];
    const normalized = annualWh.map((energyWh, index) => ({
      index,
      energyWh,
      ...normalizedAnnualEnergy(energyWh, landAreaM2, 0.05 * (index + 1)),
    }));

    const absoluteOrder = [...normalized]
      .sort((left, right) => right.kWh - left.kWh || left.index - right.index)
      .map(({ index }) => index);
    const landOrder = [...normalized]
      .sort((left, right) => right.kWhPerLandM2 - left.kWhPerLandM2 || left.index - right.index)
      .map(({ index }) => index);

    expect(landOrder).toEqual(absoluteOrder);
    for (const item of normalized) {
      expect(item.kWhPerLandM2).toBeCloseTo(item.kWh / landAreaM2, 14);
      expect(item.kWhPerLandM2 / normalized[0].kWhPerLandM2)
        .toBeCloseTo(item.kWh / normalized[0].kWh, 14);
    }
  });

  it("역순·중복·비유한·음수 입력을 거부한다", () => {
    expect(() => summarizeDailyPerformance([points[1], points[0]], 0.05, 0.2)).toThrow(/오름차순/);
    expect(() => normalizedAnnualEnergy(Number.NaN, 0.05, 0.2)).toThrow(/유한수/);
    expect(() => normalizedAnnualEnergy(1, 0, 0.2)).toThrow(/0보다 큰/);
  });
});
