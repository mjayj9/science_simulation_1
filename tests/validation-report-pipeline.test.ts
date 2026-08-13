import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteUtf8 } from "../scripts/validation-io";
import {
  VALIDATION_AUDIT_PATHS,
  VALIDATION_SOURCE_PATHS,
  assertValidationAuditManifest,
  createValidationAuditManifest,
  digestHashRecord,
  type ValidationAuditManifest,
} from "../scripts/validation-provenance";
import {
  ANNUAL_IMPLEMENTATION_SOURCE_FILES,
  VALIDATION_REPORT_LOCAL_LINKS,
  VALIDATION_SHAPES,
  assertValidationReportLocalLinksExist,
  renderValidationArtifactLinks,
  validateAnnualAudit,
  validateResearchAudit,
} from "../scripts/validation-report-contract";

function populatedFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "solarform-validation-pipeline-"));
  for (const [index, relativePath] of VALIDATION_SOURCE_PATHS.entries()) {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `source-${index}\n`, "utf8");
  }
  for (const [index, relativePath] of VALIDATION_AUDIT_PATHS.entries()) {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify({ fixture: index })}\n`, "utf8");
  }
  return root;
}

function implementationFingerprint(rootDir = process.cwd()): string {
  return createHash("sha256").update(
    [...ANNUAL_IMPLEMENTATION_SOURCE_FILES]
      .sort()
      .map((sourcePath) => `${sourcePath}\0${readFileSync(resolve(rootDir, sourcePath))}`)
      .join("\n"),
  ).digest("hex");
}

function makeAnnualAudit(year: number): Record<string, unknown> {
  const ideal = "local-mpp-area-integral";
  const engineering = "explicit-series-parallel-bypass";
  const electricalModes = [ideal, engineering];
  const families = [
    ["static-land-matched", "static-land-matched", "held-static"],
    ["swept-held-static", "swept-rotation-envelope", "held-static"],
    ["controlled-kinematic", "swept-rotation-envelope", "controlled-kinematic"],
    ["controlled-motor-net", "swept-rotation-envelope", "controlled-motor-net"],
    ["natural-no-cq", "static-land-matched", "natural-no-cq"],
  ] as const;
  const row = (shape: string, index: number, electricalModel: string, thermalModel: string,
    geometryContract: string, rotationModel: string, gross: number, motor = 0) => {
    const ac = Math.max(0, gross - motor);
    return {
      shape, landAreaM2: 0.05, selectedFootprintM2: 0.05, heightM: 0.2,
      activePvAreaM2: 0.25, pvLandRatio: 5, grossAcKWhYear: gross,
      motorKWhYear: motor, acKWhYear: ac, kWhPerLandM2Year: ac / 0.05,
      kWhPerPvM2Year: ac / 0.25, electricalModel,
      thermalModel: thermalModel === "quasi-steady-faiman"
        ? "준정상 광학 회전·열이력 미포함"
        : "annual actual-clock transient thermal history included",
      geometryContract,
      rotationModel, weatherSource: "deterministic fixture",
      timeResolution: `60 min; actual ${((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000)} intervals + closing endpoint`,
      representativeDayScaling: false, requestFingerprint: `fixture:${index}:${electricalModel}:${rotationModel}`,
    };
  };
  const groupRows = (electricalModel: string, family: string, thermalModel: string,
    geometryContract: string, rotationModel: string) => VALIDATION_SHAPES.map((shape, index) => {
    const base = family === "swept-held-static" ? 90 - index
      : family === "controlled-kinematic" || family === "controlled-motor-net" ? 99 - index
        : 80 - index;
    return row(shape, index, electricalModel, thermalModel, geometryContract, rotationModel,
      base, family === "controlled-motor-net" ? 1 : 0);
  });
  const groups = electricalModes.flatMap((electricalModel) => families.map(
    ([family, geometryContract, rotationMode]) => ({
      id: `${family}:${electricalModel}`, comparisonMeaning: `${family} fixture`,
      geometryContract, rotationMode, electricalModel, thermalModel: "quasi-steady-faiman",
      officialRankingEligible: electricalModel === ideal,
      rankingVerdict: electricalModel === ideal ? "pass" : "not-evaluated",
      calculationResolution: electricalModel === ideal ? "fixture ideal" : "fixture exploratory",
      rows: groupRows(electricalModel, family, "quasi-steady-faiman", geometryContract, rotationMode),
    }),
  ));
  const decomposition = Object.fromEntries(VALIDATION_SHAPES.map((shape, index) => {
    const e00Wh = (90 - index) * 1_000;
    const e10Wh = e00Wh + 1_000;
    const e01Wh = e00Wh + 2_000;
    const e11Wh = (98 - index) * 1_000;
    const monthly = Array.from({ length: 12 }, (_, monthIndex) => {
      const values = { e00Wh: e00Wh / 12, e10Wh: e10Wh / 12, e01Wh: e01Wh / 12, e11Wh: e11Wh / 12 };
      const opticalWh = values.e10Wh - values.e00Wh;
      const thermalWh = values.e01Wh - values.e00Wh;
      const interactionWh = values.e11Wh - values.e10Wh - values.e01Wh + values.e00Wh;
      const netWh = values.e11Wh - values.e00Wh;
      return { month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`, ...values,
        opticalWh, thermalWh, interactionWh, netWh,
        closureResidualWh: opticalWh + thermalWh + interactionWh - netWh };
    });
    return [shape, { e00Wh, e10Wh, e01Wh, e11Wh, e00GrossWh: e00Wh,
      e11GrossWh: e11Wh + 1_000, e11MotorWh: 1_000, closureResidualWh: 0,
      heatResidualFraction: 1e-12, warmupConverged: true, monthly }];
  }));
  for (const [family, rotationMode, geometryContract] of [
    ["transient-static-land-matched", "held-static", "static-land-matched"],
    ["transient-swept-held-static", "held-static", "swept-rotation-envelope"],
    ["transient-controlled-motor-net", "controlled-motor-net", "swept-rotation-envelope"],
    ["transient-natural-no-cq", "natural-no-cq", "static-land-matched"],
  ] as const) {
    groups.push({ id: `${family}:${ideal}`, comparisonMeaning: `${family} fixture`,
      geometryContract, rotationMode, electricalModel: ideal,
      thermalModel: "annual-transient-material-state", officialRankingEligible: true,
      rankingVerdict: "pass", calculationResolution: "fixture transient",
      rows: VALIDATION_SHAPES.map((shape, index) => {
        const values = decomposition[shape] as { e00Wh: number; e11Wh: number; e11GrossWh: number };
        const controlled = family === "transient-controlled-motor-net";
        const swept = family === "transient-swept-held-static";
        const gross = controlled ? values.e11GrossWh / 1_000 : swept ? values.e00Wh / 1_000 : 80 - index;
        return row(shape, index, ideal, "annual-transient-material-state", geometryContract,
          rotationMode, gross, controlled ? 1 : 0);
      }) });
  }
  const convergence = (shape: string, electricalModel: string, index: number, pass: boolean) => {
    const highWh = 100 + index;
    const tolerance = electricalModel === ideal ? 0.01 : 0.02;
    const relativeDifference = pass ? tolerance / 2 : tolerance * 2;
    return { shape, electricalModel, lowWh: highWh * (1 + relativeDifference), highWh,
      relativeDifference, tolerance, pass };
  };
  const idealComparisons = VALIDATION_SHAPES.map((shape, index) => convergence(shape, ideal, index, true));
  const engineeringComparisons = [convergence("plane", engineering, 0, true), convergence("cylinder", engineering, 1, false)];
  const hours = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000;
  return { schemaVersion: 2, generatedAt: "2026-08-13T00:00:00.000Z",
    conditions: { year, landAreaM2: 0.05, maximumHeightM: 0.2, weatherPoints: hours + 1,
      intervals: hours, durationHours: hours,
      integration: "actual hourly full-year calculation, not representative-day scaling",
      configurationFingerprint: "a".repeat(64), implementationFingerprint: implementationFingerprint(),
      implementationSourceFiles: [...ANNUAL_IMPLEMENTATION_SOURCE_FILES] },
    convergenceGate: { pass: false, officialIdealPass: true, engineeringPass: false,
      engineeringOfficialRankingEligible: false, engineeringRankingVerdict: "not-evaluated",
      engineeringReason: "fixture extended convergence failure",
      lowResolution: { azimuthSamples: 16, meridionalSegments: 4, phaseSamples: 4, circuitSamples: 32 },
      highResolution: { azimuthSamples: 32, meridionalSegments: 8, phaseSamples: 8, circuitSamples: 64 },
      ideal: { pass: true, comparisons: idealComparisons },
      engineering: { pass: false, comparisons: engineeringComparisons, tolerance: 0.02,
        status: "not-evaluated", officialRankingEligible: false,
        extendedCylinder: { shape: "cylinder", electricalModel: engineering,
          selectedResolution: { azimuthSamples: 64, meridionalSegments: 16, phaseSamples: 4, circuitSamples: 128 },
          referenceResolution: { azimuthSamples: 128, meridionalSegments: 32, phaseSamples: 4, circuitSamples: 128 },
          selectedWh: 106.5273, referenceWh: 100, selectedSampleCount: 2_048,
          referenceSampleCount: 8_192, relativeDifference: 0.065273, tolerance: 0.02,
          pass: false, fixture: "four seasonal fixtures", dayOffsets: [19, 109, 201, 293], elapsedMs: 1 } },
    }, groups, transientDecompositionByShape: decomposition };
}

describe("validation pipeline fail-closed provenance", () => {
  it("binds exact source/audit sets and rejects extra keys or aggregate tampering", () => {
    const root = populatedFixtureRoot();
    const manifest = createValidationAuditManifest(root);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.sourceSetSha256).toBe(digestHashRecord(manifest.sourceFiles));
    expect(manifest.auditSetSha256).toBe(digestHashRecord(manifest.auditFiles));
    expect(() => assertValidationAuditManifest(manifest, root)).not.toThrow();

    const extra = structuredClone(manifest) as ValidationAuditManifest & { unexpected?: boolean };
    extra.unexpected = true;
    expect(() => assertValidationAuditManifest(extra, root)).toThrow(/unexpected top-level/);

    const changedAggregate = structuredClone(manifest);
    changedAggregate.sourceSetSha256 = "0".repeat(64);
    expect(() => assertValidationAuditManifest(changedAggregate, root)).toThrow(/aggregate/);
  });

  it("rejects malformed JSON and changed bytes", () => {
    const malformedRoot = populatedFixtureRoot();
    writeFileSync(join(malformedRoot, VALIDATION_AUDIT_PATHS[0]), "{", "utf8");
    expect(() => createValidationAuditManifest(malformedRoot)).toThrow(/not valid JSON/);

    const changedRoot = populatedFixtureRoot();
    const manifest = createValidationAuditManifest(changedRoot);
    const numericalSource = VALIDATION_SOURCE_PATHS.find((entry) => entry.startsWith("src/"));
    if (!numericalSource) throw new Error("Test fixture has no numerical source path.");
    writeFileSync(join(changedRoot, numericalSource), "changed\n", "utf8");
    expect(() => assertValidationAuditManifest(manifest, changedRoot)).toThrow(/stale/);
    expect(() => createValidationAuditManifest(changedRoot)).toThrow(/stale relative to source bytes/);
  });

  it("rejects missing required artifacts", () => {
    const missingRoot = populatedFixtureRoot();
    unlinkSync(join(missingRoot, VALIDATION_AUDIT_PATHS[0]));
    expect(() => createValidationAuditManifest(missingRoot)).toThrow(/missing/);
  });

  it("atomically replaces complete UTF-8 output without a leftover temporary file", () => {
    const root = mkdtempSync(join(tmpdir(), "solarform-atomic-report-"));
    const output = join(root, "nested", "report.md");
    atomicWriteUtf8(output, "first\n");
    atomicWriteUtf8(output, "second\n");
    expect(readFileSync(output, "utf8")).toBe("second\n");
    expect(readdirSync(dirname(output)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

describe("generated report contracts", () => {
  it.each([2025, 2024])("accepts %i only with every hourly interval and closing endpoint", (year) => {
    expect(() => validateAnnualAudit(makeAnnualAudit(year))).not.toThrow();
    const missingEndpoint = structuredClone(makeAnnualAudit(year));
    const conditions = missingEndpoint.conditions as Record<string, number>;
    conditions.weatherPoints -= 1;
    expect(() => validateAnnualAudit(missingEndpoint)).toThrow(/closing endpoint/);
  });

  it("recalculates normalized annual metrics and decomposition acceptance", () => {
    const inconsistent = structuredClone(makeAnnualAudit(2025));
    const groups = inconsistent.groups as Array<{ rows: Array<{ kWhPerLandM2Year: number }> }>;
    groups[0].rows[0].kWhPerLandM2Year += 1;
    expect(() => validateAnnualAudit(inconsistent)).toThrow(/internally inconsistent/);

    const failedClosure = structuredClone(makeAnnualAudit(2025));
    const transient = failedClosure.transientDecompositionByShape as Record<string, { closureResidualWh: number }>;
    transient.plane.closureResidualWh = 1e-4;
    expect(() => validateAnnualAudit(failedClosure)).toThrow(/closure/);
  });

  it("fails closed on annual provenance, convergence, calendar, monthly, and ranking tampering", () => {
    type MutableAudit = {
      conditions: Record<string, unknown>;
      convergenceGate: {
        ideal: { comparisons: Array<{ relativeDifference: number }> };
        engineeringPass: boolean;
        engineeringOfficialRankingEligible: boolean;
      };
      groups: Array<{
        id: string;
        electricalModel: string;
        officialRankingEligible: boolean;
        rows: Array<{
          landAreaM2: number;
          activePvAreaM2: number;
          grossAcKWhYear: number;
          acKWhYear: number;
          kWhPerLandM2Year: number;
          kWhPerPvM2Year: number;
          representativeDayScaling: boolean;
          timeResolution: string;
          thermalModel: string;
          motorKWhYear: number;
        }>;
      }>;
      transientDecompositionByShape: Record<string, {
        monthly: Array<{ month: string; e00Wh: number }>;
      }>;
    };
    const mutations: Array<(audit: MutableAudit) => void> = [
      (audit) => { audit.conditions.configurationFingerprint = "not-a-sha256"; },
      (audit) => { audit.conditions.implementationFingerprint = "b".repeat(64); },
      (audit) => { audit.convergenceGate.ideal.comparisons[0].relativeDifference += 0.01; },
      (audit) => { audit.convergenceGate.engineeringPass = true; },
      (audit) => { audit.convergenceGate.engineeringOfficialRankingEligible = true; },
      (audit) => { audit.groups.find((group) => group.electricalModel === "explicit-series-parallel-bypass")!.officialRankingEligible = true; },
      (audit) => { audit.transientDecompositionByShape.plane.monthly[0].month = "2025-02"; },
      (audit) => { audit.transientDecompositionByShape.plane.monthly[0].e00Wh += 1; },
      (audit) => { audit.groups[0].rows[0].representativeDayScaling = true; },
      (audit) => { audit.groups[0].rows[0].thermalModel = "quasi-steady-faiman"; },
      (audit) => {
        const row = audit.groups[0].rows[0];
        row.acKWhYear = row.grossAcKWhYear + 1;
        row.kWhPerLandM2Year = row.acKWhYear / row.landAreaM2;
        row.kWhPerPvM2Year = row.acKWhYear / row.activePvAreaM2;
      },
      (audit) => {
        const row = audit.groups[0].rows[0];
        row.motorKWhYear = 0; row.acKWhYear -= 1;
        row.kWhPerLandM2Year = row.acKWhYear / row.landAreaM2;
        row.kWhPerPvM2Year = row.acKWhYear / row.activePvAreaM2;
      },
    ];
    for (const mutate of mutations) {
      const audit = structuredClone(makeAnnualAudit(2025)) as MutableAudit;
      mutate(audit);
      expect(() => validateAnnualAudit(audit)).toThrow();
    }

    const clippedIntervals = structuredClone(makeAnnualAudit(2025)) as MutableAudit;
    const clippedRow = clippedIntervals.groups.find((group) => group.id === "swept-held-static:explicit-series-parallel-bypass")!.rows[0];
    clippedRow.motorKWhYear = 2;
    clippedRow.acKWhYear = clippedRow.grossAcKWhYear - 1;
    clippedRow.kWhPerLandM2Year = clippedRow.acKWhYear / clippedRow.landAreaM2;
    clippedRow.kWhPerPvM2Year = clippedRow.acKWhYear / clippedRow.activePvAreaM2;
    expect(clippedRow.acKWhYear).toBeGreaterThan(clippedRow.grossAcKWhYear - clippedRow.motorKWhYear);
    expect(() => validateAnnualAudit(clippedIntervals)).not.toThrow();

    const clippedTransient = structuredClone(makeAnnualAudit(2025)) as MutableAudit & {
      transientDecompositionByShape: Record<string, {
        e11Wh: number; e11GrossWh: number; e11MotorWh: number;
        monthly: Array<{ month: string; e00Wh: number }>;
      }>;
    };
    clippedTransient.transientDecompositionByShape.plane.e11MotorWh += 1_000;
    expect(clippedTransient.transientDecompositionByShape.plane.e11Wh).toBeGreaterThan(
      clippedTransient.transientDecompositionByShape.plane.e11GrossWh
        - clippedTransient.transientDecompositionByShape.plane.e11MotorWh,
    );
    expect(() => validateAnnualAudit(clippedTransient)).not.toThrow();

    const invalidTransientMotor = structuredClone(makeAnnualAudit(2025)) as MutableAudit & {
      transientDecompositionByShape: Record<string, { e11Wh: number; e11GrossWh: number }>;
    };
    invalidTransientMotor.transientDecompositionByShape.plane.e11GrossWh =
      invalidTransientMotor.transientDecompositionByShape.plane.e11Wh - 1;
    expect(() => validateAnnualAudit(invalidTransientMotor)).toThrow(/aggregate motor-energy/);

    const transientMismatch = structuredClone(makeAnnualAudit(2025)) as MutableAudit;
    const transientGroups = transientMismatch.groups;
    const row = transientGroups.find((group) => group.id.startsWith("transient-swept-held-static:"))!.rows[0];
    row.grossAcKWhYear += 1;
    row.acKWhYear += 1;
    row.kWhPerLandM2Year = row.acKWhYear / row.landAreaM2;
    row.kWhPerPvM2Year = row.acKWhYear / row.activePvAreaM2;
    expect(() => validateAnnualAudit(transientMismatch)).toThrow(/disagrees with transient decomposition/);

    const leapClockMismatch = structuredClone(makeAnnualAudit(2024)) as MutableAudit;
    leapClockMismatch.groups[0].rows[0].timeResolution = "60 min; actual 8760 intervals + closing endpoint";
    expect(() => validateAnnualAudit(leapClockMismatch)).toThrow(/8784 intervals/);

    const root = mkdtempSync(join(tmpdir(), "solarform-annual-fingerprint-"));
    for (const [index, relativePath] of ANNUAL_IMPLEMENTATION_SOURCE_FILES.entries()) {
      const absolute = resolve(root, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `implementation-${index}\n`, "utf8");
    }
    const audit = makeAnnualAudit(2025) as MutableAudit;
    audit.conditions.implementationFingerprint = implementationFingerprint(root);
    expect(() => validateAnnualAudit(audit, root)).not.toThrow();
    writeFileSync(resolve(root, ANNUAL_IMPLEMENTATION_SOURCE_FILES[0]), "changed implementation\n", "utf8");
    expect(() => validateAnnualAudit(audit, root)).toThrow(/current source bytes/);
  });

  it("recalculates research metrics, policy, conditions, category counts, and sensitivity", () => {
    const audit = JSON.parse(readFileSync(
      resolve(process.cwd(), "docs/research-source-equivalent-audit.json"),
      "utf8",
    )) as Record<string, unknown>;
    expect(() => validateResearchAudit(audit)).not.toThrow();

    const wrongError = structuredClone(audit) as {
      studies: Array<{ metrics: Array<{ absoluteError: number }> }>;
    };
    wrongError.studies.find((study) => study.metrics.length > 0)!.metrics[0].absoluteError += 1;
    expect(() => validateResearchAudit(wrongError)).toThrow(/absoluteError/);

    const fitted = structuredClone(audit) as { policy: { calibrationFactors: boolean } };
    fitted.policy.calibrationFactors = true;
    expect(() => validateResearchAudit(fitted)).toThrow(/policy permits/);

    const missingCondition = structuredClone(audit) as { conditionMatrix: unknown[] };
    missingCondition.conditionMatrix.pop();
    expect(() => validateResearchAudit(missingCondition)).toThrow(/conditionMatrix/);

    const missingSensitivity = structuredClone(audit) as {
      studies: Array<{ verdict: string; sensitivity: unknown[] }>;
    };
    missingSensitivity.studies.find((study) => study.verdict === "pass")!.sensitivity = [];
    expect(() => validateResearchAudit(missingSensitivity)).toThrow(/sensitivity/);
  });

  it("resolves every required local Markdown link and fails when a target is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "solarform-report-links-"));
    const outputPath = "docs/generated-validation-report-2026.md";
    for (const [, href] of VALIDATION_REPORT_LOCAL_LINKS) {
      const target = resolve(root, dirname(outputPath), href);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "fixture\n", "utf8");
    }
    const markdown = renderValidationArtifactLinks().join("\n");
    expect(() => assertValidationReportLocalLinksExist(markdown, outputPath, root)).not.toThrow();
    const missingHref = VALIDATION_REPORT_LOCAL_LINKS[0][1];
    unlinkSync(resolve(root, dirname(outputPath), missingHref));
    expect(() => assertValidationReportLocalLinksExist(markdown, outputPath, root)).toThrow(/target is missing/);
  });
});
