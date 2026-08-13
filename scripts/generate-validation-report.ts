import { readFileSync, writeFileSync } from "node:fs";

type AnnualRow = {
  shape: string;
  landAreaM2: number;
  heightM: number;
  activePvAreaM2: number;
  pvLandRatio: number;
  acKWhYear: number;
  kWhPerLandM2Year: number;
  kWhPerPvM2Year: number;
  electricalModel: string;
  thermalModel: string;
  rotationModel: string;
  weatherSource: string;
  timeResolution: string;
};
type AnnualGroup = { rotationMode: string; electricalModel: string; rows: AnnualRow[] };
type ResearchMetric = {
  metric: string; unit: string; reportedValue: number; simulatedValue: number;
  absoluteError: number; relativeErrorPercent: number; tolerancePercent: number; verdict: string;
};

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const annual = read<{ conditions: Record<string, unknown>; groups: AnnualGroup[] }>(
  "docs/full-year-comparison-audit-2026.json",
);
const geometry = read<{ rows: Array<{ projectionPass: boolean; heightPass: boolean }> }>(
  "docs/fair-geometry-audit-2026.json",
);
const natural = read<{
  conditions: Record<string, unknown>;
  officialNoCq: Array<{ shape: string; annualTimeWeightedMeanRpm: number; confidence: string; officialComparisonEligible: boolean }>;
  unverifiedUserCqSensitivity: Array<{ shape: string; annualTimeWeightedMeanRpm: number; confidence: string; officialComparisonEligible: boolean; exclusionReasons: string[] }>;
}>("docs/natural-rotation-audit-2026.json");
const thermal = read<{
  coverage: { steps: number; intervals: number; durationHours: number };
  annualEnergyWh: { e00Wh: number; e10Wh: number; e01Wh: number; e11Wh: number; opticalWh: number; thermalWh: number; interactionWh: number; netWh: number; closureResidualWh: number };
  temperature: Record<string, number>;
  energyAudit: { relativeEnergyResidual: number };
  meshConvergence14Day: { converged: boolean; points: Array<Record<string, number>> };
}>("docs/annual-transient-audit-2026.json");
const thermalCompare = read<{
  quasiSteady: { staticAcEnergyWh: number; rotatingAcEnergyWh: number };
  transient: { staticAcEnergyWh: number; rotatingAcEnergyWh: number };
  differences: Record<string, number>;
}>("docs/thermal-model-comparison-audit-2026.json");
const research = read<{
  summary: Record<string, number>;
  studies: Array<{
    studyId: string; title: string; verdict: string; reportedTrend: string; simulationResult: string;
    metrics: ResearchMetric[]; matchedConditions: string[]; unmatchedConditions: string[];
  }>;
}>("docs/research-source-equivalent-audit.json");

const lines: string[] = [
  "# Generated engineering validation report",
  "",
  "> Numeric tables in this document are generated from the audit JSON files. Do not edit values by hand.",
  "",
  "## Scope and calculation contracts",
  "",
  `- Fair geometry: ${geometry.rows.filter((row) => row.projectionPass && row.heightPass).length}/${geometry.rows.length} projection-and-height cases passed.`,
  `- Annual comparison: ${String(annual.conditions.intervals)} actual hourly intervals plus the closing endpoint; no representative-day scaling.`,
  "- Wind-generated electricity is excluded. Motor electricity, where configured, is a load on inverter AC.",
  "- Natural rotation with no source-backed C_Q starts at and remains at 0 RPM. User-C_Q auxiliary-rotor sensitivities are excluded when footprint, height, or shadow accounting is missing.",
  "",
  "## Actual full-year rankings",
  "",
];
for (const group of annual.groups) {
  lines.push(
    `### ${group.rotationMode} / ${group.electricalModel}`,
    "",
    "| Rank | Shape | A_land | A_PV | A_PV/A_land | AC kWh/year | kWh/m2-land/year | kWh/m2-PV/year | Electrical | Thermal | Rotation | Weather/time |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|---|",
    ...group.rows.map((row, index) => `| ${index + 1} | ${row.shape} | ${row.landAreaM2.toFixed(4)} | ${row.activePvAreaM2.toFixed(4)} | ${row.pvLandRatio.toFixed(3)} | ${row.acKWhYear.toFixed(6)} | ${row.kWhPerLandM2Year.toFixed(6)} | ${row.kWhPerPvM2Year.toFixed(6)} | ${row.electricalModel} | ${row.thermalModel} | ${row.rotationModel} | ${row.weatherSource}; ${row.timeResolution} |`),
    "",
  );
}

lines.push(
  "## Ideal local-MPP upper bound versus engineering connection",
  "",
  "| Rotation | Shape | Ideal AC kWh | Engineering AC kWh | Engineering - ideal |",
  "|---|---|---:|---:|---:|",
);
for (const rotationMode of [...new Set(annual.groups.map((group) => group.rotationMode))]) {
  const ideal = annual.groups.find((group) => group.rotationMode === rotationMode && group.electricalModel === "local-mpp-area-integral");
  const engineering = annual.groups.find((group) => group.rotationMode === rotationMode && group.electricalModel === "explicit-series-parallel-bypass");
  if (!ideal || !engineering) continue;
  for (const idealRow of ideal.rows) {
    const engineeringRow = engineering.rows.find((row) => row.shape === idealRow.shape);
    if (!engineeringRow) continue;
    const percent = idealRow.acKWhYear > 0
      ? 100 * (engineeringRow.acKWhYear - idealRow.acKWhYear) / idealRow.acKWhYear
      : 0;
    lines.push(`| ${rotationMode} | ${idealRow.shape} | ${idealRow.acKWhYear.toFixed(6)} | ${engineeringRow.acKWhYear.toFixed(6)} | ${percent.toFixed(6)}% |`);
  }
}

lines.push(
  "",
  "## Annual transient E00/E10/E01/E11",
  "",
  `Coverage: ${thermal.coverage.steps} boundaries, ${thermal.coverage.intervals} intervals, ${thermal.coverage.durationHours} h.`,
  "",
  "| E00 | E10 | E01 | E11 | Optical | Thermal | Interaction | Net | Closure residual |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  `| ${thermal.annualEnergyWh.e00Wh.toFixed(6)} | ${thermal.annualEnergyWh.e10Wh.toFixed(6)} | ${thermal.annualEnergyWh.e01Wh.toFixed(6)} | ${thermal.annualEnergyWh.e11Wh.toFixed(6)} | ${thermal.annualEnergyWh.opticalWh.toFixed(6)} | ${thermal.annualEnergyWh.thermalWh.toFixed(9)} | ${thermal.annualEnergyWh.interactionWh.toExponential(6)} | ${thermal.annualEnergyWh.netWh.toFixed(6)} | ${thermal.annualEnergyWh.closureResidualWh.toExponential(3)} |`,
  "",
  `Heat-ledger relative residual: ${thermal.energyAudit.relativeEnergyResidual.toExponential(6)}. Reduced thermal mesh convergence: ${thermal.meshConvergence14Day.converged ? "pass" : "fail"}.`,
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
    const sensitivity = natural.unverifiedUserCqSensitivity.find((candidate) => candidate.shape === row.shape)!;
    return `| ${row.shape} | ${row.annualTimeWeightedMeanRpm.toFixed(6)} | ${row.confidence} | ${row.officialComparisonEligible ? "yes" : "no"} | ${sensitivity.annualTimeWeightedMeanRpm.toFixed(6)} | ${sensitivity.officialComparisonEligible ? "yes" : `no (${sensitivity.exclusionReasons.join(", ")})`} |`;
  }),
  "",
  "## Primary-source reproduction audit",
  "",
  `Evaluated ${research.summary.evaluatedCount}/${research.summary.studyCount}; pass ${research.summary.passCount}, partial ${research.summary.partialCount}, fail ${research.summary.failCount}, not-evaluated ${research.summary.notEvaluatedCount}.`,
  "",
  "| Study | Verdict | Metric | Reported | Simulated | Absolute error | Relative error | Tolerance |",
  "|---|---|---|---:|---:|---:|---:|---:|",
  ...research.studies.flatMap((study) => study.metrics.length
    ? study.metrics.map((metric) => `| ${study.studyId} | ${study.verdict} | ${metric.metric} (${metric.unit}) | ${metric.reportedValue.toFixed(9)} | ${metric.simulatedValue.toFixed(9)} | ${metric.absoluteError.toFixed(9)} | ${metric.relativeErrorPercent.toFixed(6)}% | ${metric.tolerancePercent.toFixed(3)}% |`)
    : [`| ${study.studyId} | ${study.verdict} | insufficient source-equivalent inputs | — | — | — | — | — |`]),
  "",
  "## Interpretation boundaries",
  "",
  "- Source E validates direct-beam convex-sphere geometry, not PV electrical or thermal behavior.",
  "- Source F validates a heated aluminium rotating-disk Reynolds/Nusselt calculation, not an annual PV laminate model.",
  "- A-D remain not-evaluated and are excluded from the validation-success count.",
  "- The engineering connection uses explicit equal-density cells, strings, bypass substrings, and wiring resistance, but it is still a configurable topology rather than a manufacturer-specific module layout.",
  "- The offline annual weather fixture is deterministic model-estimate data, not measured Seoul TMY. Rankings apply only to the stated inputs.",
  "",
);
const outputPath = process.argv[2] ?? "docs/generated-validation-report-2026.md";
writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({ outputPath, annualGroupCount: annual.groups.length, researchSummary: research.summary }));
