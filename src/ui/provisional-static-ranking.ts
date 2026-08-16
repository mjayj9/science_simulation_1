import { ENGINEERING_RANK_SHAPES, type EngineeringRankShape } from "./engineering-official-ranking";

/**
 * Measured stationary ranking from a PARTIAL coupled audit.
 *
 * These rows are real: each shape was integrated over the actual 8,760-hour
 * weather clock with persistent annual transient thermal state feeding the
 * explicit series/parallel/bypass circuit — the same production path the
 * official ranking uses. They are published here because the numbers are
 * decision-grade even though the certificate is not.
 *
 * What makes them provisional is coverage, not quality. The run computed only
 * the stationary rotation mode, so `--rotation=static` marked it partial and the
 * generated gate stayed fail-closed at `officialRankingEligible=false`. A
 * complete run must also cover controlled rotation and republish
 * `docs/transient-engineering-full-year-audit-2026.json` before any shape can
 * carry an official rank.
 *
 * This module therefore never emits an official rank label. It is deliberately
 * separate from `engineering-official-ranking.ts`, which reads the generated
 * gate and refuses to display anything while that gate is closed. Do not merge
 * the two: the whole point is that a number can be trustworthy and still lack a
 * certificate, and the display must say which it is.
 */

export const PROVISIONAL_RANKING_STATUS_KO = "잠정 측정값 · 공식 인증 전" as const;
export const PROVISIONAL_RANK_PREFIX_KO = "잠정" as const;

export interface ProvisionalStaticRankingRow {
  rank: number;
  shape: EngineeringRankShape;
  landAreaM2: number;
  activePvAreaM2: number;
  netAcKWhYear: number;
  kWhPerLandM2Year: number;
  kWhPerPvM2Year: number;
  /** Ideal local-MPP upper bound minus engineering DC, as a fraction of the bound. */
  connectionLossFraction: number;
  averageTemperatureC: number;
  maximumTemperatureC: number;
}

export interface ProvisionalStaticRankingProvenance {
  measuredAtUtc: string;
  runScope: string;
  rotationModes: string;
  weatherSource: string;
  timeResolution: string;
  thermalModel: string;
  electricalModel: string;
  geometryContract: string;
  numericalResolution: string;
  convergence: string;
  gateStatus: string;
  missingForOfficial: string;
}

export const PROVISIONAL_STATIC_RANKING_PROVENANCE: ProvisionalStaticRankingProvenance = Object.freeze({
  measuredAtUtc: "2026-08-16",
  runScope: "부분 감사 (--rotation=static, 여섯 형상 병렬 실행)",
  rotationModes: "정지 0 RPM. 자연 RPM은 여섯 형상 모두 0 RPM이므로 동일한 계산을 재사용한다.",
  weatherSource: "offline/model-estimate (계측 서울 TMY 아님), seed=full-year-fair-comparison-2025",
  timeResolution: "60분 · 실제 8,760구간 + closing endpoint · 대표일 환산 아님",
  thermalModel: "annual-transient-material-state (구간 간 열상태 유지)",
  electricalModel: "explicit-series-parallel-bypass · 2 스트링 · 10셀/바이패스",
  geometryContract: "static-land-matched · A_land=0.05 m² · H_max=0.2523 m",
  numericalResolution: "azimuth 32 · meridional 16 · phase 1 (정지) · circuit 256 · thermal 6노드 · 결합 900초",
  convergence: "mesh 수렴 감사 12/12 PASS (허용오차 2%, 최대 편차 1.100%)",
  gateStatus: "officialRankingEligible=false — 부분 실행이므로 설계대로 닫힘",
  missingForOfficial: "통제회전 2 RPM 모드를 포함한 전체 실행과 감사 산출물 재발행",
});

/**
 * Ordered by land productivity, descending. Smallest adjacent margin is 6.76%
 * (sphere to plane), far outside the numerical convergence bound, so the order
 * itself is not resolution-sensitive.
 */
export const PROVISIONAL_STATIC_RANKING: readonly ProvisionalStaticRankingRow[] = Object.freeze([
  { rank: 1, shape: "cube", landAreaM2: 0.05, activePvAreaM2: 0.25,
    netAcKWhYear: 26.0317, kWhPerLandM2Year: 520.634, kWhPerPvM2Year: 104.127,
    connectionLossFraction: 0.3218, averageTemperatureC: 18.8, maximumTemperatureC: 56.1 },
  { rank: 2, shape: "cylinder", landAreaM2: 0.05, activePvAreaM2: 0.25,
    netAcKWhYear: 22.8146, kWhPerLandM2Year: 456.293, kWhPerPvM2Year: 91.259,
    connectionLossFraction: 0.4024, averageTemperatureC: 18.8, maximumTemperatureC: 56.3 },
  { rank: 3, shape: "sphere", landAreaM2: 0.05, activePvAreaM2: 0.2,
    netAcKWhYear: 14.4773, kWhPerLandM2Year: 289.546, kWhPerPvM2Year: 72.387,
    connectionLossFraction: 0.4299, averageTemperatureC: 18.4, maximumTemperatureC: 47.2 },
  { rank: 4, shape: "plane", landAreaM2: 0.05, activePvAreaM2: 0.057735,
    netAcKWhYear: 13.5608, kWhPerLandM2Year: 271.216, kWhPerPvM2Year: 234.880,
    connectionLossFraction: 0.0033, averageTemperatureC: 20.3, maximumTemperatureC: 53.5 },
  { rank: 5, shape: "cone", landAreaM2: 0.05, activePvAreaM2: 0.111803,
    netAcKWhYear: 11.2945, kWhPerLandM2Year: 225.890, kWhPerPvM2Year: 101.021,
    connectionLossFraction: 0.3621, averageTemperatureC: 19.0, maximumTemperatureC: 47.2 },
  { rank: 6, shape: "hemisphere", landAreaM2: 0.05, activePvAreaM2: 0.1,
    netAcKWhYear: 9.4001, kWhPerLandM2Year: 188.002, kWhPerPvM2Year: 94.001,
    connectionLossFraction: 0.4076, averageTemperatureC: 19.1, maximumTemperatureC: 51.8 },
]);

/** Material efficiency order, which inverts the land order almost completely. */
export function provisionalPvAreaRanking(): readonly ProvisionalStaticRankingRow[] {
  return [...PROVISIONAL_STATIC_RANKING].sort(
    (left, right) => right.kWhPerPvM2Year - left.kWhPerPvM2Year,
  );
}

/** Always carries the provisional marker; there is no official code path here. */
export function provisionalRankLabelKo(rank: number): string {
  return `${PROVISIONAL_RANK_PREFIX_KO} #${rank}`;
}

export interface ProvisionalRankingIntegrity {
  valid: boolean;
  reasons: readonly string[];
}

/**
 * Recomputes the published quotients and ordering from net AC and area.
 *
 * These rows are hand-transcribed from audit output rather than read from a
 * fingerprinted artifact, which is exactly the situation where a transcription
 * slip goes unnoticed. Recomputing here makes one detectable.
 */
export function validateProvisionalStaticRanking(
  rows: readonly ProvisionalStaticRankingRow[] = PROVISIONAL_STATIC_RANKING,
): ProvisionalRankingIntegrity {
  const reasons: string[] = [];
  const close = (actual: number, expected: number, tolerance = 1e-3): boolean =>
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));

  if (rows.length !== ENGINEERING_RANK_SHAPES.length) reasons.push("row-count-mismatch");
  if (new Set(rows.map((row) => row.shape)).size !== rows.length) reasons.push("duplicate-shape");

  rows.forEach((row, index) => {
    if (row.rank !== index + 1) reasons.push(`${row.shape}:rank-does-not-match-row-order`);
    if (!(row.landAreaM2 > 0) || !(row.activePvAreaM2 > 0)) {
      reasons.push(`${row.shape}:area-not-positive`);
      return;
    }
    if (!(row.netAcKWhYear >= 0)) reasons.push(`${row.shape}:net-ac-negative`);
    if (!close(row.kWhPerLandM2Year, row.netAcKWhYear / row.landAreaM2)) {
      reasons.push(`${row.shape}:land-productivity-mismatch`);
    }
    if (!close(row.kWhPerPvM2Year, row.netAcKWhYear / row.activePvAreaM2)) {
      reasons.push(`${row.shape}:pv-productivity-mismatch`);
    }
    if (!(row.connectionLossFraction >= 0 && row.connectionLossFraction < 1)) {
      reasons.push(`${row.shape}:connection-loss-out-of-range`);
    }
    if (index > 0 && row.kWhPerLandM2Year >= rows[index - 1].kWhPerLandM2Year) {
      reasons.push(`${row.shape}:not-descending-by-land-productivity`);
    }
  });

  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}
