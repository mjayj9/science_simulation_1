import { describe, expect, it } from "vitest";
import {
  EXPLORATORY_RANK_LABEL_KO,
  comparisonRankPrefix,
  comparisonRankVerdict,
} from "../src/ui/comparison-rank-label";

describe("comparison rank presentation", () => {
  it("never assigns a number to an exploratory result", () => {
    for (const candidateRank of [undefined, 1, 2, 6]) {
      expect(comparisonRankPrefix(false, candidateRank)).toBe("");
      const verdict = comparisonRankVerdict(false, candidateRank);
      expect(verdict).toBe(EXPLORATORY_RANK_LABEL_KO);
      expect(verdict).not.toContain("#");
      expect(verdict).not.toMatch(/\b[1-6]\b/);
    }
  });

  it("shows a rank number only for a valid official result", () => {
    expect(comparisonRankPrefix(true, 2)).toBe("#2 ");
    expect(comparisonRankVerdict(true, 2)).toBe("공식 #2");
    expect(comparisonRankVerdict(true, undefined)).toBe(EXPLORATORY_RANK_LABEL_KO);
  });
});
