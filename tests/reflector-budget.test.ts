import { describe, expect, it } from "vitest";
import { reflectedPowerBudgetW, resolveReflector } from "../src/lib/compare";

describe("명시적 반사 조건과 에너지 상한", () => {
  it("일반 모드에는 사용자가 지정한 지면 albedo만 적용한다", () => {
    expect(resolveReflector("none", 0.23)).toMatchObject({
      effectiveReflectance: 0.23,
      model: "ground-lambertian",
      concentrationEnabled: false,
    });
  });

  it("연구 반사면을 일반 구형 PV 고유 성능과 섞지 않는다", () => {
    expect(resolveReflector("white-diffuse", 0.1).effectiveReflectance).toBe(0.85);
    expect(resolveReflector("aluminum", 0.1)).toMatchObject({
      effectiveReflectance: 0.88,
      model: "diffuse-equivalent-panel",
      concentrationEnabled: false,
    });
    expect(resolveReflector("research-cup", 0.1).model).toBe("research-cup-no-concentration");
  });

  it("반사광은 parcel에 입사한 GHI와 반사율의 곱을 초과하지 않는다", () => {
    const reflector = resolveReflector("white-diffuse", 0.2);
    expect(reflectedPowerBudgetW(800, 0.05, reflector)).toBeCloseTo(34, 12);
    expect(reflectedPowerBudgetW(800, 0.05, reflector)).toBeLessThanOrEqual(800 * 0.05);
  });
});
