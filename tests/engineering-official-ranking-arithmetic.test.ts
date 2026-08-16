import { describe, expect, it } from "vitest";
import {
  ENGINEERING_RANK_SHAPES,
  validateOfficialRankingArithmetic,
  type EngineeringArtifactOfficialRankingRow,
} from "../src/ui/engineering-official-ranking";
import { ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION } from "../src/lib/physics/engineering-surface-electrical";

const LAND_AREA_M2 = 0.05;

/**
 * Builds a self-consistent ranking: descending land productivity, ranks equal
 * to row position, and both productivity quotients derived from the energy and
 * areas rather than stated independently.
 */
function ranking(
  netAcKWhYearByShape: readonly number[],
  pvAreaM2ByShape?: readonly number[],
): EngineeringArtifactOfficialRankingRow[] {
  return ENGINEERING_RANK_SHAPES.map((shape, index) => {
    const netAcKWhYear = netAcKWhYearByShape[index];
    const activePvAreaM2 = pvAreaM2ByShape?.[index] ?? 0.1 + index * 0.01;
    return {
      rank: index + 1,
      shape,
      landAreaM2: LAND_AREA_M2,
      activePvAreaM2,
      netAcKWhYear,
      kWhPerLandM2Year: netAcKWhYear / LAND_AREA_M2,
      kWhPerPvM2Year: netAcKWhYear / activePvAreaM2,
      layoutId: `${ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION}|activeAreaM2=${activePvAreaM2}`,
      status: "official" as const,
    };
  });
}

const DESCENDING = [6, 5, 4, 3, 2, 1] as const;

describe("official ranking arithmetic revalidation", () => {
  it("accepts a self-consistent strictly descending ranking", () => {
    expect(validateOfficialRankingArithmetic(ranking(DESCENDING)))
      .toEqual({ valid: true, reasons: [] });
  });

  it("rejects a permuted rank assignment that a set-completeness check accepts", () => {
    const rows = ranking(DESCENDING);
    // The 1..6 set stays complete; only the mapping to rows is scrambled.
    const scrambled = rows.map((row, index) => ({ ...row, rank: rows.length - index }));
    expect(new Set(scrambled.map((row) => row.rank)))
      .toEqual(new Set([1, 2, 3, 4, 5, 6]));
    const result = validateOfficialRankingArithmetic(scrambled);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("rank-does-not-match-row-order")))
      .toBe(true);
  });

  it("rejects rows that are not ordered by descending land productivity", () => {
    const rows = ranking([6, 5, 4, 3, 2, 1]);
    const outOfOrder = [rows[0], rows[2], rows[1], rows[3], rows[4], rows[5]]
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const result = validateOfficialRankingArithmetic(outOfOrder);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("ranking-not-descending"))).toBe(true);
  });

  it("rejects a published land productivity that disagrees with net AC over A_land", () => {
    const rows = ranking(DESCENDING);
    rows[2] = { ...rows[2], kWhPerLandM2Year: rows[2].kWhPerLandM2Year * 1.05 };
    const result = validateOfficialRankingArithmetic(rows);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain(`${rows[2].shape}:land-productivity-arithmetic-mismatch`);
  });

  it("rejects a published PV productivity that disagrees with net AC over A_PV", () => {
    const rows = ranking(DESCENDING);
    rows[1] = { ...rows[1], kWhPerPvM2Year: rows[1].kWhPerPvM2Year + 1 };
    const result = validateOfficialRankingArithmetic(rows);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain(`${rows[1].shape}:pv-productivity-arithmetic-mismatch`);
  });

  it("rejects negative net AC, which the motor ledger floor forbids", () => {
    const rows = ranking([6, 5, 4, 3, 2, -1]);
    const result = validateOfficialRankingArithmetic(rows);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain(`${rows[5].shape}:net-ac-not-finite-non-negative`);
  });

  it("rejects a non-positive A_PV instead of dividing by zero", () => {
    const rows = ranking(DESCENDING, [0.1, 0, 0.12, 0.13, 0.14, 0.15]);
    const result = validateOfficialRankingArithmetic(rows);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain(`${rows[1].shape}:area-not-positive-finite`);
  });

  it("rejects an incomplete shape cohort", () => {
    expect(validateOfficialRankingArithmetic(ranking(DESCENDING).slice(0, 5)))
      .toEqual({ valid: false, reasons: ["ranking-row-count-mismatch"] });
  });

  it("refuses to publish an ordering it cannot justify when land productivity ties", () => {
    // Two shapes producing identical net AC on the common A_land. Until a
    // tie-break policy is chosen, ranks must not be published for this cohort.
    const rows = ranking([6, 5, 5, 3, 2, 1]);
    const result = validateOfficialRankingArithmetic(rows);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("tie-break-unresolved"))).toBe(true);
  });
});
