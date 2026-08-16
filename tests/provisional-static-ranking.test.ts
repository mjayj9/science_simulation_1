import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROVISIONAL_RANKING_STATUS_KO,
  PROVISIONAL_STATIC_RANKING,
  PROVISIONAL_STATIC_RANKING_PROVENANCE,
  provisionalPvAreaRanking,
  provisionalRankLabelKo,
  validateProvisionalStaticRanking,
  type ProvisionalStaticRankingRow,
} from "../src/ui/provisional-static-ranking";
import { ENGINEERING_RANK_SHAPES } from "../src/ui/engineering-official-ranking";

/**
 * These rows are decision-grade measurements that deliberately lack a
 * certificate. The risk is drift in the other direction from the usual one: not
 * that the numbers are wrong, but that the "provisional" framing quietly erodes
 * until a reader takes them for the audited official ranking. These tests pin
 * the framing as tightly as the arithmetic.
 */
describe("provisional stationary ranking stays provisional", () => {
  it("covers every official shape exactly once, ordered by land productivity", () => {
    expect(PROVISIONAL_STATIC_RANKING).toHaveLength(ENGINEERING_RANK_SHAPES.length);
    expect(new Set(PROVISIONAL_STATIC_RANKING.map((row) => row.shape)).size)
      .toBe(ENGINEERING_RANK_SHAPES.length);
    for (const shape of ENGINEERING_RANK_SHAPES) {
      expect(PROVISIONAL_STATIC_RANKING.some((row) => row.shape === shape)).toBe(true);
    }
  });

  it("recomputes both productivities from net AC and area", () => {
    expect(validateProvisionalStaticRanking()).toEqual({ valid: true, reasons: [] });
  });

  it("rejects a transcription slip in either quotient", () => {
    const rows = PROVISIONAL_STATIC_RANKING.map((row) => ({ ...row }));
    rows[2].kWhPerLandM2Year *= 1.05;
    const result = validateProvisionalStaticRanking(rows);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain(`${rows[2].shape}:land-productivity-mismatch`);
  });

  it("rejects rows that stop descending by land productivity", () => {
    const rows = PROVISIONAL_STATIC_RANKING.map((row) => ({ ...row }));
    const swapped: ProvisionalStaticRankingRow[] = [rows[1], rows[0], ...rows.slice(2)]
      .map((row, index) => ({ ...row, rank: index + 1 }));
    expect(validateProvisionalStaticRanking(swapped).valid).toBe(false);
  });

  it("never emits an official rank label", () => {
    for (const row of PROVISIONAL_STATIC_RANKING) {
      const label = provisionalRankLabelKo(row.rank);
      expect(label).toContain("잠정");
      expect(label).not.toContain("공식");
    }
  });

  it("records that the gate is closed and says what would open it", () => {
    expect(PROVISIONAL_RANKING_STATUS_KO).toContain("잠정");
    expect(PROVISIONAL_STATIC_RANKING_PROVENANCE.gateStatus)
      .toContain("officialRankingEligible=false");
    expect(PROVISIONAL_STATIC_RANKING_PROVENANCE.missingForOfficial).toContain("통제회전");
    // Weather must never be presented as measured TMY.
    expect(PROVISIONAL_STATIC_RANKING_PROVENANCE.weatherSource).toContain("model-estimate");
    expect(PROVISIONAL_STATIC_RANKING_PROVENANCE.timeResolution).toContain("8,760");
    expect(PROVISIONAL_STATIC_RANKING_PROVENANCE.thermalModel).toContain("transient");
    expect(PROVISIONAL_STATIC_RANKING_PROVENANCE.rotationModes).toContain("0 RPM");
  });

  it("keeps the provisional source free of official-ranking vocabulary", () => {
    // A future edit that starts calling these rows official has to delete this
    // test to do it, which is the point.
    const source = readFileSync(
      resolve(process.cwd(), "src/ui/provisional-static-ranking.ts"), "utf8",
    );
    expect(source).not.toMatch(/공식\s*#/);
    expect(source).not.toContain("officialRankingEligible=true");
  });

  it("orders material efficiency separately, with the plane leading", () => {
    const byPvArea = provisionalPvAreaRanking();
    expect(byPvArea[0].shape).toBe("plane");
    // The plane's advantage per cell area is the literature-consistent result;
    // it must not be flattened by a future sort that reuses the land order.
    expect(byPvArea[0].kWhPerPvM2Year).toBeGreaterThan(byPvArea[1].kWhPerPvM2Year * 2);
    expect(PROVISIONAL_STATIC_RANKING[0].shape).toBe("cube");
  });

  it("keeps the plane's connection loss far below every curved shape", () => {
    const plane = PROVISIONAL_STATIC_RANKING.find((row) => row.shape === "plane")!;
    const curved = PROVISIONAL_STATIC_RANKING.filter((row) => row.shape !== "plane");
    expect(plane.connectionLossFraction).toBeLessThan(0.01);
    for (const row of curved) {
      expect(row.connectionLossFraction).toBeGreaterThan(0.3);
    }
  });

  it("keeps every adjacent margin outside the numerical convergence bound", () => {
    // Mesh convergence is certified at 2%; the smallest adjacent gap must sit
    // clear of it, or the published order would be resolution-sensitive.
    for (let index = 1; index < PROVISIONAL_STATIC_RANKING.length; index += 1) {
      const above = PROVISIONAL_STATIC_RANKING[index - 1].kWhPerLandM2Year;
      const below = PROVISIONAL_STATIC_RANKING[index].kWhPerLandM2Year;
      expect(above / below - 1).toBeGreaterThan(0.02);
    }
  });
});
