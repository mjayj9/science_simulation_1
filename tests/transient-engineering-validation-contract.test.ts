import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TRANSIENT_ENGINEERING_RANKING_MODES,
  validateTransientEngineeringOfficialRankings,
  validateTransientEngineeringRunningOrFailedGate,
} from "../scripts/transient-engineering-validation-contract";
import { ENGINEERING_VALIDATION_SHAPES } from "../scripts/engineering-validation-contract";

const gatePath = "src/lib/physics/transient-engineering-validation.generated.json";

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function asRunningOrFailedGate(): Record<string, unknown> {
  const gate = structuredClone(json(gatePath));
  gate.status = "running-or-failed";
  gate.artifactSha256 = "";
  gate.officialRankingEligible = false;
  gate.officialRankings = { static: [], controlled: [], natural: [] };
  return gate;
}

function fixtureSection(
  gate: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const fixture = gate.certifiedFixture as Record<string, unknown>;
  return fixture[section] as Record<string, unknown>;
}

function rankingFixtures() {
  const reference = Object.fromEntries(TRANSIENT_ENGINEERING_RANKING_MODES.map((mode) => [
    mode,
    ENGINEERING_VALIDATION_SHAPES.map((shape, index) => ({
      rank: index + 1,
      shape,
      landAreaM2: 0.05,
      activePvAreaM2: 0.1 + index / 100,
      netAcKWhYear: 20 - index,
      kWhPerLandM2Year: (20 - index) / 0.05,
      kWhPerPvM2Year: (20 - index) / (0.1 + index / 100),
      electricalLayoutId: `layout-${mode}-${shape}`,
    })),
  ])) as unknown as Parameters<typeof validateTransientEngineeringOfficialRankings>[1];
  const compact = Object.fromEntries(TRANSIENT_ENGINEERING_RANKING_MODES.map((mode) => [
    mode,
    reference[mode].map((row) => ({
      rank: row.rank,
      shape: row.shape,
      landAreaM2: row.landAreaM2,
      activePvAreaM2: row.activePvAreaM2,
      netAcKWhYear: row.netAcKWhYear,
      kWhPerLandM2Year: row.kWhPerLandM2Year,
      kWhPerPvM2Year: row.kWhPerPvM2Year,
      layoutId: row.electricalLayoutId,
      status: "official",
    })),
  ]));
  return { reference, compact };
}

describe("transient engineering compact validation gate", () => {
  it("accepts a schema-complete running-or-failed gate only with empty official rows", () => {
    const gate = asRunningOrFailedGate();
    const result = validateTransientEngineeringRunningOrFailedGate(gate);
    expect(result.status).toBe("running-or-failed");
    expect(result.certifiedFixture.geometry.planeAzimuthDeg).toBe(180);
    expect(result.officialRankings).toEqual({ static: [], controlled: [], natural: [] });
  });

  it("rejects certified fixture and fail-gate ranking tampering", () => {
    const azimuth = asRunningOrFailedGate();
    fixtureSection(azimuth, "geometry").planeAzimuthDeg = 0;
    expect(() => validateTransientEngineeringRunningOrFailedGate(azimuth)).toThrow(/certified contract/);

    const weather = asRunningOrFailedGate();
    fixtureSection(weather, "weather").seed = "tampered-seed";
    expect(() => validateTransientEngineeringRunningOrFailedGate(weather)).toThrow(/certified contract/);

    const ranked = asRunningOrFailedGate();
    (ranked.officialRankings as Record<string, unknown[]>).static.push({ status: "official" });
    expect(() => validateTransientEngineeringRunningOrFailedGate(ranked)).toThrow(/must be empty/);
  });

  it("requires all 18 compact official rows to match full ranking rows exactly", () => {
    const { reference, compact } = rankingFixtures();
    expect(validateTransientEngineeringOfficialRankings(compact, reference).static).toHaveLength(6);

    const layout = structuredClone(compact) as Record<string, Array<Record<string, unknown>>>;
    layout.controlled[0].layoutId = "tampered";
    expect(() => validateTransientEngineeringOfficialRankings(layout, reference)).toThrow(/full-artifact/);

    const energy = structuredClone(compact) as Record<string, Array<Record<string, unknown>>>;
    energy.natural[2].netAcKWhYear = Number(energy.natural[2].netAcKWhYear) + 1e-9;
    expect(() => validateTransientEngineeringOfficialRankings(energy, reference)).toThrow(/full-artifact/);

    const status = structuredClone(compact) as Record<string, Array<Record<string, unknown>>>;
    status.static[0].status = "exploratory";
    expect(() => validateTransientEngineeringOfficialRankings(status, reference)).toThrow(/must be official/);

    const missing = structuredClone(compact) as Record<string, Array<Record<string, unknown>>>;
    missing.static.pop();
    expect(() => validateTransientEngineeringOfficialRankings(missing, reference)).toThrow(/six compact/);
  });
});
