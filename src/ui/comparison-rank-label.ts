export const EXPLORATORY_RANK_LABEL_KO = "탐색값 · 순위 판정 불가";

export function comparisonRankPrefix(
  official: boolean,
  rank: number | undefined,
): string {
  if (!official) return "";
  return Number.isInteger(rank) && (rank ?? 0) > 0 ? `#${rank} ` : "";
}

export function comparisonRankVerdict(
  official: boolean,
  rank: number | undefined,
): string {
  const prefix = comparisonRankPrefix(official, rank);
  return official && prefix ? `공식 ${prefix.trim()}` : EXPLORATORY_RANK_LABEL_KO;
}
