import { writeFileSync } from "node:fs";
import { createServer } from "vite";
import type { ResearchBenchmarkResult } from "../src/lib/research/benchmarks";

async function main(): Promise<void> {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true },
  });
  try {
    const benchmarkModule = await vite.ssrLoadModule("/src/lib/research/benchmarks.ts");
    const { RESEARCH_CONDITION_MATRIX, runResearchReproductionAudit } = benchmarkModule as typeof import("../src/lib/research/benchmarks");

const jsonPath = process.argv[2] ?? "docs/research-source-equivalent-audit.json";
const markdownPath = process.argv[3] ?? "docs/research-source-equivalent-audit.md";
const studies = runResearchReproductionAudit();
const evaluated = studies.filter((study) => study.verdict !== "not-evaluated");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  policy: {
    sourceInputsOnly: true,
    missingInputsEstimated: false,
    calibrationFactors: false,
    shapeMultipliers: false,
    reportedOutputsUsedAsSolverTargets: false,
  },
  summary: {
    studyCount: studies.length,
    evaluatedCount: evaluated.length,
    passCount: evaluated.filter((study) => study.verdict === "pass").length,
    partialCount: evaluated.filter((study) => study.verdict === "partial").length,
    failCount: evaluated.filter((study) => study.verdict === "fail").length,
    notEvaluatedCount: studies.filter((study) => study.verdict === "not-evaluated").length,
    opticalGeometrySourceEquivalentCount: evaluated.filter((study) => study.studyId === "source:E").length,
    rotatingThermalSourceEquivalentCount: evaluated.filter((study) => study.studyId === "source:F").length,
  },
  conditionMatrix: RESEARCH_CONDITION_MATRIX,
  studies,
};

function cell(value: unknown): string {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function metricTable(study: ResearchBenchmarkResult): string {
  if (study.metrics.length === 0) return "No numerical run: required source inputs are missing, so this study remains `not-evaluated`.\n";
  return [
    "| Metric | Reported | Simulated | Absolute error | Relative error | Pre-registered tolerance | Verdict |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...study.metrics.map((metric) => (
      `| ${cell(metric.metric)} | ${metric.reportedValue.toPrecision(10)} ${cell(metric.unit)} | ${metric.simulatedValue.toPrecision(10)} | ${metric.absoluteError.toPrecision(6)} | ${metric.relativeErrorPercent.toFixed(6)}% | ${metric.tolerancePercent.toFixed(2)}% | ${metric.verdict} |`
    )),
    "",
  ].join("\n");
}

const markdown = [
  "# Primary-source-equivalent reproduction audit",
  "",
  `Generated at: ${report.generatedAt}`,
  "",
  "No coefficient or multiplier was reverse-fitted to a reported output. Fixtures contain only values confirmed in a primary source or author-maintained public code. Studies A-D lack required inputs and are excluded from successful reproductions.",
  "",
  "## Summary",
  "",
  `- Studies: ${report.summary.studyCount}`,
  `- Numerically evaluated: ${report.summary.evaluatedCount}`,
  `- pass / partial / fail / not-evaluated: ${report.summary.passCount} / ${report.summary.partialCount} / ${report.summary.failCount} / ${report.summary.notEvaluatedCount}`,
  "",
  "## Source condition matrix",
  "",
  "| Study | Geometry | Area basis | Source and spectrum | Incidence | Weather | Albedo and reflector | Thermal and convection | Electrical connection | Measured quantity |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...RESEARCH_CONDITION_MATRIX.map((row) => (
    `| ${cell(row.studyId)} | ${cell(row.geometry)} | ${cell(row.areaBasis)} | ${cell(row.sourceAndSpectrum)} | ${cell(row.incidence)} | ${cell(row.weather)} | ${cell(row.albedoAndReflector)} | ${cell(row.thermalAndConvection)} | ${cell(row.electricalConnection)} | ${cell(row.measuredQuantity)} |`
  )),
  "",
  "## Executed results",
  "",
  ...studies.flatMap((study) => [
    `### ${study.studyId}: ${study.title}`,
    "",
    `- Scope: ${study.scope}`,
    `- Reported result or trend: ${study.reportedTrend}`,
    `- Simulated result: ${study.simulationResult}`,
    `- Verdict: **${study.verdict}**`,
    `- Matched conditions: ${study.matchedConditions.join("; ")}`,
    `- Unmatched conditions: ${study.unmatchedConditions.join("; ")}`,
    `- Possible difference causes: ${study.possibleDifferenceCauses.join("; ")}`,
    "",
    metricTable(study),
  ]),
  "## Interpretation boundary",
  "",
  "Source E validates direct-beam geometry integration. Source F validates laminar rotational Reynolds and Nusselt calculations for a heated rotating disk. E is not a PV electrical or thermal validation; F is not a PV laminate or annual-energy validation. Inputs remain insufficient for full source-equivalent execution of studies A-D.",
  "",
].join("\n");

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, markdown);
console.log(JSON.stringify({
  jsonPath,
  markdownPath,
  ...report.summary,
}, null, 2));

  } finally {
    await vite.close();
  }
}

await main();
