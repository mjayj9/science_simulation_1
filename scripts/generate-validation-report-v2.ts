import { resolve } from "node:path";
import { atomicWriteUtf8, readJsonFile } from "./validation-io";
import {
  assertValidationAuditManifest,
  type ValidationAuditManifest,
} from "./validation-provenance";
import {
  assertValidationReportLocalLinksExist,
  renderValidationArtifactLinks,
  validateAnnualAudit,
  validateGeometryAudit,
  validateNaturalAudit,
  validateResearchAudit,
  validateThermalAudit,
  validateThermalComparisonAudit,
  type AnnualGroup,
  type AnnualResolution,
} from "./validation-report-contract";

const manifest = readJsonFile("docs/validation-audit-manifest-2026.json") as ValidationAuditManifest;
assertValidationAuditManifest(manifest);

// Parse and validate every machine-readable input before rendering any output.
// A missing field, failed acceptance gate, non-finite value, or stale manifest
// aborts here and leaves the previous Markdown report untouched.
const annual = validateAnnualAudit(readJsonFile("docs/full-year-comparison-audit-2026.json"));
const geometry = validateGeometryAudit(readJsonFile("docs/fair-geometry-audit-2026.json"));
const natural = validateNaturalAudit(readJsonFile("docs/natural-rotation-audit-2026.json"));
const thermal = validateThermalAudit(readJsonFile("docs/annual-transient-audit-2026.json"));
const thermalCompare = validateThermalComparisonAudit(readJsonFile("docs/thermal-model-comparison-audit-2026.json"));
const research = validateResearchAudit(readJsonFile("docs/research-source-equivalent-audit.json"));

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

function groupFamily(group: AnnualGroup): string {
  const suffix = `:${group.electricalModel}`;
  if (!group.id.endsWith(suffix)) throw new Error(`Annual group id/model mismatch: ${group.id}`);
  return group.id.slice(0, -suffix.length);
}

function formatResolution(value: AnnualResolution): string {
  return `azimuth=${value.azimuthSamples}, meridional=${value.meridionalSegments}, phase=${value.phaseSamples}, circuit=${value.circuitSamples}`;
}

type ExtendedConvergence = {
  shape: string;
  electricalModel: string;
  selectedResolution: AnnualResolution;
  referenceResolution: AnnualResolution;
  selectedWh: number;
  referenceWh: number;
  selectedSampleCount: number;
  referenceSampleCount: number;
  relativeDifference: number;
  tolerance: number;
  pass: boolean;
  fixture: string;
  dayOffsets: number[];
  elapsedMs: number;
};

const extendedEngineering = annual.convergenceGate.engineering.extendedCylinder as ExtendedConvergence;
const engineeringAnnualResolution = formatResolution(annual.convergenceGate.lowResolution);

const lines: string[] = [
  "# Generated engineering validation report",
  "",
  "> Every numeric table below is rendered from schema-checked audit JSON. The report is written atomically only after its SHA-256 manifest and local links pass verification.",
  "",
  "## Scope and calculation contracts",
  "",
  `- Fair geometry: ${geometry.rows.length}/${geometry.rows.length} cases passed instantaneous projection, swept occupation, and installed-world-height checks.`,
  `- Annual comparison: ${String(annual.conditions.intervals)} actual hourly intervals plus one closing endpoint; no representative-day scaling.`,
  `- Official ideal local-MPP convergence: ${annual.convergenceGate.officialIdealPass ? "PASS" : "FAIL"}.`,
  `- Engineering connection convergence: ${annual.convergenceGate.engineeringRankingVerdict.toUpperCase()}; official ranking eligible = ${annual.convergenceGate.engineeringOfficialRankingEligible ? "yes" : "no"}. Reason: ${markdownCell(annual.convergenceGate.engineeringReason)}`,
  `- Overall dual-model convergence gate: ${annual.convergenceGate.pass ? "PASS" : "FAIL"}; this does not invalidate the separately passing official ideal upper-bound result.`,
  `- Engineering annual values are exploratory calculations at the audit low resolution (${engineeringAnnualResolution}). The extended cylinder evidence uses ${formatResolution(extendedEngineering.selectedResolution)} versus ${formatResolution(extendedEngineering.referenceResolution)} and remains ${extendedEngineering.pass ? "PASS" : "FAIL"}; it is not the annual-row resolution.`,
  "- Wind-generated electricity is excluded. Active-motor demand is deducted from inverter AC and net generation is clipped at zero.",
  "- Ideal local-MPP integration is an upper bound; explicit series/parallel/bypass wiring is reported as a separate engineering model.",
  "- Natural rotation with no source-backed C_Q starts at and remains at exactly 0 RPM. User-C_Q auxiliary-rotor sensitivity is excluded from official ranks when full footprint, height, and shadow accounting is absent.",
  "",
  "## Convergence evidence",
  "",
  "| Model gate | Shape | Low Wh | High Wh | Relative difference | Tolerance | Verdict |",
  "|---|---|---:|---:|---:|---:|---|",
  ...annual.convergenceGate.ideal.comparisons.map((entry) => `| Official ideal | ${entry.shape} | ${entry.lowWh.toFixed(6)} | ${entry.highWh.toFixed(6)} | ${(100 * entry.relativeDifference).toFixed(6)}% | ${(100 * entry.tolerance).toFixed(6)}% | ${entry.pass ? "pass" : "fail"} |`),
  ...annual.convergenceGate.engineering.comparisons.map((entry) => `| Engineering preliminary | ${entry.shape} | ${entry.lowWh.toFixed(6)} | ${entry.highWh.toFixed(6)} | ${(100 * entry.relativeDifference).toFixed(6)}% | ${(100 * entry.tolerance).toFixed(6)}% | ${entry.pass ? "pass" : "fail"} |`),
  "",
  "| Engineering extended fixture | Selected resolution | Reference resolution | Selected Wh | Reference Wh | Selected samples | Reference samples | Relative difference | Tolerance | Verdict | Day offsets | Elapsed ms |",
  "|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|",
  `| ${markdownCell(extendedEngineering.fixture)} | ${formatResolution(extendedEngineering.selectedResolution)} | ${formatResolution(extendedEngineering.referenceResolution)} | ${extendedEngineering.selectedWh.toFixed(6)} | ${extendedEngineering.referenceWh.toFixed(6)} | ${extendedEngineering.selectedSampleCount} | ${extendedEngineering.referenceSampleCount} | ${(100 * extendedEngineering.relativeDifference).toFixed(6)}% | ${(100 * extendedEngineering.tolerance).toFixed(6)}% | ${extendedEngineering.pass ? "pass" : "fail"} | ${extendedEngineering.dayOffsets.join(", ")} | ${extendedEngineering.elapsedMs.toFixed(3)} |`,
  "",
  "## Actual full-year comparison groups",
  "",
];

for (const group of annual.groups) {
  const orderLabel = group.officialRankingEligible ? "Rank" : "Exploratory order (not an official rank)";
  lines.push(
    `### ${markdownCell(group.id)}`,
    "",
    markdownCell(group.comparisonMeaning),
    "",
    `Official ranking eligible: ${group.officialRankingEligible ? "yes" : "no"}; verdict: ${group.rankingVerdict}; calculation resolution: ${markdownCell(group.calculationResolution)}.`,
    "",
    `| ${orderLabel} | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |`,
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|",
    ...group.rows.map((row, index) => `| ${index + 1} | ${row.shape} | ${row.landAreaM2.toFixed(4)} | ${row.activePvAreaM2.toFixed(4)} | ${row.pvLandRatio.toFixed(3)} | ${row.grossAcKWhYear.toFixed(6)} | ${row.motorKWhYear.toFixed(6)} | ${row.acKWhYear.toFixed(6)} | ${row.kWhPerLandM2Year.toFixed(6)} | ${row.kWhPerPvM2Year.toFixed(6)} | ${markdownCell(row.electricalModel)} | ${markdownCell(row.thermalModel)} | ${markdownCell(row.geometryContract)} | ${markdownCell(row.rotationModel)} | ${markdownCell(row.weatherSource)}; ${markdownCell(row.timeResolution)} |`),
    "",
  );
}

lines.push(
  "## Ideal local-MPP upper bound versus engineering connection",
  "",
  "Only groups with the same geometry, rotation, thermal, weather, and time contracts are paired. Engineering values and their order remain exploratory because the engineering convergence gate failed; they are not official ranks.",
  "",
  "| Comparison family | Shape | Ideal AC kWh/y | Engineering AC kWh/y | Engineering - ideal |",
  "|---|---|---:|---:|---:|",
);
for (const ideal of annual.groups.filter((group) => group.electricalModel === "local-mpp-area-integral")) {
  const family = groupFamily(ideal);
  const engineering = annual.groups.find((group) => groupFamily(group) === family
    && group.electricalModel === "explicit-series-parallel-bypass"
    && group.geometryContract === ideal.geometryContract
    && group.rotationMode === ideal.rotationMode
    && group.thermalModel === ideal.thermalModel);
  if (!engineering) continue;
  for (const idealRow of ideal.rows) {
    const engineeringRow = engineering.rows.find((row) => row.shape === idealRow.shape);
    if (!engineeringRow) throw new Error(`${family} is missing engineering row ${idealRow.shape}.`);
    const percent = idealRow.acKWhYear > 0
      ? 100 * (engineeringRow.acKWhYear - idealRow.acKWhYear) / idealRow.acKWhYear
      : engineeringRow.acKWhYear === 0 ? 0 : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(percent)) throw new Error(`${family}/${idealRow.shape} has an undefined electrical-model comparison.`);
    lines.push(`| ${family} | ${idealRow.shape} | ${idealRow.acKWhYear.toFixed(6)} | ${engineeringRow.acKWhYear.toFixed(6)} | ${percent.toFixed(6)}% |`);
  }
}

lines.push(
  "",
  "## Shape-specific annual transient E00/E10/E01/E11",
  "",
  "| Shape | E00 Wh | E10 Wh | E01 Wh | E11 Wh | Optical Wh | Thermal Wh | Interaction Wh | Net Wh | Closure Wh | Heat residual | Warm-up |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ...Object.entries(annual.transientDecompositionByShape).map(([shape, entry]) => {
    const optical = entry.e10Wh - entry.e00Wh;
    const thermalContribution = entry.e01Wh - entry.e00Wh;
    const interaction = entry.e11Wh - entry.e10Wh - entry.e01Wh + entry.e00Wh;
    const net = entry.e11Wh - entry.e00Wh;
    return `| ${shape} | ${entry.e00Wh.toFixed(6)} | ${entry.e10Wh.toFixed(6)} | ${entry.e01Wh.toFixed(6)} | ${entry.e11Wh.toFixed(6)} | ${optical.toFixed(6)} | ${thermalContribution.toFixed(6)} | ${interaction.toExponential(6)} | ${net.toFixed(6)} | ${entry.closureResidualWh.toExponential(3)} | ${entry.heatResidualFraction.toExponential(3)} | ${entry.warmupConverged ? "pass" : "fail"} |`;
  }),
  "",
  "## Monthly transient decomposition by shape",
  "",
  "| Shape | Month | E00 Wh | E10 Wh | E01 Wh | E11 Wh | Optical Wh | Thermal Wh | Interaction Wh | Net Wh | Closure Wh |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...Object.entries(annual.transientDecompositionByShape).flatMap(([shape, entry]) => entry.monthly.map((month) => `| ${shape} | ${month.month} | ${month.e00Wh.toFixed(6)} | ${month.e10Wh.toFixed(6)} | ${month.e01Wh.toFixed(6)} | ${month.e11Wh.toFixed(6)} | ${month.opticalWh.toFixed(6)} | ${month.thermalWh.toFixed(6)} | ${month.interactionWh.toExponential(6)} | ${month.netWh.toFixed(6)} | ${month.closureResidualWh.toExponential(3)} |`)),
  "",
  "## Independent annual transient thermal audit",
  "",
  `Coverage: ${thermal.coverage.steps} boundaries, ${thermal.coverage.intervals} intervals, ${thermal.coverage.durationHours} h.`,
  "",
  "| E00 Wh | E10 Wh | E01 Wh | E11 Wh | Optical Wh | Thermal Wh | Interaction Wh | Net Wh | Closure residual Wh |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  `| ${thermal.annualEnergyWh.e00Wh.toFixed(6)} | ${thermal.annualEnergyWh.e10Wh.toFixed(6)} | ${thermal.annualEnergyWh.e01Wh.toFixed(6)} | ${thermal.annualEnergyWh.e11Wh.toFixed(6)} | ${thermal.annualEnergyWh.opticalWh.toFixed(6)} | ${thermal.annualEnergyWh.thermalWh.toFixed(9)} | ${thermal.annualEnergyWh.interactionWh.toExponential(6)} | ${thermal.annualEnergyWh.netWh.toFixed(6)} | ${thermal.annualEnergyWh.closureResidualWh.toExponential(3)} |`,
  "",
  `Heat-ledger relative residual: ${thermal.energyAudit.relativeEnergyResidual.toExponential(6)}. Reduced thermal-mesh convergence: ${thermal.meshConvergence14Day.converged ? "pass" : "fail"}.`,
  "",
  "## Quasi-steady versus transient thermal result",
  "",
  "| Rotation | Quasi-steady AC Wh | Transient AC Wh | Difference Wh | Difference |",
  "|---|---:|---:|---:|---:|",
  `| Static | ${thermalCompare.quasiSteady.staticAcEnergyWh.toFixed(6)} | ${thermalCompare.transient.staticAcEnergyWh.toFixed(6)} | ${thermalCompare.differences.staticTransientMinusQuasiWh.toFixed(6)} | ${thermalCompare.differences.staticTransientMinusQuasiPercent.toFixed(6)}% |`,
  `| Controlled RPM | ${thermalCompare.quasiSteady.rotatingAcEnergyWh.toFixed(6)} | ${thermalCompare.transient.rotatingAcEnergyWh.toFixed(6)} | ${thermalCompare.differences.rotatingTransientMinusQuasiWh.toFixed(6)} | ${thermalCompare.differences.rotatingTransientMinusQuasiPercent.toFixed(6)}% |`,
  "",
  "## Shape-specific natural RPM",
  "",
  "| Shape | Official no-C_Q RPM | Confidence | Official eligible | Unverified user-C_Q RPM | Sensitivity eligible |",
  "|---|---:|---|---|---:|---|",
  ...natural.officialNoCq.map((row) => {
    const sensitivity = natural.unverifiedUserCqSensitivity.find((candidate) => candidate.shape === row.shape);
    if (!sensitivity) throw new Error(`Natural sensitivity is missing shape ${row.shape}.`);
    return `| ${row.shape} | ${row.annualTimeWeightedMeanRpm.toFixed(6)} | ${row.confidence} | ${row.officialComparisonEligible ? "yes" : "no"} | ${sensitivity.annualTimeWeightedMeanRpm.toFixed(6)} | ${sensitivity.officialComparisonEligible ? "yes" : `no (${markdownCell(sensitivity.exclusionReasons.join(", "))})`} |`;
  }),
  "",
  "## Primary-source reproduction audit",
  "",
  `Evaluated ${research.summary.evaluatedCount}/${research.summary.studyCount}; pass ${research.summary.passCount}, partial ${research.summary.partialCount}, fail ${research.summary.failCount}, not-evaluated ${research.summary.notEvaluatedCount}.`,
  "",
  "Input policy: source inputs only; missing values were not estimated; no calibration factors, shape multipliers, or reported-output solver targets were permitted.",
  "",
  "### Source-equivalent condition matrix",
  "",
  "| Study | Geometry | Area basis | Source/spectrum | Incidence | Weather | Albedo/reflector | Thermal/convection | Electrical connection | Measured quantity | Primary sources |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...research.conditionMatrix.map((condition) => `| ${condition.studyId}: ${markdownCell(condition.title)} | ${markdownCell(condition.geometry)} | ${markdownCell(condition.areaBasis)} | ${markdownCell(condition.sourceAndSpectrum)} | ${markdownCell(condition.incidence)} | ${markdownCell(condition.weather)} | ${markdownCell(condition.albedoAndReflector)} | ${markdownCell(condition.thermalAndConvection)} | ${markdownCell(condition.electricalConnection)} | ${markdownCell(condition.measuredQuantity)} | ${condition.primarySourceUrls.map((url, index) => `[${index + 1}](${url})`).join(" ")} |`),
  "",
  "### Study verdicts and condition matching",
  "",
  "| Study | Verdict | Reported value/trend | Simulation result | Conditions matched | Conditions not matched | Primary sources |",
  "|---|---|---|---|---|---|---|",
  ...research.studies.map((study) => `| ${study.studyId}: ${markdownCell(study.title)} | ${study.verdict} | ${markdownCell(study.reportedTrend)} | ${markdownCell(study.simulationResult)} | ${markdownCell(study.matchedConditions.join("; ") || "none")} | ${markdownCell(study.unmatchedConditions.join("; ") || "none")} | ${study.primarySourceUrls.map((url, index) => `[${index + 1}](${url})`).join(" ")} |`),
  "",
  "### Numeric benchmark metrics",
  "",
  "| Study | Verdict | Metric | Reported | Simulated | Absolute error | Relative error | Tolerance | Tolerance basis | Metric verdict |",
  "|---|---|---|---:|---:|---:|---:|---:|---|---|",
  ...research.studies.flatMap((study) => study.metrics.length > 0
    ? study.metrics.map((metric) => `| ${study.studyId} | ${study.verdict} | ${markdownCell(metric.metric)} (${markdownCell(metric.unit)}) | ${metric.reportedValue.toFixed(9)} | ${metric.simulatedValue.toFixed(9)} | ${metric.absoluteError.toFixed(9)} | ${metric.relativeErrorPercent.toFixed(6)}% | ${metric.tolerancePercent.toFixed(3)}% | ${markdownCell(metric.toleranceBasis)} | ${metric.verdict} |`)
    : [`| ${study.studyId} | ${study.verdict} | insufficient source-equivalent inputs | ?? | ?? | ?? | ?? | ?? | not evaluated | not-evaluated |`]),
  "",
  "### Difference causes and sensitivity",
  "",
  "| Study | Possible difference causes |",
  "|---|---|",
  ...research.studies.map((study) => `| ${study.studyId} | ${markdownCell(study.possibleDifferenceCauses.join("; "))} |`),
  "",
  "| Study | Parameter | Lower case/value | Baseline case/value | Upper case/value | Unit |",
  "|---|---|---|---|---|---|",
  ...research.studies.flatMap((study) => study.sensitivity.length > 0
    ? study.sensitivity.map((item) => `| ${study.studyId} | ${markdownCell(item.parameter)} | ${markdownCell(item.lowerCase)}: ${item.lowerValue.toFixed(9)} | ${markdownCell(item.baselineCase)}: ${item.baselineValue.toFixed(9)} | ${markdownCell(item.upperCase)}: ${item.upperValue.toFixed(9)} | ${markdownCell(item.unit)} |`)
    : [`| ${study.studyId} | not evaluated | ?? | ?? | ?? | ?? |`]),
  "",
  "## Interpretation boundaries",
  "",
  "- Source E validates direct-beam convex-sphere geometry, not PV electrical or thermal behavior.",
  "- Source F validates a heated aluminium rotating-disk Reynolds/Nusselt calculation, not an annual PV laminate model.",
  "- A-D remain not-evaluated and are excluded from the validation-success count.",
  "- The engineering connection uses equal-density cells, strings, bypass substrings, and wiring resistance, but remains a configurable topology rather than a manufacturer-specific module layout.",
  "- The offline annual weather fixture is deterministic model-estimate data, not measured Seoul TMY. Rankings apply only to the stated inputs.",
  "- Annual transient + explicit engineering circuit is unsupported and is not silently presented as a combined result.",
  "",
  ...renderValidationArtifactLinks(),
  "## Provenance",
  "",
  `- Manifest generated: ${manifest.generatedAt}`,
  `- Source-set SHA-256: \`${manifest.sourceSetSha256}\``,
  `- Audit-set SHA-256: \`${manifest.auditSetSha256}\``,
  `- Hashed source files: ${Object.keys(manifest.sourceFiles).length}; hashed audit JSON files: ${Object.keys(manifest.auditFiles).length}.`,
  "",
);

const outputPath = process.argv[3] ?? "docs/generated-validation-report-2026.md";
const markdown = `${lines.join("\n").trimEnd()}\n`;
assertValidationReportLocalLinksExist(markdown, outputPath);
atomicWriteUtf8(resolve(outputPath), markdown);
console.log(JSON.stringify({
  outputPath,
  annualGroupCount: annual.groups.length,
  researchSummary: research.summary,
  sourceSetSha256: manifest.sourceSetSha256,
  auditSetSha256: manifest.auditSetSha256,
}));
