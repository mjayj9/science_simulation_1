export type ReflectorMode = "none" | "white-diffuse" | "aluminum" | "research-cup";

export interface ResolvedReflector {
  mode: ReflectorMode;
  labelKo: string;
  effectiveReflectance: number;
  model: "ground-lambertian" | "lambertian-panel" | "diffuse-equivalent-panel" | "research-cup-no-concentration";
  /** Explicitly false: no hidden gain or shape multiplier is permitted. */
  concentrationEnabled: false;
  assumptionKo: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * Resolves visible optical inputs only. Aluminium is represented by its
 * hemispherical reflectance without specular focusing, and the research cup
 * remains a separate geometry label with no unmodelled concentration gain.
 */
export function resolveReflector(mode: ReflectorMode, groundAlbedo: number): ResolvedReflector {
  if (mode === "none") {
    return {
      mode,
      labelKo: "반사판 없음",
      effectiveReflectance: clamp01(groundAlbedo),
      model: "ground-lambertian",
      concentrationEnabled: false,
      assumptionKo: "사용자가 입력한 지면 albedo만 Lambert 지면반사로 적용",
    };
  }
  if (mode === "white-diffuse") {
    return {
      mode,
      labelKo: "흰색 확산 반사판",
      effectiveReflectance: 0.85,
      model: "lambertian-panel",
      concentrationEnabled: false,
      assumptionKo: "연구 프리셋 B의 약 85% 확산 반사율을 사용하며 집광하지 않음",
    };
  }
  if (mode === "aluminum") {
    return {
      mode,
      labelKo: "알루미늄 반사판",
      effectiveReflectance: 0.88,
      model: "diffuse-equivalent-panel",
      concentrationEnabled: false,
      assumptionKo: "약 88% 반사율을 확산 등가로만 사용; 정반사 광선 집중은 모델링하지 않음",
    };
  }
  return {
    mode,
    labelKo: "연구용 반사컵",
    effectiveReflectance: 0.85,
    model: "research-cup-no-concentration",
    concentrationEnabled: false,
    assumptionKo: "반사컵을 별도 연구 조건으로 표시하되 명시적 컵 ray 모델 전에는 숨은 집광 이득을 부여하지 않음",
  };
}

/** Maximum reflected optical power available from the allocated reflector/parcel. */
export function reflectedPowerBudgetW(
  ghiWm2: number,
  reflectorAreaM2: number,
  reflector: Pick<ResolvedReflector, "effectiveReflectance">,
): number {
  if (![ghiWm2, reflectorAreaM2].every(Number.isFinite) || ghiWm2 < 0 || reflectorAreaM2 < 0) {
    throw new RangeError("반사광 에너지 예산 입력은 0 이상의 유한수여야 합니다.");
  }
  return ghiWm2 * reflectorAreaM2 * clamp01(reflector.effectiveReflectance);
}
