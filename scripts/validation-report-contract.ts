import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export const VALIDATION_SHAPES = Object.freeze([
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
] as const);
export type ValidationShape = (typeof VALIDATION_SHAPES)[number];

export type AnnualRow = {
  shape: ValidationShape;
  landAreaM2: number;
  heightM: number;
  activePvAreaM2: number;
  pvLandRatio: number;
  grossAcKWhYear: number;
  motorKWhYear: number;
  acKWhYear: number;
  kWhPerLandM2Year: number;
  kWhPerPvM2Year: number;
  electricalModel: string;
  thermalModel: string;
  geometryContract: string;
  rotationModel: string;
  weatherSource: string;
  timeResolution: string;
  selectedFootprintM2: number;
  representativeDayScaling: false;
  requestFingerprint: string;
};

export type AnnualGroup = {
  id: string;
  comparisonMeaning: string;
  geometryContract: string;
  rotationMode: string;
  electricalModel: string;
  thermalModel: string;
  officialRankingEligible: boolean;
  rankingVerdict: "pass" | "not-evaluated";
  calculationResolution: string;
  rows: AnnualRow[];
};

export type AnnualResolution = {
  azimuthSamples: number;
  meridionalSegments: number;
  phaseSamples: number;
  circuitSamples: number;
};

export type AnnualConvergenceComparison = {
  shape: ValidationShape;
  electricalModel: string;
  lowWh: number;
  highWh: number;
  relativeDifference: number;
  tolerance: number;
  pass: boolean;
};

export type AnnualTransientMonth = {
  month: string;
  e00Wh: number;
  e10Wh: number;
  e01Wh: number;
  e11Wh: number;
  opticalWh: number;
  thermalWh: number;
  interactionWh: number;
  netWh: number;
  closureResidualWh: number;
};

export type AnnualAudit = {
  schemaVersion: 2;
  generatedAt: string;
  conditions: Record<string, unknown> & {
    year: number;
    weatherPoints: number;
    intervals: number;
    durationHours: number;
    integration: string;
    configurationFingerprint: string;
    implementationFingerprint: string;
    implementationSourceFiles: string[];
  };
  convergenceGate: {
    pass: boolean;
    officialIdealPass: boolean;
    engineeringPass: boolean;
    engineeringOfficialRankingEligible: boolean;
    engineeringRankingVerdict: "not-evaluated";
    engineeringReason: string;
    lowResolution: AnnualResolution;
    highResolution: AnnualResolution;
    ideal: { pass: boolean; comparisons: AnnualConvergenceComparison[] };
    engineering: {
      pass: boolean;
      comparisons: AnnualConvergenceComparison[];
      extendedCylinder: Record<string, unknown>;
      tolerance: number;
      status: "not-evaluated";
      officialRankingEligible: false;
    };
  };
  groups: AnnualGroup[];
  transientDecompositionByShape: Record<string, {
    e00Wh: number;
    e10Wh: number;
    e01Wh: number;
    e11Wh: number;
    e00GrossWh: number;
    e11GrossWh: number;
    e11MotorWh: number;
    closureResidualWh: number;
    heatResidualFraction: number;
    warmupConverged: boolean;
    monthly: AnnualTransientMonth[];
  }>;
};

export type ResearchMetric = {
  metric: string;
  unit: string;
  reportedValue: number;
  simulatedValue: number;
  absoluteError: number;
  relativeErrorPercent: number;
  tolerancePercent: number;
  toleranceBasis: string;
  verdict: "pass" | "fail";
};

export type ResearchSensitivity = {
  parameter: string;
  lowerCase: string;
  lowerValue: number;
  baselineCase: string;
  baselineValue: number;
  upperCase: string;
  upperValue: number;
  unit: string;
};

export type ResearchCondition = {
  studyId: string;
  title: string;
  geometry: string;
  areaBasis: string;
  sourceAndSpectrum: string;
  incidence: string;
  weather: string;
  albedoAndReflector: string;
  thermalAndConvection: string;
  electricalConnection: string;
  measuredQuantity: string;
  primarySourceUrls: string[];
};

export type ResearchAudit = {
  schemaVersion: 1;
  generatedAt: string;
  policy: {
    sourceInputsOnly: true;
    missingInputsEstimated: false;
    calibrationFactors: false;
    shapeMultipliers: false;
    reportedOutputsUsedAsSolverTargets: false;
  };
  summary: Record<string, number> & {
    studyCount: number;
    evaluatedCount: number;
    passCount: number;
    partialCount: number;
    failCount: number;
    notEvaluatedCount: number;
  };
  conditionMatrix: ResearchCondition[];
  studies: Array<{
    benchmarkId: string;
    studyId: string;
    title: string;
    scope: string;
    verdict: "pass" | "partial" | "fail" | "not-evaluated";
    reportedTrend: string;
    simulationResult: string;
    metrics: ResearchMetric[];
    matchedConditions: string[];
    unmatchedConditions: string[];
    possibleDifferenceCauses: string[];
    sensitivity: ResearchSensitivity[];
    primarySourceUrls: string[];
  }>;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be boolean.`);
  return value;
}

function sha256(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return result;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) => text(entry, `${path}[${index}]`));
}

function timestamp(value: unknown, path: string): string {
  const result = text(value, path);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${path} is not an ISO timestamp.`);
  return result;
}

function close(actual: number, expected: number, tolerance = 1e-8): boolean {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

function expectCompleteShapeSet(values: readonly string[], path: string): void {
  if (values.length !== VALIDATION_SHAPES.length
    || new Set(values).size !== VALIDATION_SHAPES.length
    || VALIDATION_SHAPES.some((shape) => !values.includes(shape))) {
    throw new Error(`${path} must contain each of the six comparison shapes exactly once.`);
  }
}

function calendarHours(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000;
}

function annualRow(value: unknown, path: string, expectedHours: number): AnnualRow {
  const source = record(value, path);
  const shape = text(source.shape, `${path}.shape`);
  if (!(VALIDATION_SHAPES as readonly string[]).includes(shape)) {
    throw new TypeError(`${path}.shape is unsupported: ${shape}`);
  }
  const result: AnnualRow = {
    shape: shape as ValidationShape,
    landAreaM2: finite(source.landAreaM2, `${path}.landAreaM2`),
    heightM: finite(source.heightM, `${path}.heightM`),
    activePvAreaM2: finite(source.activePvAreaM2, `${path}.activePvAreaM2`),
    pvLandRatio: finite(source.pvLandRatio, `${path}.pvLandRatio`),
    grossAcKWhYear: finite(source.grossAcKWhYear, `${path}.grossAcKWhYear`),
    motorKWhYear: finite(source.motorKWhYear, `${path}.motorKWhYear`),
    acKWhYear: finite(source.acKWhYear, `${path}.acKWhYear`),
    kWhPerLandM2Year: finite(source.kWhPerLandM2Year, `${path}.kWhPerLandM2Year`),
    kWhPerPvM2Year: finite(source.kWhPerPvM2Year, `${path}.kWhPerPvM2Year`),
    electricalModel: text(source.electricalModel, `${path}.electricalModel`),
    thermalModel: text(source.thermalModel, `${path}.thermalModel`),
    geometryContract: text(source.geometryContract, `${path}.geometryContract`),
    rotationModel: text(source.rotationModel, `${path}.rotationModel`),
    weatherSource: text(source.weatherSource, `${path}.weatherSource`),
    timeResolution: text(source.timeResolution, `${path}.timeResolution`),
    selectedFootprintM2: finite(source.selectedFootprintM2, `${path}.selectedFootprintM2`),
    representativeDayScaling: source.representativeDayScaling as false,
    requestFingerprint: text(source.requestFingerprint, `${path}.requestFingerprint`),
  };
  for (const [key, amount] of Object.entries({
    landAreaM2: result.landAreaM2,
    heightM: result.heightM,
    activePvAreaM2: result.activePvAreaM2,
    grossAcKWhYear: result.grossAcKWhYear,
    motorKWhYear: result.motorKWhYear,
    acKWhYear: result.acKWhYear,
    kWhPerLandM2Year: result.kWhPerLandM2Year,
    kWhPerPvM2Year: result.kWhPerPvM2Year,
  })) {
    if (amount < 0) throw new RangeError(`${path}.${key} must not be negative.`);
  }
  if (source.representativeDayScaling !== false) {
    throw new Error(`${path} must be actual-clock integration, not representative-day scaling.`);
  }
  const clockPattern = new RegExp(`actual ${expectedHours} intervals.*closing endpoint`, "i");
  if (!clockPattern.test(result.timeResolution)) {
    throw new Error(`${path}.timeResolution must identify actual ${expectedHours} intervals and closing endpoint.`);
  }
  if (result.landAreaM2 === 0 || result.activePvAreaM2 === 0) {
    throw new RangeError(`${path} has a zero comparison denominator.`);
  }
  if (!close(result.pvLandRatio, result.activePvAreaM2 / result.landAreaM2)
    || !close(result.kWhPerLandM2Year, result.acKWhYear / result.landAreaM2)
    || !close(result.kWhPerPvM2Year, result.acKWhYear / result.activePvAreaM2)) {
    throw new Error(`${path} contains an internally inconsistent area-normalized metric.`);
  }
  const aggregateNetLowerBound = Math.max(0, result.grossAcKWhYear - result.motorKWhYear);
  const aggregateMotorDeduction = result.grossAcKWhYear - result.acKWhYear;
  if ((result.acKWhYear > result.grossAcKWhYear && !close(result.acKWhYear, result.grossAcKWhYear))
    || (result.acKWhYear < aggregateNetLowerBound && !close(result.acKWhYear, aggregateNetLowerBound))
    || (aggregateMotorDeduction > result.motorKWhYear && !close(aggregateMotorDeduction, result.motorKWhYear))
    || (result.motorKWhYear === 0 && !close(result.acKWhYear, result.grossAcKWhYear))) {
    throw new Error(`${path} violates aggregate interval-clipped motor-energy bounds.`);
  }
  return result;
}

export const ANNUAL_IMPLEMENTATION_SOURCE_FILES = Object.freeze([
  "scripts/audit-full-year-comparison-v2.ts",
  "src/lib/geometry/comparison-surfaces.ts",
  "src/lib/geometry/continuous-surfaces.ts",
  "src/lib/physics/annual-transient.ts",
  "src/lib/physics/engineering-surface-electrical.ts",
  "src/lib/physics/natural-rotation.ts",
  "src/lib/physics/pipeline.ts",
  "src/lib/physics/transient-thermal.ts",
  "src/lib/weather/offline.ts",
  "src/workers/kernel.ts",
  "src/workers/protocol.ts",
] as const);

function assertAnnualImplementationFingerprint(
  sourceFiles: string[],
  recordedFingerprint: string,
  rootDir: string,
): void {
  const expected = [...ANNUAL_IMPLEMENTATION_SOURCE_FILES].sort();
  const actual = [...sourceFiles].sort();
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new Error("annual implementationSourceFiles has missing or unexpected paths.");
  }
  const root = realpathSync(rootDir);
  const canonical = actual.map((relativePath) => {
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`Annual implementation source is missing or not a file: ${relativePath}`);
    }
    const real = realpathSync(absolutePath);
    const fromRoot = relative(root, real);
    if (fromRoot === "" || fromRoot.startsWith("..") || /^[A-Za-z]:/.test(fromRoot)) {
      throw new Error(`Annual implementation source escapes the workspace: ${relativePath}`);
    }
    return `${relativePath}\0${readFileSync(real)}`;
  }).join("\n");
  const calculated = createHash("sha256").update(canonical).digest("hex");
  if (calculated !== recordedFingerprint) {
    throw new Error("annual implementationFingerprint disagrees with current source bytes.");
  }
}

function annualResolution(value: unknown, path: string): AnnualResolution {
  const source = record(value, path);
  const result = {
    azimuthSamples: finite(source.azimuthSamples, `${path}.azimuthSamples`),
    meridionalSegments: finite(source.meridionalSegments, `${path}.meridionalSegments`),
    phaseSamples: finite(source.phaseSamples, `${path}.phaseSamples`),
    circuitSamples: finite(source.circuitSamples, `${path}.circuitSamples`),
  };
  if (Object.values(result).some((entry) => !Number.isInteger(entry) || entry <= 0)) {
    throw new Error(`${path} must contain positive integer sample counts.`);
  }
  return result;
}

function convergenceComparison(value: unknown, path: string): AnnualConvergenceComparison {
  const source = record(value, path);
  const shape = text(source.shape, `${path}.shape`) as ValidationShape;
  if (!VALIDATION_SHAPES.includes(shape)) throw new Error(`${path}.shape is unsupported.`);
  const lowWh = finite(source.lowWh, `${path}.lowWh`);
  const highWh = finite(source.highWh, `${path}.highWh`);
  const relativeDifference = finite(source.relativeDifference, `${path}.relativeDifference`);
  const tolerance = finite(source.tolerance, `${path}.tolerance`);
  const pass = bool(source.pass, `${path}.pass`);
  const calculated = Math.abs(lowWh - highWh) / Math.max(1e-12, Math.abs(highWh));
  if (!close(relativeDifference, calculated, 1e-10) || pass !== (calculated <= tolerance)) {
    throw new Error(`${path} relative difference or pass flag disagrees with recalculation.`);
  }
  return {
    shape,
    electricalModel: text(source.electricalModel, `${path}.electricalModel`),
    lowWh, highWh, relativeDifference, tolerance, pass,
  };
}

export function validateAnnualAudit(value: unknown, rootDir = process.cwd()): AnnualAudit {
  const source = record(value, "annual");
  if (source.schemaVersion !== 2) throw new Error("annual.schemaVersion must be 2.");
  timestamp(source.generatedAt, "annual.generatedAt");
  const conditions = record(source.conditions, "annual.conditions");
  const year = finite(conditions.year, "annual.conditions.year");
  const expectedHours = calendarHours(year);
  const intervals = finite(conditions.intervals, "annual.conditions.intervals");
  const weatherPoints = finite(conditions.weatherPoints, "annual.conditions.weatherPoints");
  const durationHours = finite(conditions.durationHours, "annual.conditions.durationHours");
  if (!Number.isInteger(year) || !Number.isInteger(intervals) || !Number.isInteger(weatherPoints)
    || intervals !== expectedHours || durationHours !== expectedHours || weatherPoints !== intervals + 1) {
    throw new Error("annual clock must contain every calendar-hour interval and one closing endpoint.");
  }
  if (!/actual hourly full-year/i.test(text(conditions.integration, "annual.conditions.integration"))) {
    throw new Error("annual integration must explicitly identify actual full-year hourly integration.");
  }
  const configurationFingerprint = sha256(
    conditions.configurationFingerprint,
    "annual.conditions.configurationFingerprint",
  );
  const implementationFingerprint = sha256(
    conditions.implementationFingerprint,
    "annual.conditions.implementationFingerprint",
  );
  const implementationSourceFiles = stringArray(
    conditions.implementationSourceFiles,
    "annual.conditions.implementationSourceFiles",
  );
  assertAnnualImplementationFingerprint(implementationSourceFiles, implementationFingerprint, rootDir);

  const gate = record(source.convergenceGate, "annual.convergenceGate");
  const lowResolution = annualResolution(gate.lowResolution, "annual.convergenceGate.lowResolution");
  const highResolution = annualResolution(gate.highResolution, "annual.convergenceGate.highResolution");
  if (Object.keys(lowResolution).some((key) => lowResolution[key as keyof AnnualResolution]
    >= highResolution[key as keyof AnnualResolution])) {
    throw new Error("annual highResolution must exceed lowResolution in every integration dimension.");
  }
  const idealSource = record(gate.ideal, "annual.convergenceGate.ideal");
  const engineeringSource = record(gate.engineering, "annual.convergenceGate.engineering");
  const idealComparisons = array(idealSource.comparisons, "annual.convergenceGate.ideal.comparisons")
    .map((entry, index) => convergenceComparison(entry, `annual.convergenceGate.ideal.comparisons[${index}]`));
  expectCompleteShapeSet(idealComparisons.map((entry) => entry.shape), "annual ideal convergence comparisons");
  if (idealComparisons.some((entry) => entry.electricalModel !== "local-mpp-area-integral")) {
    throw new Error("annual ideal convergence group has the wrong electrical model.");
  }
  const officialIdealPass = bool(gate.officialIdealPass, "annual.convergenceGate.officialIdealPass");
  if (!officialIdealPass || !bool(idealSource.pass, "annual.convergenceGate.ideal.pass")
    || officialIdealPass !== idealComparisons.every((entry) => entry.pass)) {
    throw new Error("annual official ideal convergence must pass all six shapes.");
  }
  const engineeringComparisons = array(
    engineeringSource.comparisons,
    "annual.convergenceGate.engineering.comparisons",
  ).map((entry, index) => convergenceComparison(
    entry,
    `annual.convergenceGate.engineering.comparisons[${index}]`,
  ));
  if (engineeringComparisons.length === 0
    || engineeringComparisons.some((entry) => entry.electricalModel !== "explicit-series-parallel-bypass")) {
    throw new Error("annual engineering convergence evidence is missing or has the wrong model.");
  }
  const extendedSource = record(
    engineeringSource.extendedCylinder,
    "annual.convergenceGate.engineering.extendedCylinder",
  );
  const selectedWh = finite(extendedSource.selectedWh, "annual.convergenceGate.engineering.extendedCylinder.selectedWh");
  const referenceWh = finite(extendedSource.referenceWh, "annual.convergenceGate.engineering.extendedCylinder.referenceWh");
  const extendedRelativeDifference = finite(
    extendedSource.relativeDifference,
    "annual.convergenceGate.engineering.extendedCylinder.relativeDifference",
  );
  const extendedTolerance = finite(
    extendedSource.tolerance,
    "annual.convergenceGate.engineering.extendedCylinder.tolerance",
  );
  const extendedPass = bool(extendedSource.pass, "annual.convergenceGate.engineering.extendedCylinder.pass");
  const calculatedExtendedDifference = Math.abs(selectedWh - referenceWh)
    / Math.max(1e-12, Math.abs(referenceWh));
  if (text(extendedSource.shape, "annual.convergenceGate.engineering.extendedCylinder.shape") !== "cylinder"
    || text(extendedSource.electricalModel, "annual.convergenceGate.engineering.extendedCylinder.electricalModel") !== "explicit-series-parallel-bypass"
    || !close(extendedRelativeDifference, calculatedExtendedDifference, 1e-10)
    || extendedPass !== (calculatedExtendedDifference <= extendedTolerance)) {
    throw new Error("annual extended cylinder convergence evidence is inconsistent.");
  }
  const resolution = (value: unknown, path: string, expected: readonly number[]) => {
    const item = record(value, path);
    const actual = ["azimuthSamples", "meridionalSegments", "phaseSamples", "circuitSamples"]
      .map((key) => finite(item[key], `${path}.${key}`));
    if (actual.some((entry, index) => !Number.isInteger(entry) || entry <= 0 || entry !== expected[index])) {
      throw new Error(`${path} does not match the pre-registered engineering resolution.`);
    }
  };
  resolution(extendedSource.selectedResolution, "annual.convergenceGate.engineering.extendedCylinder.selectedResolution", [64, 16, 4, 128]);
  resolution(extendedSource.referenceResolution, "annual.convergenceGate.engineering.extendedCylinder.referenceResolution", [128, 32, 4, 128]);
  for (const key of ["selectedSampleCount", "referenceSampleCount"] as const) {
    const count = finite(extendedSource[key], `annual.convergenceGate.engineering.extendedCylinder.${key}`);
    if (!Number.isInteger(count) || count <= 0) throw new Error(`extended cylinder ${key} must be a positive integer.`);
  }
  const dayOffsets = array(extendedSource.dayOffsets, "annual.convergenceGate.engineering.extendedCylinder.dayOffsets")
    .map((entry, index) => finite(entry, `annual.convergenceGate.engineering.extendedCylinder.dayOffsets[${index}]`));
  if (dayOffsets.length !== 4 || dayOffsets.some((entry, index) => entry !== [19, 109, 201, 293][index])) {
    throw new Error("extended cylinder dayOffsets disagree with the pre-registered seasonal fixtures.");
  }
  text(extendedSource.fixture, "annual.convergenceGate.engineering.extendedCylinder.fixture");
  finite(extendedSource.elapsedMs, "annual.convergenceGate.engineering.extendedCylinder.elapsedMs");
  const engineeringPass = bool(gate.engineeringPass, "annual.convergenceGate.engineeringPass");
  const expectedEngineeringPass = engineeringComparisons.every((entry) => entry.pass) && extendedPass;
  if (engineeringPass || expectedEngineeringPass
    || engineeringPass !== expectedEngineeringPass
    || bool(engineeringSource.pass, "annual.convergenceGate.engineering.pass") !== engineeringPass
    || bool(gate.pass, "annual.convergenceGate.pass") !== (officialIdealPass && engineeringPass)
    || bool(gate.engineeringOfficialRankingEligible, "annual.convergenceGate.engineeringOfficialRankingEligible")
    || bool(engineeringSource.officialRankingEligible, "annual.convergenceGate.engineering.officialRankingEligible")
    || text(gate.engineeringRankingVerdict, "annual.convergenceGate.engineeringRankingVerdict") !== "not-evaluated"
    || text(engineeringSource.status, "annual.convergenceGate.engineering.status") !== "not-evaluated") {
    throw new Error("engineering convergence failure must remain honest, rank-ineligible, and not-evaluated.");
  }
  const engineeringReason = text(gate.engineeringReason, "annual.convergenceGate.engineeringReason");

  const ids = new Set<string>();
  const groups = array(source.groups, "annual.groups").map((entry, groupIndex): AnnualGroup => {
    const groupPath = `annual.groups[${groupIndex}]`;
    const group = record(entry, groupPath);
    const id = text(group.id, `${groupPath}.id`);
    if (ids.has(id)) throw new Error(`Duplicate annual group id: ${id}`);
    ids.add(id);
    const electricalModel = text(group.electricalModel, `${groupPath}.electricalModel`);
    const thermalModel = text(group.thermalModel, `${groupPath}.thermalModel`);
    const rowThermalModel = new Map([
      ["quasi-steady-faiman", "준정상 광학 회전·열이력 미포함"],
      ["annual-transient-material-state", "annual actual-clock transient thermal history included"],
    ]).get(thermalModel);
    if (!rowThermalModel) throw new Error(`${groupPath}.thermalModel is unsupported.`);
    const geometryContract = text(group.geometryContract, `${groupPath}.geometryContract`);
    const officialRankingEligible = bool(group.officialRankingEligible, `${groupPath}.officialRankingEligible`);
    const rankingVerdict = text(group.rankingVerdict, `${groupPath}.rankingVerdict`);
    const expectedEligible = electricalModel === "explicit-series-parallel-bypass" ? false : true;
    if (officialRankingEligible !== expectedEligible
      || rankingVerdict !== (expectedEligible ? "pass" : "not-evaluated")) {
      throw new Error(`${groupPath} ranking eligibility/verdict disagrees with convergence evidence.`);
    }
    if (!new Set(["local-mpp-area-integral", "explicit-series-parallel-bypass"]).has(electricalModel)) {
      throw new Error(`${groupPath}.electricalModel is unsupported.`);
    }
    const rows = array(group.rows, `${groupPath}.rows`).map((row, rowIndex) => {
      const rowPath = `${groupPath}.rows[${rowIndex}]`;
      const parsed = annualRow(row, rowPath, expectedHours);
      if (!close(parsed.landAreaM2, finite(conditions.landAreaM2, "annual.conditions.landAreaM2"), 1e-10)
        || !close(parsed.selectedFootprintM2, parsed.landAreaM2, 1e-8)
        || parsed.heightM > finite(conditions.maximumHeightM, "annual.conditions.maximumHeightM") + 1e-10) {
        throw new Error(`${rowPath} violates common land-area or maximum-height conditions.`);
      }
      return parsed;
    });
    expectCompleteShapeSet(rows.map((row) => row.shape), `${groupPath}.rows`);
    rows.forEach((row, rowIndex) => {
      if (row.electricalModel !== electricalModel || row.thermalModel !== rowThermalModel
        || row.geometryContract !== geometryContract) {
        throw new Error(`${groupPath}.rows[${rowIndex}] disagrees with its group model contract.`);
      }
      if (rowIndex > 0 && rows[rowIndex - 1].kWhPerLandM2Year < row.kWhPerLandM2Year) {
        throw new Error(`${groupPath}.rows are not ordered by descending land productivity.`);
      }
    });
    return {
      id,
      comparisonMeaning: text(group.comparisonMeaning, `${groupPath}.comparisonMeaning`),
      geometryContract,
      rotationMode: text(group.rotationMode, `${groupPath}.rotationMode`),
      electricalModel,
      thermalModel,
      officialRankingEligible,
      rankingVerdict: rankingVerdict as AnnualGroup["rankingVerdict"],
      calculationResolution: text(group.calculationResolution, `${groupPath}.calculationResolution`),
      rows,
    };
  });
  const electricalModes = ["local-mpp-area-integral", "explicit-series-parallel-bypass"];
  const requiredFamilies = ["static-land-matched", "swept-held-static", "controlled-kinematic", "controlled-motor-net", "natural-no-cq"];
  for (const mode of electricalModes) for (const family of requiredFamilies) {
    if (!ids.has(`${family}:${mode}`)) throw new Error(`Missing annual comparison group: ${family}:${mode}`);
  }
  for (const id of [
    "transient-static-land-matched:local-mpp-area-integral",
    "transient-swept-held-static:local-mpp-area-integral",
    "transient-controlled-motor-net:local-mpp-area-integral",
    "transient-natural-no-cq:local-mpp-area-integral",
  ]) if (!ids.has(id)) throw new Error(`Missing annual transient group: ${id}`);

  const transient = record(source.transientDecompositionByShape, "annual.transientDecompositionByShape");
  expectCompleteShapeSet(Object.keys(transient), "annual.transientDecompositionByShape");
  const transientDecompositionByShape = Object.fromEntries(Object.entries(transient).map(([shape, entry]) => {
    const path = `annual.transientDecompositionByShape.${shape}`;
    const result = record(entry, path);
    const e00Wh = finite(result.e00Wh, `${path}.e00Wh`);
    const e10Wh = finite(result.e10Wh, `${path}.e10Wh`);
    const e01Wh = finite(result.e01Wh, `${path}.e01Wh`);
    const e11Wh = finite(result.e11Wh, `${path}.e11Wh`);
    const e00GrossWh = finite(result.e00GrossWh, `${path}.e00GrossWh`);
    const e11GrossWh = finite(result.e11GrossWh, `${path}.e11GrossWh`);
    const e11MotorWh = finite(result.e11MotorWh, `${path}.e11MotorWh`);
    const closureResidualWh = finite(result.closureResidualWh, `${path}.closureResidualWh`);
    const heatResidualFraction = finite(result.heatResidualFraction, `${path}.heatResidualFraction`);
    const warmupConverged = bool(result.warmupConverged, `${path}.warmupConverged`);
    const opticalWh = e10Wh - e00Wh;
    const thermalWh = e01Wh - e00Wh;
    const interactionWh = e11Wh - e10Wh - e01Wh + e00Wh;
    const netWh = e11Wh - e00Wh;
    if (Math.abs(closureResidualWh) > 1e-8
      || Math.abs(netWh - opticalWh - thermalWh - interactionWh) > 1e-8
      || Math.abs(heatResidualFraction) > 1e-8 || !warmupConverged
      || [e00Wh, e10Wh, e01Wh, e11Wh, e00GrossWh, e11GrossWh, e11MotorWh].some((amount) => amount < 0)
      || !close(e00Wh, e00GrossWh)
      || (e11Wh > e11GrossWh && !close(e11Wh, e11GrossWh))
      || (e11Wh < Math.max(0, e11GrossWh - e11MotorWh)
        && !close(e11Wh, Math.max(0, e11GrossWh - e11MotorWh)))
      || (e11GrossWh - e11Wh > e11MotorWh && !close(e11GrossWh - e11Wh, e11MotorWh))
      || (e11MotorWh === 0 && !close(e11Wh, e11GrossWh))) {
      throw new Error(`${path} failed closure, heat-residual, warm-up, or aggregate motor-energy acceptance.`);
    }
    const monthly = array(result.monthly, `${path}.monthly`).map((entryMonth, index): AnnualTransientMonth => {
      const monthPath = `${path}.monthly[${index}]`;
      const month = record(entryMonth, monthPath);
      const values = Object.fromEntries([
        "e00Wh", "e10Wh", "e01Wh", "e11Wh", "opticalWh", "thermalWh",
        "interactionWh", "netWh", "closureResidualWh",
      ].map((key) => [key, finite(month[key], `${monthPath}.${key}`)])) as Omit<AnnualTransientMonth, "month">;
      if (!close(values.opticalWh, values.e10Wh - values.e00Wh, 1e-10)
        || !close(values.thermalWh, values.e01Wh - values.e00Wh, 1e-10)
        || !close(values.interactionWh, values.e11Wh - values.e10Wh - values.e01Wh + values.e00Wh, 1e-10)
        || !close(values.netWh, values.e11Wh - values.e00Wh, 1e-10)
        || Math.abs(values.closureResidualWh) > 1e-8) {
        throw new Error(`${monthPath} decomposition does not close.`);
      }
      return { month: text(month.month, `${monthPath}.month`), ...values };
    });
    const expectedMonths = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
    if (monthly.length !== 12 || monthly.some((entryMonth, index) => entryMonth.month !== expectedMonths[index])
      || monthly.some((entryMonth) => [entryMonth.e00Wh, entryMonth.e10Wh, entryMonth.e01Wh, entryMonth.e11Wh].some((amount) => amount < 0))) {
      throw new Error(`${path}.monthly must contain ordered calendar months with nonnegative E00/E10/E01/E11.`);
    }
    for (const key of ["e00Wh", "e10Wh", "e01Wh", "e11Wh"] as const) {
      const annualValue = { e00Wh, e10Wh, e01Wh, e11Wh }[key];
      if (!close(monthly.reduce((sum, entryMonth) => sum + entryMonth[key], 0), annualValue, 1e-8)) {
        throw new Error(`${path}.monthly ${key} does not sum to annual.`);
      }
    }
    return [shape, {
      e00Wh, e10Wh, e01Wh, e11Wh, e00GrossWh, e11GrossWh, e11MotorWh,
      closureResidualWh, heatResidualFraction, warmupConverged, monthly,
    }];
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const sameRow = (firstId: string, secondId: string, shape: ValidationShape, includeGross = true) => {
    const first = groupById.get(firstId)?.rows.find((row) => row.shape === shape);
    const second = groupById.get(secondId)?.rows.find((row) => row.shape === shape);
    if (!first || !second || !close(first.landAreaM2, second.landAreaM2)
      || !close(first.activePvAreaM2, second.activePvAreaM2)
      || !close(first.acKWhYear, second.acKWhYear)
      || (includeGross && !close(first.grossAcKWhYear, second.grossAcKWhYear))) {
      throw new Error(`Annual exact-reuse identity failed: ${firstId}/${secondId}/${shape}.`);
    }
  };
  for (const shape of VALIDATION_SHAPES) {
    for (const model of electricalModes) {
      sameRow(`static-land-matched:${model}`, `natural-no-cq:${model}`, shape);
      const gross = groupById.get(`controlled-kinematic:${model}`)?.rows.find((row) => row.shape === shape);
      const net = groupById.get(`controlled-motor-net:${model}`)?.rows.find((row) => row.shape === shape);
      if (!gross || !net || !close(gross.grossAcKWhYear, net.grossAcKWhYear)) {
        throw new Error(`Controlled gross/net identity failed for ${model}/${shape}.`);
      }
    }
    const decomposition = transientDecompositionByShape[shape];
    for (const [id, expectedWh] of [
      ["transient-swept-held-static:local-mpp-area-integral", decomposition.e00Wh],
      ["transient-controlled-motor-net:local-mpp-area-integral", decomposition.e11Wh],
    ] as const) {
      const row = groupById.get(id)?.rows.find((candidate) => candidate.shape === shape);
      if (!row || !close(row.acKWhYear * 1_000, expectedWh, 1e-8)) {
        throw new Error(`${id}/${shape} disagrees with transient decomposition.`);
      }
    }
  }
  return {
    schemaVersion: 2,
    generatedAt: source.generatedAt as string,
    conditions: {
      ...conditions,
      configurationFingerprint,
      implementationFingerprint,
      implementationSourceFiles,
    } as AnnualAudit["conditions"],
    convergenceGate: {
      pass: false,
      officialIdealPass,
      engineeringPass,
      engineeringOfficialRankingEligible: false,
      engineeringRankingVerdict: "not-evaluated",
      engineeringReason,
      lowResolution,
      highResolution,
      ideal: { pass: true, comparisons: idealComparisons },
      engineering: {
        pass: engineeringPass,
        comparisons: engineeringComparisons,
        extendedCylinder: extendedSource,
        tolerance: finite(engineeringSource.tolerance, "annual.convergenceGate.engineering.tolerance"),
        status: "not-evaluated",
        officialRankingEligible: false,
      },
    },
    groups,
    transientDecompositionByShape,
  };
}

export function validateGeometryAudit(value: unknown): {
  rows: Array<{ shape: ValidationShape; requestedLandAreaM2: number; staticProjectionPass: boolean; sweptOccupationPass: boolean; heightPass: boolean }>;
} {
  const source = record(value, "geometry");
  if (source.schemaVersion !== 2) throw new Error("geometry.schemaVersion must be 2.");
  timestamp(source.generatedAt, "geometry.generatedAt");
  const tolerances = record(source.tolerances, "geometry.tolerances");
  const areaTolerance = finite(tolerances.areaM2, "geometry.tolerances.areaM2");
  const heightTolerance = finite(tolerances.installedHeightM, "geometry.tolerances.installedHeightM");
  const rows = array(source.rows, "geometry.rows").map((entry, index) => {
    const path = `geometry.rows[${index}]`;
    const row = record(entry, path);
    const shape = text(row.shape, `${path}.shape`);
    if (!(VALIDATION_SHAPES as readonly string[]).includes(shape)) throw new Error(`${path}.shape is unsupported.`);
    const requestedLandAreaM2 = finite(row.requestedLandAreaM2, `${path}.requestedLandAreaM2`);
    const staticProjection = finite(row.instantaneousHorizontalProjectionM2, `${path}.instantaneousHorizontalProjectionM2`);
    const staticError = finite(row.staticProjectionErrorM2, `${path}.staticProjectionErrorM2`);
    const sweptOccupation = finite(row.sweptOccupationM2, `${path}.sweptOccupationM2`);
    const sweptError = finite(row.sweptOccupationErrorM2, `${path}.sweptOccupationErrorM2`);
    const maximumHeightM = finite(row.maximumHeightM, `${path}.maximumHeightM`);
    const maximumWorldSampleYM = finite(row.maximumWorldSampleYM, `${path}.maximumWorldSampleYM`);
    const installedHeightMarginM = finite(row.installedHeightMarginM, `${path}.installedHeightMarginM`);
    const result = {
      shape: shape as ValidationShape,
      requestedLandAreaM2,
      staticProjectionPass: bool(row.staticProjectionPass, `${path}.staticProjectionPass`),
      sweptOccupationPass: bool(row.sweptOccupationPass, `${path}.sweptOccupationPass`),
      heightPass: bool(row.heightPass, `${path}.heightPass`),
    };
    const calculatedStaticError = staticProjection - requestedLandAreaM2;
    const calculatedSweptError = sweptOccupation - requestedLandAreaM2;
    const calculatedHeightMargin = maximumHeightM - maximumWorldSampleYM;
    if (!close(staticError, calculatedStaticError, 1e-12)
      || !close(sweptError, calculatedSweptError, 1e-12)
      || !close(installedHeightMarginM, calculatedHeightMargin, 1e-12)
      || result.staticProjectionPass !== (Math.abs(calculatedStaticError) <= areaTolerance)
      || result.sweptOccupationPass !== (Math.abs(calculatedSweptError) <= areaTolerance)
      || result.heightPass !== (calculatedHeightMargin >= -heightTolerance)) {
      throw new Error(`${path} pass flags or reported errors disagree with calculated geometry residuals.`);
    }
    if (!result.staticProjectionPass || !result.sweptOccupationPass || !result.heightPass) {
      throw new Error(`${path} failed its acceptance contract.`);
    }
    return result;
  });
  if (rows.length !== 18) throw new Error("geometry audit must contain 3 land areas x 6 shapes.");
  const landAreas = [...new Set(rows.map((row) => row.requestedLandAreaM2))];
  if (landAreas.length !== 3) throw new Error("geometry audit must contain exactly three land-area cases.");
  for (const landAreaM2 of landAreas) {
    expectCompleteShapeSet(
      rows.filter((row) => row.requestedLandAreaM2 === landAreaM2).map((row) => row.shape),
      `geometry land area ${landAreaM2}`,
    );
  }
  return { rows };
}

export function validateNaturalAudit(value: unknown): {
  conditions: UnknownRecord;
  officialNoCq: Array<{ shape: string; annualTimeWeightedMeanRpm: number; confidence: string; officialComparisonEligible: boolean }>;
  unverifiedUserCqSensitivity: Array<{ shape: string; annualTimeWeightedMeanRpm: number; confidence: string; officialComparisonEligible: boolean; exclusionReasons: string[] }>;
} {
  const source = record(value, "natural");
  if (source.schemaVersion !== 2) throw new Error("natural.schemaVersion must be 2.");
  timestamp(source.generatedAt, "natural.generatedAt");
  const conditions = record(source.conditions, "natural.conditions");
  const parseRows = (key: "officialNoCq" | "unverifiedUserCqSensitivity") => array(source[key], `natural.${key}`).map((entry, index) => {
    const path = `natural.${key}[${index}]`;
    const row = record(entry, path);
    return {
      shape: text(row.shape, `${path}.shape`),
      annualTimeWeightedMeanRpm: finite(row.annualTimeWeightedMeanRpm, `${path}.annualTimeWeightedMeanRpm`),
      confidence: text(row.confidence, `${path}.confidence`),
      officialComparisonEligible: bool(row.officialComparisonEligible, `${path}.officialComparisonEligible`),
      exclusionReasons: stringArray(row.exclusionReasons, `${path}.exclusionReasons`),
      torqueCoefficientInput: text(row.torqueCoefficientInput, `${path}.torqueCoefficientInput`),
      integratedHours: finite(row.integratedHours, `${path}.integratedHours`),
    };
  });
  const official = parseRows("officialNoCq");
  const sensitivity = parseRows("unverifiedUserCqSensitivity");
  expectCompleteShapeSet(official.map((row) => row.shape), "natural.officialNoCq");
  expectCompleteShapeSet(sensitivity.map((row) => row.shape), "natural.unverifiedUserCqSensitivity");
  for (const row of official) {
    if (row.torqueCoefficientInput !== "absent" || row.annualTimeWeightedMeanRpm !== 0) {
      throw new Error(`natural.officialNoCq.${row.shape} must be exactly 0 RPM when C_Q is absent.`);
    }
  }
  for (const row of sensitivity) {
    if (row.officialComparisonEligible || row.exclusionReasons.length === 0) {
      throw new Error(`natural user-C_Q sensitivity ${row.shape} must be excluded with a reason.`);
    }
  }
  return {
    conditions,
    officialNoCq: official,
    unverifiedUserCqSensitivity: sensitivity,
  };
}

export function validateThermalAudit(value: unknown): {
  coverage: { steps: number; intervals: number; durationHours: number };
  annualEnergyWh: Record<string, number> & { e00Wh: number; e10Wh: number; e01Wh: number; e11Wh: number; opticalWh: number; thermalWh: number; interactionWh: number; netWh: number; closureResidualWh: number };
  temperature: Record<string, number>;
  energyAudit: { relativeEnergyResidual: number };
  meshConvergence14Day: { converged: boolean; points: Array<Record<string, number>> };
} {
  const source = record(value, "thermal");
  timestamp(source.generatedAtUtc, "thermal.generatedAtUtc");
  const coverageSource = record(source.coverage, "thermal.coverage");
  const coverage = {
    steps: finite(coverageSource.steps, "thermal.coverage.steps"),
    intervals: finite(coverageSource.intervals, "thermal.coverage.intervals"),
    durationHours: finite(coverageSource.durationHours, "thermal.coverage.durationHours"),
  };
  if (coverage.steps !== coverage.intervals + 1 || ![8_760, 8_784].includes(coverage.intervals)
    || coverage.durationHours !== coverage.intervals || coverageSource.closingEndpointPresent !== true) {
    throw new Error("thermal audit is not a complete calendar-year integration with a closing endpoint.");
  }
  const energySource = record(source.annualEnergyWh, "thermal.annualEnergyWh");
  const keys = ["e00Wh", "e10Wh", "e01Wh", "e11Wh", "opticalWh", "thermalWh", "interactionWh", "netWh", "closureResidualWh"] as const;
  const annualEnergyWh = Object.fromEntries(keys.map((key) => [key, finite(energySource[key], `thermal.annualEnergyWh.${key}`)])) as ReturnType<typeof validateThermalAudit>["annualEnergyWh"];
  const calculatedClosure = annualEnergyWh.netWh - (annualEnergyWh.opticalWh + annualEnergyWh.thermalWh + annualEnergyWh.interactionWh);
  if (Math.abs(annualEnergyWh.closureResidualWh) > 1e-8 || Math.abs(calculatedClosure) > 1e-8
    || !close(annualEnergyWh.opticalWh, annualEnergyWh.e10Wh - annualEnergyWh.e00Wh, 1e-10)
    || !close(annualEnergyWh.thermalWh, annualEnergyWh.e01Wh - annualEnergyWh.e00Wh, 1e-10)
    || !close(annualEnergyWh.interactionWh, annualEnergyWh.e11Wh - annualEnergyWh.e10Wh - annualEnergyWh.e01Wh + annualEnergyWh.e00Wh, 1e-10)
    || !close(annualEnergyWh.netWh, annualEnergyWh.e11Wh - annualEnergyWh.e00Wh, 1e-10)) {
    throw new Error("thermal E00/E10/E01/E11 decomposition does not close.");
  }
  const energyAuditSource = record(source.energyAudit, "thermal.energyAudit");
  const energyAudit = { relativeEnergyResidual: finite(energyAuditSource.relativeEnergyResidual, "thermal.energyAudit.relativeEnergyResidual") };
  if (Math.abs(energyAudit.relativeEnergyResidual) > 1e-8) throw new Error("thermal heat-ledger residual failed tolerance.");
  const meshSource = record(source.meshConvergence14Day, "thermal.meshConvergence14Day");
  const meshConvergence14Day = {
    converged: bool(meshSource.converged, "thermal.meshConvergence14Day.converged"),
    points: array(meshSource.points, "thermal.meshConvergence14Day.points").map((point) => record(point, "thermal.meshConvergence14Day.points[]") as Record<string, number>),
  };
  if (!meshConvergence14Day.converged || meshConvergence14Day.points.length < 2) throw new Error("thermal mesh convergence failed or was not reported.");
  return {
    coverage,
    annualEnergyWh,
    temperature: record(source.temperature, "thermal.temperature") as Record<string, number>,
    energyAudit,
    meshConvergence14Day,
  };
}

export function validateThermalComparisonAudit(value: unknown): {
  quasiSteady: { staticAcEnergyWh: number; rotatingAcEnergyWh: number };
  transient: { staticAcEnergyWh: number; rotatingAcEnergyWh: number };
  differences: Record<string, number>;
} {
  const source = record(value, "thermalComparison");
  if (source.schemaVersion !== 1) throw new Error("thermalComparison.schemaVersion must be 1.");
  timestamp(source.generatedAt, "thermalComparison.generatedAt");
  const pair = (key: "quasiSteady" | "transient") => {
    const item = record(source[key], `thermalComparison.${key}`);
    return {
      staticAcEnergyWh: finite(item.staticAcEnergyWh, `thermalComparison.${key}.staticAcEnergyWh`),
      rotatingAcEnergyWh: finite(item.rotatingAcEnergyWh, `thermalComparison.${key}.rotatingAcEnergyWh`),
    };
  };
  const differences = record(source.differences, "thermalComparison.differences");
  const requiredDifferenceKeys = [
    "staticTransientMinusQuasiWh", "staticTransientMinusQuasiPercent",
    "rotatingTransientMinusQuasiWh", "rotatingTransientMinusQuasiPercent",
  ] as const;
  const validatedDifferences = Object.fromEntries(requiredDifferenceKeys.map((key) => [
    key, finite(differences[key], `thermalComparison.differences.${key}`),
  ])) as Record<(typeof requiredDifferenceKeys)[number], number>;
  const quasiSteady = pair("quasiSteady");
  const transient = pair("transient");
  const staticDifference = transient.staticAcEnergyWh - quasiSteady.staticAcEnergyWh;
  const rotatingDifference = transient.rotatingAcEnergyWh - quasiSteady.rotatingAcEnergyWh;
  if (!close(validatedDifferences.staticTransientMinusQuasiWh, staticDifference, 1e-10)
    || !close(validatedDifferences.rotatingTransientMinusQuasiWh, rotatingDifference, 1e-10)
    || !close(
      validatedDifferences.staticTransientMinusQuasiPercent,
      100 * staticDifference / quasiSteady.staticAcEnergyWh,
      1e-10,
    )
    || !close(
      validatedDifferences.rotatingTransientMinusQuasiPercent,
      100 * rotatingDifference / quasiSteady.rotatingAcEnergyWh,
      1e-10,
    )) {
    throw new Error("thermal comparison differences disagree with quasi-steady/transient energies.");
  }
  return { quasiSteady, transient, differences: validatedDifferences };
}

export function validateResearchAudit(value: unknown): ResearchAudit {
  const source = record(value, "research");
  if (source.schemaVersion !== 1) throw new Error("research.schemaVersion must be 1.");
  timestamp(source.generatedAt, "research.generatedAt");
  const policySource = record(source.policy, "research.policy");
  const policy = {
    sourceInputsOnly: bool(policySource.sourceInputsOnly, "research.policy.sourceInputsOnly"),
    missingInputsEstimated: bool(policySource.missingInputsEstimated, "research.policy.missingInputsEstimated"),
    calibrationFactors: bool(policySource.calibrationFactors, "research.policy.calibrationFactors"),
    shapeMultipliers: bool(policySource.shapeMultipliers, "research.policy.shapeMultipliers"),
    reportedOutputsUsedAsSolverTargets: bool(
      policySource.reportedOutputsUsedAsSolverTargets,
      "research.policy.reportedOutputsUsedAsSolverTargets",
    ),
  };
  if (!policy.sourceInputsOnly || policy.missingInputsEstimated || policy.calibrationFactors
    || policy.shapeMultipliers || policy.reportedOutputsUsedAsSolverTargets) {
    throw new Error("research policy permits estimation, calibration, multipliers, or reported-output fitting.");
  }

  const summarySource = record(source.summary, "research.summary");
  const summary = {
    ...Object.fromEntries(Object.entries(summarySource).map(([key, entry]) => [
      key, finite(entry, `research.summary.${key}`),
    ])),
    studyCount: finite(summarySource.studyCount, "research.summary.studyCount"),
    evaluatedCount: finite(summarySource.evaluatedCount, "research.summary.evaluatedCount"),
    passCount: finite(summarySource.passCount, "research.summary.passCount"),
    partialCount: finite(summarySource.partialCount, "research.summary.partialCount"),
    failCount: finite(summarySource.failCount, "research.summary.failCount"),
    notEvaluatedCount: finite(summarySource.notEvaluatedCount, "research.summary.notEvaluatedCount"),
    opticalGeometrySourceEquivalentCount: finite(
      summarySource.opticalGeometrySourceEquivalentCount,
      "research.summary.opticalGeometrySourceEquivalentCount",
    ),
    rotatingThermalSourceEquivalentCount: finite(
      summarySource.rotatingThermalSourceEquivalentCount,
      "research.summary.rotatingThermalSourceEquivalentCount",
    ),
  };
  const httpsUrls = (entry: unknown, path: string): string[] => {
    const urls = stringArray(entry, path);
    if (urls.length === 0 || urls.some((url) => !url.startsWith("https://"))) {
      throw new Error(`${path} must list at least one HTTPS primary-source URL.`);
    }
    return urls;
  };
  const conditionKeys = [
    "geometry", "areaBasis", "sourceAndSpectrum", "incidence", "weather",
    "albedoAndReflector", "thermalAndConvection", "electricalConnection", "measuredQuantity",
  ] as const;
  const conditionMatrix = array(source.conditionMatrix, "research.conditionMatrix").map((entry, index): ResearchCondition => {
    const path = `research.conditionMatrix[${index}]`;
    const condition = record(entry, path);
    return {
      studyId: text(condition.studyId, `${path}.studyId`),
      title: text(condition.title, `${path}.title`),
      ...Object.fromEntries(conditionKeys.map((key) => [key, text(condition[key], `${path}.${key}`)])),
      primarySourceUrls: httpsUrls(condition.primarySourceUrls, `${path}.primarySourceUrls`),
    } as ResearchCondition;
  });

  const allowedVerdicts = new Set<ResearchAudit["studies"][number]["verdict"]>([
    "pass", "partial", "fail", "not-evaluated",
  ]);
  const studyIds = new Set<string>();
  const studies = array(source.studies, "research.studies").map((entry, studyIndex): ResearchAudit["studies"][number] => {
    const path = `research.studies[${studyIndex}]`;
    const study = record(entry, path);
    const verdict = text(study.verdict, `${path}.verdict`) as ResearchAudit["studies"][number]["verdict"];
    if (!allowedVerdicts.has(verdict)) throw new Error(`${path}.verdict is unsupported.`);
    const metrics = array(study.metrics, `${path}.metrics`).map((entryMetric, metricIndex): ResearchMetric => {
      const metricPath = `${path}.metrics[${metricIndex}]`;
      const metric = record(entryMetric, metricPath);
      const reportedValue = finite(metric.reportedValue, `${metricPath}.reportedValue`);
      const simulatedValue = finite(metric.simulatedValue, `${metricPath}.simulatedValue`);
      const absoluteError = finite(metric.absoluteError, `${metricPath}.absoluteError`);
      const relativeErrorPercent = finite(metric.relativeErrorPercent, `${metricPath}.relativeErrorPercent`);
      const tolerancePercent = finite(metric.tolerancePercent, `${metricPath}.tolerancePercent`);
      if (!close(absoluteError, Math.abs(simulatedValue - reportedValue), 1e-9)) {
        throw new Error(`${metricPath}.absoluteError is inconsistent with reported and simulated values.`);
      }
      if (reportedValue !== 0
        && !close(relativeErrorPercent, 100 * absoluteError / Math.abs(reportedValue), 1e-8)) {
        throw new Error(`${metricPath}.relativeErrorPercent is inconsistent.`);
      }
      if (tolerancePercent < 0) throw new RangeError(`${metricPath}.tolerancePercent must not be negative.`);
      const metricVerdict = text(metric.verdict, `${metricPath}.verdict`) as "pass" | "fail";
      if (metricVerdict !== (relativeErrorPercent <= tolerancePercent ? "pass" : "fail")) {
        throw new Error(`${metricPath}.verdict disagrees with the predeclared numeric tolerance.`);
      }
      return {
        metric: text(metric.metric, `${metricPath}.metric`),
        unit: text(metric.unit, `${metricPath}.unit`),
        reportedValue,
        simulatedValue,
        absoluteError,
        relativeErrorPercent,
        tolerancePercent,
        toleranceBasis: text(metric.toleranceBasis, `${metricPath}.toleranceBasis`),
        verdict: metricVerdict,
      };
    });
    if (verdict === "not-evaluated" && metrics.length !== 0) {
      throw new Error(`${path} is not-evaluated but contains metrics.`);
    }
    if (verdict !== "not-evaluated" && metrics.length === 0) {
      throw new Error(`${path} is evaluated but contains no metric.`);
    }
    if (verdict === "pass" && metrics.some((metric) => metric.verdict !== "pass")) {
      throw new Error(`${path}.verdict pass disagrees with failed metrics.`);
    }
    if (verdict === "fail" && metrics.every((metric) => metric.verdict === "pass")) {
      throw new Error(`${path}.verdict fail has no failed metric.`);
    }
    if (verdict === "partial"
      && (!metrics.some((metric) => metric.verdict === "pass")
        || !metrics.some((metric) => metric.verdict === "fail"))) {
      throw new Error(`${path}.verdict partial requires passing and failing metrics.`);
    }
    const possibleDifferenceCauses = stringArray(
      study.possibleDifferenceCauses,
      `${path}.possibleDifferenceCauses`,
    );
    if (possibleDifferenceCauses.length === 0) {
      throw new Error(`${path}.possibleDifferenceCauses must not be empty.`);
    }
    const sensitivity = array(study.sensitivity, `${path}.sensitivity`).map((item, index): ResearchSensitivity => {
      const sensitivityPath = `${path}.sensitivity[${index}]`;
      const row = record(item, sensitivityPath);
      return {
        parameter: text(row.parameter, `${sensitivityPath}.parameter`),
        lowerCase: text(row.lowerCase, `${sensitivityPath}.lowerCase`),
        lowerValue: finite(row.lowerValue, `${sensitivityPath}.lowerValue`),
        baselineCase: text(row.baselineCase, `${sensitivityPath}.baselineCase`),
        baselineValue: finite(row.baselineValue, `${sensitivityPath}.baselineValue`),
        upperCase: text(row.upperCase, `${sensitivityPath}.upperCase`),
        upperValue: finite(row.upperValue, `${sensitivityPath}.upperValue`),
        unit: text(row.unit, `${sensitivityPath}.unit`),
      };
    });
    if (verdict !== "not-evaluated" && sensitivity.length === 0) {
      throw new Error(`${path} is evaluated but reports no sensitivity analysis.`);
    }
    const studyId = text(study.studyId, `${path}.studyId`);
    if (studyIds.has(studyId)) throw new Error(`Duplicate research study id: ${studyId}`);
    studyIds.add(studyId);
    return {
      benchmarkId: text(study.benchmarkId, `${path}.benchmarkId`),
      studyId,
      title: text(study.title, `${path}.title`),
      scope: text(study.scope, `${path}.scope`),
      verdict,
      reportedTrend: text(study.reportedTrend, `${path}.reportedTrend`),
      simulationResult: text(study.simulationResult, `${path}.simulationResult`),
      metrics,
      matchedConditions: stringArray(study.matchedConditions, `${path}.matchedConditions`),
      unmatchedConditions: stringArray(study.unmatchedConditions, `${path}.unmatchedConditions`),
      possibleDifferenceCauses,
      sensitivity,
      primarySourceUrls: httpsUrls(study.primarySourceUrls, `${path}.primarySourceUrls`),
    };
  });
  const conditionIds = conditionMatrix.map((condition) => condition.studyId);
  if (conditionIds.length !== studies.length || new Set(conditionIds).size !== studies.length
    || studies.some((study) => !conditionIds.includes(study.studyId))) {
    throw new Error("research conditionMatrix must cover every study exactly once.");
  }
  for (const study of studies) {
    const condition = conditionMatrix.find((entry) => entry.studyId === study.studyId)!;
    const conditionUrls = [...condition.primarySourceUrls].sort();
    const studyUrls = [...study.primarySourceUrls].sort();
    if (condition.title !== study.title || conditionUrls.length !== studyUrls.length
      || conditionUrls.some((url, index) => url !== studyUrls[index])) {
      throw new Error(`research condition title/source URLs disagree for ${study.studyId}.`);
    }
  }
  const opticalPassCount = studies.filter((study) => study.studyId === "source:E" && study.verdict === "pass").length;
  const rotatingThermalPassCount = studies.filter((study) => study.studyId === "source:F" && study.verdict === "pass").length;
  if (summary.opticalGeometrySourceEquivalentCount !== opticalPassCount || opticalPassCount !== 1
    || summary.rotatingThermalSourceEquivalentCount !== rotatingThermalPassCount || rotatingThermalPassCount !== 1) {
    throw new Error("research source-equivalent category counts disagree with evaluated source:E/source:F passes.");
  }
  const verdictCounts = Object.fromEntries([...allowedVerdicts].map((verdict) => [
    verdict, studies.filter((study) => study.verdict === verdict).length,
  ]));
  if (summary.studyCount !== studies.length
    || summary.passCount !== verdictCounts.pass
    || summary.partialCount !== verdictCounts.partial
    || summary.failCount !== verdictCounts.fail
    || summary.notEvaluatedCount !== verdictCounts["not-evaluated"]
    || summary.evaluatedCount !== summary.passCount + summary.partialCount + summary.failCount) {
    throw new Error("research summary counts disagree with study verdicts.");
  }
  return {
    schemaVersion: 1,
    generatedAt: source.generatedAt as string,
    policy: policy as ResearchAudit["policy"],
    summary,
    conditionMatrix,
    studies,
  };
}

export const VALIDATION_REPORT_LOCAL_LINKS = Object.freeze([
  ["Annual transient audit JSON", "./annual-transient-audit-2026.json"],
  ["Fair geometry audit JSON", "./fair-geometry-audit-2026.json"],
  ["Full-year comparison audit JSON", "./full-year-comparison-audit-2026.json"],
  ["Natural rotation audit JSON", "./natural-rotation-audit-2026.json"],
  ["Research source-equivalent audit JSON", "./research-source-equivalent-audit.json"],
  ["Thermal comparison audit JSON", "./thermal-model-comparison-audit-2026.json"],
  ["SHA-256 manifest", "./validation-audit-manifest-2026.json"],
  ["Annual transient audit code", "../scripts/audit-annual-transient.ts"],
  ["Fair geometry audit code", "../scripts/audit-fair-geometry.ts"],
  ["Full-year comparison audit code", "../scripts/audit-full-year-comparison-v2.ts"],
  ["Natural rotation audit code", "../scripts/audit-natural-rotation.ts"],
  ["Research benchmark audit code", "../scripts/audit-research-benchmarks.ts"],
  ["Thermal comparison audit code", "../scripts/audit-thermal-model-comparison.ts"],
] as const);

export function renderValidationArtifactLinks(): string[] {
  return [
    "## Machine-readable artifacts and executable audit code",
    "",
    ...VALIDATION_REPORT_LOCAL_LINKS.map(([label, href]) => `- [${label}](${href})`),
    "",
  ];
}

export function assertValidationReportLocalLinksExist(
  markdown: string,
  outputPath: string,
  rootDir = process.cwd(),
): void {
  const outputAbsolute = resolve(rootDir, outputPath);
  const hrefs = [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const [, expectedHref] of VALIDATION_REPORT_LOCAL_LINKS) {
    if (!hrefs.includes(expectedHref)) throw new Error(`Generated report is missing required link: ${expectedHref}`);
  }
  for (const href of hrefs) {
    if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    const pathWithoutFragment = decodeURIComponent(href.split("#", 1)[0]);
    const target = resolve(dirname(outputAbsolute), pathWithoutFragment);
    const targetRelative = relative(resolve(rootDir), target);
    if (targetRelative === "" || targetRelative.startsWith("..") || /^[A-Za-z]:/.test(targetRelative)) {
      throw new Error(`Generated report link escapes the workspace: ${href}`);
    }
    if (!existsSync(target)) throw new Error(`Generated report link target is missing: ${href}`);
  }
}
