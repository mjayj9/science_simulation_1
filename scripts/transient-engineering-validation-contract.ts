import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  ENGINEERING_VALIDATION_SHAPES,
  implementationFingerprint,
  type EngineeringMeshAudit,
  type EngineeringMeshTopology,
  type EngineeringValidationShape,
} from "./engineering-validation-contract";
import {
  ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
  ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
} from "../src/lib/physics/engineering-surface-electrical";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as UnknownRecord;
}

function expectExactKeys(value: UnknownRecord, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((entry, index) => entry !== wanted[index])) {
    throw new Error(`${path} has missing or unexpected fields.`);
  }
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

function nonnegative(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) throw new RangeError(`${path} must not be negative.`);
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isInteger(result) || result <= 0) throw new RangeError(`${path} must be a positive integer.`);
  return result;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be boolean.`);
  return value;
}

function sha256(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  return result;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) => text(entry, `${path}[${index}]`));
}

function close(actual: number, expected: number, tolerance = 1e-9): boolean {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

function relativeDifference(selected: number, reference: number): number {
  return Math.abs(selected - reference) / Math.max(1e-12, Math.abs(reference));
}

function expectCompleteShapeSet(values: readonly string[], path: string): void {
  if (values.length !== ENGINEERING_VALIDATION_SHAPES.length
    || new Set(values).size !== ENGINEERING_VALIDATION_SHAPES.length
    || ENGINEERING_VALIDATION_SHAPES.some((shape) => !values.includes(shape))) {
    throw new Error(`${path} must contain all six comparison shapes exactly once.`);
  }
}

function artifactPath(rootDir: string, relativePath: string, label: string): string {
  const root = realpathSync(rootDir);
  const absolute = resolve(root, relativePath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${label} is missing or is not a regular file: ${relativePath}`);
  }
  const real = realpathSync(absolute);
  const fromRoot = relative(root, real);
  if (fromRoot === "" || fromRoot.startsWith("..") || /^[A-Za-z]:/.test(fromRoot)) {
    throw new Error(`${label} escapes the workspace: ${relativePath}`);
  }
  return real;
}

function fileSha256(rootDir: string, relativePath: string, label: string): string {
  return createHash("sha256").update(readFileSync(artifactPath(rootDir, relativePath, label))).digest("hex");
}

function readJson(rootDir: string, relativePath: string, label: string): UnknownRecord {
  return record(JSON.parse(readFileSync(artifactPath(rootDir, relativePath, label), "utf8")), label);
}

export type TransientEngineeringMonth = {
  month: string;
  dcEnergyWh: number;
  idealLocalMppDcEnergyWh: number;
  mismatchAndWiringLossEnergyWh: number;
  grossAcEnergyWh: number;
  acEnergyWh: number;
  motorEnergyWh: number;
  absorbedSolarEnergyWh: number;
  bypassActivationDeviceHours: number;
};

export type TransientEngineeringRankingRow = {
  rank: number | null;
  shape: EngineeringValidationShape;
  landAreaM2: number;
  activePvAreaM2: number;
  pvLandRatio: number;
  dcKWhYear: number;
  idealLocalMppDcKWhYear: number;
  mismatchAndWiringLossKWhYear: number;
  grossAcKWhYear: number;
  motorKWhYear: number;
  netAcKWhYear: number;
  kWhPerLandM2Year: number;
  kWhPerPvM2Year: number;
  quasiSteadyEngineeringNetAcKWhYear: number;
  transientMinusQuasiSteadyKWhYear: number;
  transientMinusQuasiSteadyFraction: number;
  electricalLayoutId: string;
  topology: UnknownRecord;
  monthly: TransientEngineeringMonth[];
  provenance: UnknownRecord;
};

export type TransientEngineeringAudit = {
  schemaVersion: 1;
  generatedAtUtc: string;
  verdict: "pass";
  officialRankingEligible: true;
  blockingReasons: [];
  conditions: UnknownRecord;
  certifiedFixture: TransientEngineeringCertifiedFixture;
  provenance: UnknownRecord;
  resolution: UnknownRecord;
  coverage: UnknownRecord;
  unsupportedMatrix: UnknownRecord;
  baselineRegression: UnknownRecord;
  couplingConvergence: UnknownRecord;
  thermalMeshConvergence: UnknownRecord;
  thermalModelComparison: UnknownRecord;
  workerFullYearParity: UnknownRecord;
  rankings: Record<"static" | "controlled" | "natural", { official: true; rows: TransientEngineeringRankingRow[] }>;
  shortFactorialDecomposition: UnknownRecord;
  deterministicReplay: UnknownRecord;
  runtime: UnknownRecord;
};
export const TRANSIENT_ENGINEERING_RANKING_MODES = Object.freeze([
  "static", "controlled", "natural",
] as const);
export type TransientEngineeringRankingMode = (typeof TRANSIENT_ENGINEERING_RANKING_MODES)[number];

// This is an input contract, not a copied numerical result. Keeping the full
// fixture here makes a producer/gate change an explicit validation-contract
// change and prevents a compact gate from silently certifying different inputs.
export const CERTIFIED_TRANSIENT_ENGINEERING_FIXTURE = Object.freeze({
  year: 2025,
  location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
  reportingOffsetMinutes: 540,
  weather: {
    source: "offline/model-estimate (not measured Seoul TMY)",
    seed: "full-year-fair-comparison-2025",
    preset: "partly-cloudy",
    stepMinutes: 60,
    intervals: 8_760,
    closingEndpointPresent: true,
  },
  geometry: {
    landAreaM2: 0.05,
    maximumHeightM: 0.252313252202016,
    planeTiltDeg: 30,
    planeAzimuthDeg: 180,
  },
  optics: {
    albedo: 0.2,
    iam: { model: "ashrae", b0: 0.05 },
    diffuseModel: "hay-davies",
    soilingLossFraction: 0.02,
    reflector: "none",
    obstacles: "none",
  },
  pv: {
    referenceCell: {
      areaM2: 0.0025,
      efficiency: 0.2,
      pmaxW: 0.5,
      vocV: 0.62,
      iscA: 1.06,
      vmpV: 0.5,
      impA: 1,
      seriesResistanceOhm: 0.02,
      shuntResistanceOhm: 100,
      idealityFactor: 1,
      cellsInSeries: 1,
      referenceTemperatureC: 25,
      referenceIrradianceWm2: 1_000,
      alphaIscAperC: 0.00053,
      gammaPmpPerC: -0.004,
      bandgapEv: 1.121,
    },
    electricalAvailabilityFactor: 1,
    absorptivity: 0.9,
  },
  inverter: {
    ratedAcPowerW: 100,
    nominalEfficiency: 0.96,
    mpptMinVoltageV: 0.1,
    mpptMaxVoltageV: 100,
    maxDcVoltageV: 500,
    maxInputCurrentA: 100,
    startPowerW: 0,
    nightConsumptionW: 0,
    wiringLossFraction: 0.015,
  },
  thermal: {
    materialConfig: {
      arealHeatCapacityJm2K: 11_000,
      emissivity: 0.84,
      backConvectionFactor: 0.65,
      minimumConvectionWm2K: 2.8,
      maximumSubstepSeconds: 900,
      minimumTemperatureC: -80,
      maximumTemperatureC: 180,
      air: {
        thermalConductivityWmK: 0.0263,
        kinematicViscosityM2s: 0.00001589,
        prandtl: 0.707,
        viscosityRatio: 1,
      },
    },
    thermalNodeCount: 6,
  },
  controlledRotation: {
    rpm: 2,
    motor: {
      requiredTorqueNm: 0.002,
      motorEfficiency: 0.85,
      source: "user-assumption for audit; not measured and not fitted",
      confidence: "low",
    },
  },
  connection: {
    nominalCellAreaM2: 0.0025,
    parallelStrings: 2,
    cellsPerBypassSubstring: 10,
    bypassForwardVoltageV: 0.5,
    stringWiringResistanceOhm: 0.01,
    arrayWiringResistanceOhm: 0.005,
    cellIvModel: "piecewise-nameplate",
  },
} as const);

export type TransientEngineeringCertifiedFixture = typeof CERTIFIED_TRANSIENT_ENGINEERING_FIXTURE;

export type TransientEngineeringOfficialRankingRow = {
  rank: number;
  shape: EngineeringValidationShape;
  landAreaM2: number;
  activePvAreaM2: number;
  netAcKWhYear: number;
  kWhPerLandM2Year: number;
  kWhPerPvM2Year: number;
  layoutId: string;
  status: "official";
};

type TransientEngineeringOfficialRankingReferenceRow = Pick<
  TransientEngineeringRankingRow,
  "rank" | "shape" | "landAreaM2" | "activePvAreaM2" | "netAcKWhYear"
    | "kWhPerLandM2Year" | "kWhPerPvM2Year" | "electricalLayoutId"
>;

function expectExactContract(value: unknown, expected: unknown, path: string): void {
  if (Array.isArray(expected)) {
    const source = array(value, path);
    if (source.length !== expected.length) throw new Error(`${path} length disagrees with the certified contract.`);
    expected.forEach((entry, index) => expectExactContract(source[index], entry, `${path}[${index}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    const source = record(value, path);
    const expectedRecord = expected as UnknownRecord;
    expectExactKeys(source, Object.keys(expectedRecord), path);
    Object.entries(expectedRecord).forEach(([key, entry]) =>
      expectExactContract(source[key], entry, `${path}.${key}`));
    return;
  }
  if (!Object.is(value, expected)) throw new Error(`${path} disagrees with the certified contract.`);
}

function validateCertifiedFixture(value: unknown, path: string): TransientEngineeringCertifiedFixture {
  expectExactContract(value, CERTIFIED_TRANSIENT_ENGINEERING_FIXTURE, path);
  return value as TransientEngineeringCertifiedFixture;
}

export function validateTransientEngineeringOfficialRankings(
  value: unknown,
  reference: Record<
    TransientEngineeringRankingMode,
    readonly TransientEngineeringOfficialRankingReferenceRow[]
  >,
  path = "transientEngineeringGate.officialRankings",
): Record<TransientEngineeringRankingMode, TransientEngineeringOfficialRankingRow[]> {
  const source = record(value, path);
  expectExactKeys(source, TRANSIENT_ENGINEERING_RANKING_MODES, path);
  const result = {} as Record<TransientEngineeringRankingMode, TransientEngineeringOfficialRankingRow[]>;
  for (const mode of TRANSIENT_ENGINEERING_RANKING_MODES) {
    const modePath = `${path}.${mode}`;
    const referenceRows = reference[mode];
    const rows = array(source[mode], modePath).map((entry, index): TransientEngineeringOfficialRankingRow => {
      const rowPath = `${modePath}[${index}]`;
      const item = record(entry, rowPath);
      expectExactKeys(item, [
        "rank", "shape", "landAreaM2", "activePvAreaM2", "netAcKWhYear",
        "kWhPerLandM2Year", "kWhPerPvM2Year", "layoutId", "status",
      ], rowPath);
      const shape = text(item.shape, `${rowPath}.shape`) as EngineeringValidationShape;
      if (!ENGINEERING_VALIDATION_SHAPES.includes(shape)) {
        throw new Error(`${rowPath}.shape is not a comparison shape.`);
      }
      const row = {
        rank: positiveInteger(item.rank, `${rowPath}.rank`),
        shape,
        landAreaM2: nonnegative(item.landAreaM2, `${rowPath}.landAreaM2`),
        activePvAreaM2: nonnegative(item.activePvAreaM2, `${rowPath}.activePvAreaM2`),
        netAcKWhYear: nonnegative(item.netAcKWhYear, `${rowPath}.netAcKWhYear`),
        kWhPerLandM2Year: nonnegative(item.kWhPerLandM2Year, `${rowPath}.kWhPerLandM2Year`),
        kWhPerPvM2Year: nonnegative(item.kWhPerPvM2Year, `${rowPath}.kWhPerPvM2Year`),
        layoutId: text(item.layoutId, `${rowPath}.layoutId`),
        status: text(item.status, `${rowPath}.status`),
      };
      if (row.status !== "official") throw new Error(`${rowPath}.status must be official.`);
      const expected = referenceRows[index];
      if (!expected || row.rank !== index + 1 || expected.rank !== row.rank
        || expected.shape !== row.shape || expected.landAreaM2 !== row.landAreaM2
        || expected.activePvAreaM2 !== row.activePvAreaM2
        || expected.netAcKWhYear !== row.netAcKWhYear
        || expected.kWhPerLandM2Year !== row.kWhPerLandM2Year
        || expected.kWhPerPvM2Year !== row.kWhPerPvM2Year
        || expected.electricalLayoutId !== row.layoutId) {
        throw new Error(`${rowPath} disagrees with its exact full-artifact ranking row.`);
      }
      return { ...row, status: "official" };
    });
    if (rows.length !== ENGINEERING_VALIDATION_SHAPES.length
      || referenceRows.length !== ENGINEERING_VALIDATION_SHAPES.length) {
      throw new Error(`${modePath} must contain six compact/full ranking rows.`);
    }
    expectCompleteShapeSet(rows.map((row) => row.shape), modePath);
    result[mode] = rows;
  }
  return result;
}

function parseMonth(value: unknown, path: string): TransientEngineeringMonth {
  const source = record(value, path);
  const result = {
    month: text(source.month, `${path}.month`),
    dcEnergyWh: nonnegative(source.dcEnergyWh, `${path}.dcEnergyWh`),
    idealLocalMppDcEnergyWh: nonnegative(source.idealLocalMppDcEnergyWh, `${path}.idealLocalMppDcEnergyWh`),
    mismatchAndWiringLossEnergyWh: nonnegative(source.mismatchAndWiringLossEnergyWh, `${path}.mismatchAndWiringLossEnergyWh`),
    grossAcEnergyWh: nonnegative(source.grossAcEnergyWh, `${path}.grossAcEnergyWh`),
    acEnergyWh: nonnegative(source.acEnergyWh, `${path}.acEnergyWh`),
    motorEnergyWh: nonnegative(source.motorEnergyWh, `${path}.motorEnergyWh`),
    absorbedSolarEnergyWh: nonnegative(source.absorbedSolarEnergyWh, `${path}.absorbedSolarEnergyWh`),
    bypassActivationDeviceHours: nonnegative(source.bypassActivationDeviceHours, `${path}.bypassActivationDeviceHours`),
  };
  if (!close(
    result.idealLocalMppDcEnergyWh - result.dcEnergyWh,
    result.mismatchAndWiringLossEnergyWh,
    1e-8,
  ) || result.dcEnergyWh > result.idealLocalMppDcEnergyWh + 1e-8
    || result.acEnergyWh > result.grossAcEnergyWh + 1e-8
    || result.acEnergyWh < Math.max(0, result.grossAcEnergyWh - result.motorEnergyWh) - 1e-8) {
    throw new Error(`${path} violates DC upper-bound/mismatch or interval-clipped AC bounds.`);
  }
  return result;
}

function validateCircuitTopology(
  value: unknown,
  path: string,
  connection: EngineeringMeshTopology,
  maximumCouplingStepSeconds: number,
): UnknownRecord {
  const source = record(value, path);
  const cellCount = positiveInteger(source.cellCount, `${path}.cellCount`);
  const parallelStringCount = positiveInteger(source.parallelStringCount, `${path}.parallelStringCount`);
  const seriesCellCountByString = array(source.seriesCellCountByString, `${path}.seriesCellCountByString`)
    .map((entry, index) => positiveInteger(entry, `${path}.seriesCellCountByString[${index}]`));
  const bypassSubstringCount = positiveInteger(source.bypassSubstringCount, `${path}.bypassSubstringCount`);
  const coupling = positiveInteger(source.maximumCouplingStepSeconds, `${path}.maximumCouplingStepSeconds`);
  const circuitSolveCount = positiveInteger(source.circuitSolveCount, `${path}.circuitSolveCount`);
  const closure = nonnegative(source.maximumElectricalExtractionClosureErrorW, `${path}.maximumElectricalExtractionClosureErrorW`);
  if (parallelStringCount !== connection.parallelStrings
    || seriesCellCountByString.length !== parallelStringCount
    || seriesCellCountByString.reduce((sum, count) => sum + count, 0) !== cellCount
    || bypassSubstringCount !== seriesCellCountByString.reduce(
      (sum, count) => sum + Math.ceil(count / connection.cellsPerBypassSubstring), 0,
    )
    || coupling > maximumCouplingStepSeconds || closure > 1e-8 || circuitSolveCount <= 0) {
    throw new Error(`${path} violates the shared connection/coupling/extraction contract.`);
  }
  return source;
}

function parseRankingRow(
  value: unknown,
  path: string,
  mode: "static" | "controlled" | "natural",
  year: number,
  landAreaM2: number,
  couplingStepSeconds: number,
  connection: EngineeringMeshTopology,
  expectedQuasiKWh: number,
): TransientEngineeringRankingRow {
  const source = record(value, path);
  const shape = text(source.shape, `${path}.shape`) as EngineeringValidationShape;
  if (!ENGINEERING_VALIDATION_SHAPES.includes(shape)) throw new Error(`${path}.shape is unsupported.`);
  const rankValue = source.rank;
  const rank = rankValue === null ? null : positiveInteger(rankValue, `${path}.rank`);
  const result: TransientEngineeringRankingRow = {
    rank,
    shape,
    landAreaM2: nonnegative(source.landAreaM2, `${path}.landAreaM2`),
    activePvAreaM2: nonnegative(source.activePvAreaM2, `${path}.activePvAreaM2`),
    pvLandRatio: nonnegative(source.pvLandRatio, `${path}.pvLandRatio`),
    dcKWhYear: nonnegative(source.dcKWhYear, `${path}.dcKWhYear`),
    idealLocalMppDcKWhYear: nonnegative(source.idealLocalMppDcKWhYear, `${path}.idealLocalMppDcKWhYear`),
    mismatchAndWiringLossKWhYear: nonnegative(source.mismatchAndWiringLossKWhYear, `${path}.mismatchAndWiringLossKWhYear`),
    grossAcKWhYear: nonnegative(source.grossAcKWhYear, `${path}.grossAcKWhYear`),
    motorKWhYear: nonnegative(source.motorKWhYear, `${path}.motorKWhYear`),
    netAcKWhYear: nonnegative(source.netAcKWhYear, `${path}.netAcKWhYear`),
    kWhPerLandM2Year: nonnegative(source.kWhPerLandM2Year, `${path}.kWhPerLandM2Year`),
    kWhPerPvM2Year: nonnegative(source.kWhPerPvM2Year, `${path}.kWhPerPvM2Year`),
    quasiSteadyEngineeringNetAcKWhYear: nonnegative(source.quasiSteadyEngineeringNetAcKWhYear, `${path}.quasiSteadyEngineeringNetAcKWhYear`),
    transientMinusQuasiSteadyKWhYear: finite(source.transientMinusQuasiSteadyKWhYear, `${path}.transientMinusQuasiSteadyKWhYear`),
    transientMinusQuasiSteadyFraction: finite(source.transientMinusQuasiSteadyFraction, `${path}.transientMinusQuasiSteadyFraction`),
    electricalLayoutId: text(source.electricalLayoutId, `${path}.electricalLayoutId`),
    topology: validateCircuitTopology(source.topology, `${path}.topology`, connection, couplingStepSeconds),
    monthly: array(source.monthly, `${path}.monthly`).map((entry, index) => parseMonth(entry, `${path}.monthly[${index}]`)),
    provenance: record(source.provenance, `${path}.provenance`),
  };
  if (result.landAreaM2 <= 0 || result.activePvAreaM2 <= 0
    || result.idealLocalMppDcKWhYear <= 0
    || !close(result.landAreaM2, landAreaM2)
    || !close(result.pvLandRatio, result.activePvAreaM2 / result.landAreaM2)
    || !close(result.kWhPerLandM2Year, result.netAcKWhYear / result.landAreaM2)
    || !close(result.kWhPerPvM2Year, result.netAcKWhYear / result.activePvAreaM2)
    || !close(result.idealLocalMppDcKWhYear - result.dcKWhYear, result.mismatchAndWiringLossKWhYear, 1e-8)
    || result.dcKWhYear > result.idealLocalMppDcKWhYear + 1e-8
    || result.netAcKWhYear > result.grossAcKWhYear + 1e-8
    || result.netAcKWhYear < Math.max(0, result.grossAcKWhYear - result.motorKWhYear) - 1e-8
    || !close(result.quasiSteadyEngineeringNetAcKWhYear, expectedQuasiKWh)
    || !close(result.transientMinusQuasiSteadyKWhYear, result.netAcKWhYear - expectedQuasiKWh)
    || !close(result.transientMinusQuasiSteadyFraction,
      (result.netAcKWhYear - expectedQuasiKWh) / Math.max(1e-12, Math.abs(expectedQuasiKWh)))) {
    throw new Error(`${path} contains inconsistent annual area/electrical/quasi-transient metrics.`);
  }
  const expectedMonths = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  if (result.monthly.length !== 12 || result.monthly.some((month, index) => month.month !== expectedMonths[index])) {
    throw new Error(`${path}.monthly must contain all ordered calendar months.`);
  }
  for (const [monthlyKey, annualKWh] of [
    ["dcEnergyWh", result.dcKWhYear],
    ["idealLocalMppDcEnergyWh", result.idealLocalMppDcKWhYear],
    ["mismatchAndWiringLossEnergyWh", result.mismatchAndWiringLossKWhYear],
    ["grossAcEnergyWh", result.grossAcKWhYear],
    ["acEnergyWh", result.netAcKWhYear],
    ["motorEnergyWh", result.motorKWhYear],
  ] as const) {
    if (!close(result.monthly.reduce((sum, month) => sum + month[monthlyKey], 0), annualKWh * 1_000)) {
      throw new Error(`${path}.monthly ${monthlyKey} does not sum to annual.`);
    }
  }
  const provenance = result.provenance;
  if (!/offline.*model-estimate/i.test(text(provenance.weatherSource, `${path}.provenance.weatherSource`))
    || !/actual 8760 intervals.*closing endpoint/i.test(text(provenance.timeResolution, `${path}.provenance.timeResolution`))
    || text(provenance.electricalModel, `${path}.provenance.electricalModel`) !== "explicit-series-parallel-bypass"
    || text(provenance.thermalModel, `${path}.provenance.thermalModel`) !== "annual-transient-material-state"
    || provenance.representativeDayScaling !== false
    || positiveInteger(provenance.couplingStepSeconds, `${path}.provenance.couplingStepSeconds`) !== couplingStepSeconds
    || text(provenance.officialStatus, `${path}.provenance.officialStatus`) !== "official") {
    throw new Error(`${path}.provenance does not identify the actual full-year official coupled path.`);
  }
  if (mode === "natural" && result.motorKWhYear !== 0) throw new Error(`${path} natural no-C_Q row must use zero motor energy.`);
  return result;
}

function validateCouplingConvergence(value: unknown): UnknownRecord {
  const path = "transientEngineering.couplingConvergence";
  const source = record(value, path);
  const stepsSeconds = array(source.stepsSeconds, `${path}.stepsSeconds`)
    .map((entry, index) => positiveInteger(entry, `${path}.stepsSeconds[${index}]`));
  if (stepsSeconds.length !== 3 || stepsSeconds.some((entry, index) => entry !== [3_600, 1_800, 900][index])) {
    throw new Error(`${path}.stepsSeconds must retain the predeclared 3600/1800/900 sequence.`);
  }
  const tolerance = finite(source.toleranceFraction, `${path}.toleranceFraction`);
  if (!close(tolerance, 0.02, 1e-12)) throw new Error(`${path}.toleranceFraction must remain 2%.`);
  const byShape = record(source.byShape, `${path}.byShape`);
  expectCompleteShapeSet(Object.keys(byShape), `${path}.byShape`);
  const shapePasses = ENGINEERING_VALIDATION_SHAPES.map((shape) => {
    const shapePath = `${path}.byShape.${shape}`;
    const entry = record(byShape[shape], shapePath);
    const levels = array(entry.levels, `${shapePath}.levels`).map((level, index) => {
      const levelPath = `${shapePath}.levels[${index}]`;
      const item = record(level, levelPath);
      const layoutIds = stringArray(item.layoutIds, `${levelPath}.layoutIds`);
      const layoutInvariant = layoutIds.length > 0 && new Set(layoutIds).size === 1;
      if (bool(item.layoutInvariant, `${levelPath}.layoutInvariant`) !== layoutInvariant) {
        throw new Error(`${levelPath}.layoutInvariant disagrees with layoutIds.`);
      }
      return {
        stepSeconds: positiveInteger(item.stepSeconds, `${levelPath}.stepSeconds`),
        actualClockHours: finite(item.actualClockHours, `${levelPath}.actualClockHours`),
        netAcEnergyWh: nonnegative(item.netAcEnergyWh, `${levelPath}.netAcEnergyWh`),
        dcEnergyWh: nonnegative(item.dcEnergyWh, `${levelPath}.dcEnergyWh`),
        averageTemperatureC: finite(item.averageTemperatureC, `${levelPath}.averageTemperatureC`),
        layoutIds,
        layoutInvariant,
        maximumExtractionClosureErrorW: nonnegative(item.maximumExtractionClosureErrorW, `${levelPath}.maximumExtractionClosureErrorW`),
        maximumHeatResidualFraction: nonnegative(item.maximumHeatResidualFraction, `${levelPath}.maximumHeatResidualFraction`),
        elapsedMs: nonnegative(item.elapsedMs, `${levelPath}.elapsedMs`),
      };
    });
    if (levels.length !== stepsSeconds.length || levels.some((level, index) =>
      level.stepSeconds !== stepsSeconds[index] || level.actualClockHours !== 96
        || !level.layoutInvariant || level.maximumExtractionClosureErrorW > 1e-8
        || level.maximumHeatResidualFraction > 1e-8)
      || new Set(levels.flatMap((level) => level.layoutIds)).size !== 1) {
      throw new Error(`${shapePath} does not retain one layout across three closed 96-hour coupling fixtures.`);
    }
    const deltas = array(entry.consecutiveDeltas, `${shapePath}.consecutiveDeltas`).map((delta, index) => {
      const deltaPath = `${shapePath}.consecutiveDeltas[${index}]`;
      const item = record(delta, deltaPath);
      const coarse = levels[index];
      const fine = levels[index + 1];
      const energyDelta = finite(item.relativeNetAcDifference, `${deltaPath}.relativeNetAcDifference`);
      const temperatureDelta = finite(item.averageTemperatureDifferenceC, `${deltaPath}.averageTemperatureDifferenceC`);
      if (positiveInteger(item.fromStepSeconds, `${deltaPath}.fromStepSeconds`) !== coarse.stepSeconds
        || positiveInteger(item.toStepSeconds, `${deltaPath}.toStepSeconds`) !== fine.stepSeconds
        || !close(energyDelta, relativeDifference(fine.netAcEnergyWh, coarse.netAcEnergyWh))
        || !close(temperatureDelta, Math.abs(fine.averageTemperatureC - coarse.averageTemperatureC))) {
        throw new Error(`${deltaPath} disagrees with adjacent coupling levels.`);
      }
      return energyDelta;
    });
    const calculatedPass = deltas.length === 2 && deltas.every((delta) => delta <= tolerance);
    const pass = bool(entry.pass, `${shapePath}.pass`);
    if (pass !== calculatedPass) throw new Error(`${shapePath}.pass disagrees with consecutive coupling deltas.`);
    return pass;
  });
  if (!shapePasses.every(Boolean) || bool(source.pass, `${path}.pass`) !== shapePasses.every(Boolean)) {
    throw new Error(`${path}.pass must require all six shapes.`);
  }
  return source;
}

function validateThermalMeshConvergence(value: unknown): UnknownRecord {
  const path = "transientEngineering.thermalMeshConvergence";
  const source = record(value, path);
  const nodeCounts = array(source.nodeCounts, `${path}.nodeCounts`)
    .map((entry, index) => positiveInteger(entry, `${path}.nodeCounts[${index}]`));
  if (nodeCounts.length !== 3 || nodeCounts.some((entry, index) => entry !== [3, 6, 12][index])) {
    throw new Error(`${path}.nodeCounts must retain the 3/6/12 convergence sequence.`);
  }
  const energyTolerance = finite(source.energyToleranceFraction, `${path}.energyToleranceFraction`);
  const temperatureTolerance = finite(source.temperatureToleranceC, `${path}.temperatureToleranceC`);
  if (!close(energyTolerance, 0.01, 1e-12) || !close(temperatureTolerance, 0.2, 1e-12)) {
    throw new Error(`${path} must retain its 1% energy / 0.2 C temperature gate.`);
  }
  const byShape = record(source.byShape, `${path}.byShape`);
  expectCompleteShapeSet(Object.keys(byShape), `${path}.byShape`);
  const shapePasses = ENGINEERING_VALIDATION_SHAPES.map((shape) => {
    const shapePath = `${path}.byShape.${shape}`;
    const entry = record(byShape[shape], shapePath);
    const levels = array(entry.levels, `${shapePath}.levels`).map((level, index) => {
      const levelPath = `${shapePath}.levels[${index}]`;
      const item = record(level, levelPath);
      const layoutIds = stringArray(item.layoutIds, `${levelPath}.layoutIds`);
      const layoutInvariant = layoutIds.length > 0 && new Set(layoutIds).size === 1;
      if (bool(item.layoutInvariant, `${levelPath}.layoutInvariant`) !== layoutInvariant) {
        throw new Error(`${levelPath}.layoutInvariant disagrees with layoutIds.`);
      }
      return {
        requestedNodeCount: positiveInteger(item.requestedNodeCount, `${levelPath}.requestedNodeCount`),
        actualClockHours: finite(item.actualClockHours, `${levelPath}.actualClockHours`),
        netAcEnergyWh: nonnegative(item.netAcEnergyWh, `${levelPath}.netAcEnergyWh`),
        averageTemperatureC: finite(item.averageTemperatureC, `${levelPath}.averageTemperatureC`),
        layoutIds,
        layoutInvariant,
        maximumExtractionClosureErrorW: nonnegative(item.maximumExtractionClosureErrorW, `${levelPath}.maximumExtractionClosureErrorW`),
        maximumHeatResidualFraction: nonnegative(item.maximumHeatResidualFraction, `${levelPath}.maximumHeatResidualFraction`),
        elapsedMs: nonnegative(item.elapsedMs, `${levelPath}.elapsedMs`),
      };
    });
    const allLayouts = new Set(levels.flatMap((level) => level.layoutIds));
    const layoutInvariantAcrossLevels = allLayouts.size === 1;
    if (bool(entry.layoutInvariantAcrossLevels, `${shapePath}.layoutInvariantAcrossLevels`) !== layoutInvariantAcrossLevels
      || levels.length !== nodeCounts.length || levels.some((level, index) =>
        level.requestedNodeCount !== nodeCounts[index] || level.actualClockHours !== 96
          || !level.layoutInvariant || level.maximumExtractionClosureErrorW > 1e-8
          || level.maximumHeatResidualFraction > 1e-8)) {
      throw new Error(`${shapePath} thermal levels do not retain clock/layout/residual invariants.`);
    }
    const deltas = array(entry.consecutiveDeltas, `${shapePath}.consecutiveDeltas`).map((delta, index) => {
      const deltaPath = `${shapePath}.consecutiveDeltas[${index}]`;
      const item = record(delta, deltaPath);
      const coarse = levels[index];
      const fine = levels[index + 1];
      const energyDelta = finite(item.relativeNetAcDifference, `${deltaPath}.relativeNetAcDifference`);
      const temperatureDelta = finite(item.averageTemperatureDifferenceC, `${deltaPath}.averageTemperatureDifferenceC`);
      if (positiveInteger(item.fromNodeCount, `${deltaPath}.fromNodeCount`) !== coarse.requestedNodeCount
        || positiveInteger(item.toNodeCount, `${deltaPath}.toNodeCount`) !== fine.requestedNodeCount
        || !close(energyDelta, relativeDifference(fine.netAcEnergyWh, coarse.netAcEnergyWh))
        || !close(temperatureDelta, Math.abs(fine.averageTemperatureC - coarse.averageTemperatureC))) {
        throw new Error(`${deltaPath} disagrees with adjacent thermal mesh levels.`);
      }
      return { energyDelta, temperatureDelta };
    });
    const calculatedPass = layoutInvariantAcrossLevels && deltas.length === 2
      && deltas.every((delta) => delta.energyDelta <= energyTolerance
        && delta.temperatureDelta <= temperatureTolerance);
    const pass = bool(entry.pass, `${shapePath}.pass`);
    if (pass !== calculatedPass) throw new Error(`${shapePath}.pass disagrees with thermal deltas.`);
    return pass;
  });
  if (!shapePasses.every(Boolean) || bool(source.pass, `${path}.pass`) !== shapePasses.every(Boolean)) {
    throw new Error(`${path}.pass must require all six shapes.`);
  }
  return source;
}

function validateShortFactorial(value: unknown): UnknownRecord {
  const path = "transientEngineering.shortFactorialDecomposition";
  const source = record(value, path);
  const contract = text(source.contract, `${path}.contract`);
  if (!/actual-clock.*never annual-scaled/i.test(contract)) {
    throw new Error(`${path}.contract must identify actual-clock, never-annual-scaled evidence.`);
  }
  const byShape = record(source.byShape, `${path}.byShape`);
  expectCompleteShapeSet(Object.keys(byShape), `${path}.byShape`);
  for (const shape of ENGINEERING_VALIDATION_SHAPES) {
    const shapePath = `${path}.byShape.${shape}`;
    const entry = record(byShape[shape], shapePath);
    if (finite(entry.actualClockHours, `${shapePath}.actualClockHours`) !== 96) {
      throw new Error(`${shapePath} must cover four closed 24-hour histories.`);
    }
    const casesSource = record(entry.cases, `${shapePath}.cases`);
    const caseNames = ["e00", "e10", "e01", "e11"] as const;
    if (Object.keys(casesSource).length !== caseNames.length
      || caseNames.some((name) => !(name in casesSource))) {
      throw new Error(`${shapePath}.cases must contain E00/E10/E01/E11 exactly.`);
    }
    const cases = Object.fromEntries(caseNames.map((name) => {
      const casePath = `${shapePath}.cases.${name}`;
      const item = record(casesSource[name], casePath);
      const parsed = {
        dcEnergyWh: nonnegative(item.dcEnergyWh, `${casePath}.dcEnergyWh`),
        idealLocalMppDcEnergyWh: nonnegative(item.idealLocalMppDcEnergyWh, `${casePath}.idealLocalMppDcEnergyWh`),
        mismatchAndWiringLossEnergyWh: nonnegative(item.mismatchAndWiringLossEnergyWh, `${casePath}.mismatchAndWiringLossEnergyWh`),
        grossAcEnergyWh: nonnegative(item.grossAcEnergyWh, `${casePath}.grossAcEnergyWh`),
        motorEnergyWh: nonnegative(item.motorEnergyWh, `${casePath}.motorEnergyWh`),
        netAcEnergyWh: nonnegative(item.netAcEnergyWh, `${casePath}.netAcEnergyWh`),
        bypassActivationDeviceHours: nonnegative(item.bypassActivationDeviceHours, `${casePath}.bypassActivationDeviceHours`),
      };
      if (!close(parsed.idealLocalMppDcEnergyWh - parsed.dcEnergyWh, parsed.mismatchAndWiringLossEnergyWh, 1e-8)
        || parsed.dcEnergyWh > parsed.idealLocalMppDcEnergyWh + 1e-8
        || parsed.netAcEnergyWh > parsed.grossAcEnergyWh + 1e-8
        || parsed.netAcEnergyWh < Math.max(0, parsed.grossAcEnergyWh - parsed.motorEnergyWh) - 1e-8) {
        throw new Error(`${casePath} violates DC mismatch or interval-clipped motor bounds.`);
      }
      return [name, parsed];
    })) as Record<(typeof caseNames)[number], {
      dcEnergyWh: number; idealLocalMppDcEnergyWh: number; mismatchAndWiringLossEnergyWh: number;
      grossAcEnergyWh: number; motorEnergyWh: number; netAcEnergyWh: number;
      bypassActivationDeviceHours: number;
    }>;
    const decomposition = record(entry.decomposition, `${shapePath}.decomposition`);
    const opticalWh = finite(decomposition.opticalWh, `${shapePath}.decomposition.opticalWh`);
    const thermalWh = finite(decomposition.thermalWh, `${shapePath}.decomposition.thermalWh`);
    const interactionWh = finite(decomposition.interactionWh, `${shapePath}.decomposition.interactionWh`);
    const netWh = finite(decomposition.netWh, `${shapePath}.decomposition.netWh`);
    const closureResidualWh = finite(decomposition.closureResidualWh, `${shapePath}.decomposition.closureResidualWh`);
    if (!close(opticalWh, cases.e10.netAcEnergyWh - cases.e00.netAcEnergyWh)
      || !close(thermalWh, cases.e01.netAcEnergyWh - cases.e00.netAcEnergyWh)
      || !close(interactionWh, cases.e11.netAcEnergyWh - cases.e10.netAcEnergyWh
        - cases.e01.netAcEnergyWh + cases.e00.netAcEnergyWh)
      || !close(netWh, cases.e11.netAcEnergyWh - cases.e00.netAcEnergyWh)
      || Math.abs(closureResidualWh) > 1e-8
      || Math.abs(opticalWh + thermalWh + interactionWh - netWh) > 1e-8) {
      throw new Error(`${shapePath} E00/E10/E01/E11 decomposition does not close.`);
    }
    const layoutIds = stringArray(entry.layoutIds, `${shapePath}.layoutIds`);
    const layoutInvariant = layoutIds.length > 0 && new Set(layoutIds).size === 1;
    const heatResidual = nonnegative(entry.maximumHeatResidualFraction, `${shapePath}.maximumHeatResidualFraction`);
    const extractionResidual = nonnegative(entry.maximumExtractionClosureErrorW, `${shapePath}.maximumExtractionClosureErrorW`);
    const closurePass = layoutInvariant && heatResidual <= 1e-8 && extractionResidual <= 1e-8
      && Math.abs(closureResidualWh) <= 1e-8;
    if (bool(entry.layoutInvariant, `${shapePath}.layoutInvariant`) !== layoutInvariant
      || bool(entry.closurePass, `${shapePath}.closurePass`) !== closurePass) {
      throw new Error(`${shapePath} closure/layout pass disagrees with numeric evidence.`);
    }
    nonnegative(entry.elapsedMs, `${shapePath}.elapsedMs`);
  }
  return source;
}

function annualGroupValue(
  annualArtifact: UnknownRecord,
  groupId: string,
  shape: EngineeringValidationShape,
): number {
  const groups = array(annualArtifact.groups, "idealAnnual.groups").map((entry, index) =>
    record(entry, `idealAnnual.groups[${index}]`));
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) throw new Error(`Ideal annual artifact is missing ${groupId}.`);
  const rows = array(group.rows, `idealAnnual.${groupId}.rows`).map((entry, index) =>
    record(entry, `idealAnnual.${groupId}.rows[${index}]`));
  const row = rows.find((entry) => entry.shape === shape);
  if (!row) throw new Error(`Ideal annual artifact ${groupId} is missing ${shape}.`);
  return nonnegative(row.acKWhYear, `idealAnnual.${groupId}.${shape}.acKWhYear`);
}

function validateBaselineRegression(
  value: unknown,
  rootDir: string,
  annualArtifact: UnknownRecord,
  currentIdealSha256: string,
): UnknownRecord {
  const path = "transientEngineering.baselineRegression";
  const source = record(value, path);
  const tolerance = finite(source.toleranceFraction, `${path}.toleranceFraction`);
  if (tolerance <= 0 || tolerance > 0.001) throw new Error(`${path} tolerance must not exceed 0.1%.`);
  const fixturePath = text(source.fixturePath, `${path}.fixturePath`);
  const fixtureSha = sha256(source.fixtureSha256, `${path}.fixtureSha256`);
  if (fixtureSha !== fileSha256(rootDir, fixturePath, "baseline fixture")) {
    throw new Error(`${path}.fixtureSha256 disagrees with current fixture bytes.`);
  }
  const fixture = readJson(rootDir, fixturePath, "baseline fixture");
  const baselineCommit = text(source.baselineCommit, `${path}.baselineCommit`);
  if (baselineCommit !== "d9ff14abc6c4bec6217ca38ef45f1f499377d83c"
    || text(fixture.baselineCommit, "baselineFixture.baselineCommit") !== baselineCommit
    || sha256(source.sourceArtifactSha256AtBaseline, `${path}.sourceArtifactSha256AtBaseline`)
      !== sha256(fixture.sourceArtifactSha256AtBaseline, "baselineFixture.sourceArtifactSha256AtBaseline")
    || sha256(source.currentIdealArtifactSha256, `${path}.currentIdealArtifactSha256`) !== currentIdealSha256) {
    throw new Error(`${path} does not bind the requested d9ff14a fixture/current ideal artifact.`);
  }
  const annualConditions = record(annualArtifact.conditions, "idealAnnual.conditions");
  for (const [sourceKey, fixtureKey] of [
    ["baselineConfigurationFingerprint", "configurationFingerprint"],
    ["baselineImplementationFingerprint", "implementationFingerprint"],
  ] as const) {
    if (sha256(source[sourceKey], `${path}.${sourceKey}`)
      !== sha256(fixture[fixtureKey], `baselineFixture.${fixtureKey}`)) {
      throw new Error(`${path}.${sourceKey} disagrees with the baseline fixture.`);
    }
  }
  for (const key of ["configurationFingerprint", "implementationFingerprint"] as const) {
    const sourceKey = key === "configurationFingerprint"
      ? "currentConfigurationFingerprint" : "currentImplementationFingerprint";
    if (sha256(source[sourceKey], `${path}.${sourceKey}`)
      !== sha256(annualConditions[key], `idealAnnual.conditions.${key}`)) {
      throw new Error(`${path}.${sourceKey} disagrees with the current annual artifact.`);
    }
  }
  const baselineStatic = record(fixture.staticLandMatchedAcKWhYear, "baselineFixture.staticLandMatchedAcKWhYear");
  const baselineControlled = record(fixture.controlledMotorNetAcKWhYear, "baselineFixture.controlledMotorNetAcKWhYear");
  const byShape = record(source.byShape, `${path}.byShape`);
  expectCompleteShapeSet(Object.keys(byShape), `${path}.byShape`);
  const allPass = ENGINEERING_VALIDATION_SHAPES.every((shape) => {
    const shapePath = `${path}.byShape.${shape}`;
    const entry = record(byShape[shape], shapePath);
    return ([
      ["static", baselineStatic, "transient-static-land-matched:local-mpp-area-integral"],
      ["controlled", baselineControlled, "transient-controlled-motor-net:local-mpp-area-integral"],
    ] as const).every(([mode, baselineRecord, groupId]) => {
      const modePath = `${shapePath}.${mode}`;
      const comparison = record(entry[mode], modePath);
      const baseline = nonnegative(comparison.baselineKWhYear, `${modePath}.baselineKWhYear`);
      const current = nonnegative(comparison.currentKWhYear, `${modePath}.currentKWhYear`);
      const difference = finite(comparison.relativeDifference, `${modePath}.relativeDifference`);
      const calculated = relativeDifference(current, baseline);
      const pass = bool(comparison.pass, `${modePath}.pass`);
      if (!close(baseline, nonnegative(baselineRecord[shape], `baselineFixture.${mode}.${shape}`))
        || !close(current, annualGroupValue(annualArtifact, groupId, shape))
        || !close(difference, calculated) || pass !== (calculated <= tolerance)) {
        throw new Error(`${modePath} disagrees with immutable/current artifacts and tolerance.`);
      }
      return pass;
    });
  });
  if (bool(source.pass, `${path}.pass`) !== allPass || !allPass) {
    throw new Error(`${path}.pass must require both d9ff14a comparisons for all six shapes.`);
  }
  return source;
}

function validateThermalModelComparison(value: unknown, year: number, meshAudit: EngineeringMeshAudit): {
  source: UnknownRecord;
  netKWhByMode: Record<"static" | "controlled" | "natural", Record<EngineeringValidationShape, number>>;
} {
  const path = "transientEngineering.thermalModelComparison";
  const source = record(value, path);
  if (!/same geometry.*actual 8760-hour.*engineering connection/i.test(text(source.contract, `${path}.contract`))) {
    throw new Error(`${path}.contract must isolate the physical thermal-model change.`);
  }
  const quasiModel = record(source.quasiSteadyModel, `${path}.quasiSteadyModel`);
  const transientModel = record(source.transientModel, `${path}.transientModel`);
  if (text(quasiModel.model, `${path}.quasiSteadyModel.model`) !== "quasi-steady-faiman"
    || text(quasiModel.periodIntegration, `${path}.quasiSteadyModel.periodIntegration`) !== "pointwise-quasi-steady"
    || Object.keys(record(quasiModel.config, `${path}.quasiSteadyModel.config`)).length === 0
    || text(transientModel.model, `${path}.transientModel.model`) !== "annual-transient-material-state"
    || text(transientModel.periodIntegration, `${path}.transientModel.periodIntegration`) !== "actual-weather-clock"
    || Object.keys(record(transientModel.config, `${path}.transientModel.config`)).length === 0) {
    throw new Error(`${path} thermal model metadata is incomplete or inconsistent.`);
  }
  const netKWhByMode = {} as Record<"static" | "controlled" | "natural", Record<EngineeringValidationShape, number>>;
  for (const mode of ["static", "controlled", "natural"] as const) {
    const modePath = `${path}.${mode}`;
    const byShape = record(source[mode], modePath);
    expectCompleteShapeSet(Object.keys(byShape), modePath);
    netKWhByMode[mode] = {} as Record<EngineeringValidationShape, number>;
    for (const shape of ENGINEERING_VALIDATION_SHAPES) {
      const shapePath = `${modePath}.${shape}`;
      const item = record(byShape[shape], shapePath);
      if (text(item.shape, `${shapePath}.shape`) !== shape
        || text(item.geometryContract, `${shapePath}.geometryContract`) !== (mode === "controlled"
          ? "swept-rotation-envelope" : "static-land-matched")
        || text(item.thermalModel, `${shapePath}.thermalModel`) !== "quasi-steady-faiman"
        || text(item.periodIntegration, `${shapePath}.periodIntegration`) !== "pointwise-quasi-steady"
        || text(item.electricalModel, `${shapePath}.electricalModel`) !== "explicit-series-parallel-bypass") {
        throw new Error(`${shapePath} is not the same-contract quasi-steady engineering path.`);
      }
      const layoutId = text(item.electricalLayoutId, `${shapePath}.electricalLayoutId`);
      const contractId = mode === "controlled" ? "swept-rotation-envelope" : "static-land-matched";
      const expectedMeshShape = meshAudit.geometryContracts
        .find((contract) => contract.contractId === contractId)?.shapes
        .find((meshShape) => meshShape.shape === shape);
      if (!expectedMeshShape || layoutId !== expectedMeshShape.layoutId) {
        throw new Error(`${shapePath} layout is not certified by ${contractId}.`);
      }
      const dcWh = nonnegative(item.dcEnergyWh, `${shapePath}.dcEnergyWh`);
      const grossWh = nonnegative(item.grossAcEnergyWh, `${shapePath}.grossAcEnergyWh`);
      const motorWh = nonnegative(item.motorEnergyWh, `${shapePath}.motorEnergyWh`);
      const netWh = nonnegative(item.netAcEnergyWh, `${shapePath}.netAcEnergyWh`);
      if (netWh > grossWh + 1e-8 || netWh < Math.max(0, grossWh - motorWh) - 1e-8) {
        throw new Error(`${shapePath} violates interval-clipped motor bounds.`);
      }
      const coverage = record(item.coverage, `${shapePath}.coverage`);
      if (positiveInteger(coverage.points, `${shapePath}.coverage.points`) !== 8_761
        || positiveInteger(coverage.intervals, `${shapePath}.coverage.intervals`) !== 8_760
        || finite(coverage.durationHours, `${shapePath}.coverage.durationHours`) !== 8_760
        || coverage.closingEndpointPresent !== true) {
        throw new Error(`${shapePath} is not an actual closed 8760-hour calculation.`);
      }
      const months = array(item.monthly, `${shapePath}.monthly`).map((entry, index) => {
        const monthPath = `${shapePath}.monthly[${index}]`;
        const month = record(entry, monthPath);
        return {
          month: text(month.month, `${monthPath}.month`),
          dcWh: nonnegative(month.dcEnergyWh, `${monthPath}.dcEnergyWh`),
          grossWh: nonnegative(month.grossAcEnergyWh, `${monthPath}.grossAcEnergyWh`),
          motorWh: nonnegative(month.motorEnergyWh, `${monthPath}.motorEnergyWh`),
          netWh: nonnegative(month.netAcEnergyWh, `${monthPath}.netAcEnergyWh`),
        };
      });
      const expectedMonths = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
      if (months.length !== 12 || months.some((month, index) => month.month !== expectedMonths[index])
        || !close(months.reduce((sum, month) => sum + month.dcWh, 0), dcWh)
        || !close(months.reduce((sum, month) => sum + month.grossWh, 0), grossWh)
        || !close(months.reduce((sum, month) => sum + month.motorWh, 0), motorWh)
        || !close(months.reduce((sum, month) => sum + month.netWh, 0), netWh)
        || bool(item.validationPass, `${shapePath}.validationPass`) !== true) {
        throw new Error(`${shapePath} monthly/quasi validation evidence does not close.`);
      }
      nonnegative(item.elapsedMs, `${shapePath}.elapsedMs`);
      netKWhByMode[mode][shape] = netWh / 1_000;
      if (mode === "natural") {
        const staticItem = record(record(source.static, `${path}.static`)[shape], `${path}.static.${shape}`);
        if (layoutId !== text(staticItem.electricalLayoutId, `${path}.static.${shape}.electricalLayoutId`)
          || netWh !== finite(staticItem.netAcEnergyWh, `${path}.static.${shape}.netAcEnergyWh`)) {
          throw new Error(`${shapePath} natural no-C_Q result must exactly reuse stationary quasi output.`);
        }
      }
    }
  }
  if (bool(source.pass, `${path}.pass`) !== true) throw new Error(`${path}.pass must cover all 18 cases.`);
  return { source, netKWhByMode };
}

function validateWorkerParity(value: unknown): UnknownRecord {
  const path = "transientEngineering.workerFullYearParity";
  const source = record(value, path);
  if (text(source.shape, `${path}.shape`) !== "cylinder"
    || finite(source.actualClockHours, `${path}.actualClockHours`) !== 8_760
    || bool(source.layoutInvariant, `${path}.layoutInvariant`) !== true
    || bool(source.annualParity, `${path}.annualParity`) !== true
    || bool(source.monthlyParity, `${path}.monthlyParity`) !== true
    || bool(source.ledgerParity, `${path}.ledgerParity`) !== true
    || nonnegative(source.maximumAbsoluteDifferenceWh, `${path}.maximumAbsoluteDifferenceWh`) > 1e-8
    || bool(source.pass, `${path}.pass`) !== true) {
    throw new Error(`${path} does not prove direct-core/Worker annual, monthly, and ledger parity.`);
  }
  nonnegative(source.elapsedMs, `${path}.elapsedMs`);
  return source;
}

const COMBINED_REQUIRED_IMPLEMENTATION_FILES = Object.freeze([
  "scripts/audit-transient-engineering-full-year.ts",
  "src/lib/physics/annual-transient.ts",
  "src/lib/physics/circuit.ts",
  "src/lib/physics/engineering-surface-electrical.ts",
  "src/lib/physics/transient-thermal.ts",
  "src/workers/kernel.ts",
  "src/workers/protocol.ts",
] as const);

export const TRANSIENT_ENGINEERING_ARTIFACT_PATH = "docs/transient-engineering-full-year-audit-2026.json";
export const TRANSIENT_ENGINEERING_GATE_PATH = "src/lib/physics/transient-engineering-validation.generated.json";

type CombinedResolution = {
  azimuthSamples: number;
  meridionalSegments: number;
  phaseSamples: number;
  circuitSamples: number;
};

export type TransientEngineeringGate = {
  schemaVersion: 1;
  generatedAtUtc: string;
  status: "pass";
  artifactSchemaVersion: 1;
  artifactPath: typeof TRANSIENT_ENGINEERING_ARTIFACT_PATH;
  artifactSha256: string;
  meshAuditPath: string;
  meshAuditSha256: string;
  thermalAuditPath: string;
  thermalAuditSha256: string;
  implementationSha256: string;
  configurationSha256: string;
  year: number;
  coverage: { points: number; intervals: number; durationHours: number; closingEndpointPresent: true };
  geometryContracts: Array<{
    contractId: "static-land-matched" | "swept-rotation-envelope";
    footprintMode: "static" | "swept";
    rotationModel: "stationary-rpm0" | "controlled-y-axis-phase-quadrature";
    phaseGateRequired: boolean;
    validatedResolution: CombinedResolution;
    layoutIdByShape: Record<EngineeringValidationShape, string>;
    pass: true;
    officialEligible: true;
  }>;
  validatedMinimumResolution: Record<
    "static-land-matched" | "swept-rotation-envelope",
    Record<EngineeringValidationShape, CombinedResolution>
  >;
  validatedCoupledSettings: {
    thermalNodeCount: 6;
    maximumThermalSubstepSeconds: 900;
    maximumElectricalCouplingStepSeconds: 900;
    couplingConvergenceToleranceFraction: 0.02;
    thermalMeshEnergyToleranceFraction: 0.01;
    thermalMeshTemperatureToleranceC: 0.2;
    maximumElectricalExtractionClosureErrorW: 1e-8;
    maximumHeatEnergyResidualFraction: 1e-8;
  };
  certifiedFixture: TransientEngineeringCertifiedFixture;
  officialRankings: Record<TransientEngineeringRankingMode, TransientEngineeringOfficialRankingRow[]>;
  layoutVersion: string;
  officialRankingEligible: true;
};

function combinedResolution(value: unknown, path: string): CombinedResolution {
  const source = record(value, path);
  expectExactKeys(source, ["azimuthSamples", "meridionalSegments", "phaseSamples", "circuitSamples"], path);
  return {
    azimuthSamples: positiveInteger(source.azimuthSamples, `${path}.azimuthSamples`),
    meridionalSegments: positiveInteger(source.meridionalSegments, `${path}.meridionalSegments`),
    phaseSamples: positiveInteger(source.phaseSamples, `${path}.phaseSamples`),
    circuitSamples: positiveInteger(source.circuitSamples, `${path}.circuitSamples`),
  };
}

function sameCombinedResolution(left: CombinedResolution, right: CombinedResolution): boolean {
  return Object.keys(left).every((key) => left[key as keyof CombinedResolution] === right[key as keyof CombinedResolution]);
}

export function validateTransientEngineeringAudit(
  value: unknown,
  meshAudit: EngineeringMeshAudit,
  rootDir = process.cwd(),
): TransientEngineeringAudit {
  const source = record(value, "transientEngineering");
  expectExactKeys(source, [
    "schemaVersion", "generatedAtUtc", "verdict", "officialRankingEligible", "blockingReasons", "conditions",
    "certifiedFixture", "provenance", "resolution", "coverage", "unsupportedMatrix", "baselineRegression", "couplingConvergence",
    "thermalMeshConvergence", "thermalModelComparison", "workerFullYearParity", "rankings",
    "shortFactorialDecomposition", "deterministicReplay", "runtime",
  ], "transientEngineering");
  if (source.schemaVersion !== 1) throw new Error("transientEngineering.schemaVersion must be 1.");
  const generatedAtUtc = text(source.generatedAtUtc, "transientEngineering.generatedAtUtc");
  if (!Number.isFinite(Date.parse(generatedAtUtc))) throw new Error("transientEngineering.generatedAtUtc is invalid.");
  if (text(source.verdict, "transientEngineering.verdict") !== "pass"
    || bool(source.officialRankingEligible, "transientEngineering.officialRankingEligible") !== true
    || array(source.blockingReasons, "transientEngineering.blockingReasons").length !== 0) {
    throw new Error("transientEngineering official report must be pass/eligible with no blocking reasons.");
  }
  if (!meshAudit.pass || !meshAudit.officialRankingEligible) {
    throw new Error("transientEngineering cannot be official when the mesh audit is not official/pass.");
  }
  const certifiedFixture = validateCertifiedFixture(
    source.certifiedFixture,
    "transientEngineering.certifiedFixture",
  );
  const conditions = record(source.conditions, "transientEngineering.conditions");
  const year = positiveInteger(conditions.year, "transientEngineering.conditions.year");
  const expectedHours = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000;
  const landAreaM2 = nonnegative(conditions.landAreaM2, "transientEngineering.conditions.landAreaM2");
  if (landAreaM2 <= 0 || nonnegative(conditions.maximumHeightM, "transientEngineering.conditions.maximumHeightM") <= 0
    || nonnegative(conditions.controlledRpm, "transientEngineering.conditions.controlledRpm") <= 0
    || !/absent.*0 RPM/i.test(text(conditions.naturalCq, "transientEngineering.conditions.naturalCq"))
    || text(conditions.reflector, "transientEngineering.conditions.reflector") !== "none"
    || text(conditions.obstacles, "transientEngineering.conditions.obstacles") !== "none") {
    throw new Error("transientEngineering conditions violate the fair controlled/natural comparison contract.");
  }
  if (year !== certifiedFixture.year
    || landAreaM2 !== certifiedFixture.geometry.landAreaM2
    || conditions.maximumHeightM !== certifiedFixture.geometry.maximumHeightM
    || conditions.planeTiltDeg !== certifiedFixture.geometry.planeTiltDeg
    || conditions.controlledRpm !== certifiedFixture.controlledRotation.rpm
    || conditions.albedo !== certifiedFixture.optics.albedo
    || conditions.reflector !== certifiedFixture.optics.reflector
    || conditions.obstacles !== certifiedFixture.optics.obstacles) {
    throw new Error("transientEngineering conditions disagree with the certified fixture.");
  }
  expectExactContract(
    conditions.controlledMotor,
    certifiedFixture.controlledRotation.motor,
    "transientEngineering.conditions.controlledMotor",
  );

  const provenance = record(source.provenance, "transientEngineering.provenance");
  if (text(provenance.weatherSource, "transientEngineering.provenance.weatherSource")
      !== certifiedFixture.weather.source
    || text(provenance.weatherSeed, "transientEngineering.provenance.weatherSeed")
      !== certifiedFixture.weather.seed) {
    throw new Error("transientEngineering weather provenance disagrees with the certified offline fixture.");
  }
  const idealAuditPath = text(provenance.idealAuditPath, "transientEngineering.provenance.idealAuditPath");
  const idealAuditSha256 = sha256(provenance.idealAuditSha256, "transientEngineering.provenance.idealAuditSha256");
  const meshAuditPath = text(provenance.meshAuditPath, "transientEngineering.provenance.meshAuditPath");
  const meshAuditSha256 = sha256(provenance.meshAuditSha256, "transientEngineering.provenance.meshAuditSha256");
  const thermalAuditPath = text(provenance.thermalAuditPath, "transientEngineering.provenance.thermalAuditPath");
  const thermalAuditSha256 = sha256(provenance.thermalAuditSha256, "transientEngineering.provenance.thermalAuditSha256");
  if (idealAuditSha256 !== fileSha256(rootDir, idealAuditPath, "ideal annual audit")
    || meshAuditSha256 !== fileSha256(rootDir, meshAuditPath, "engineering mesh audit")
    || thermalAuditSha256 !== fileSha256(rootDir, thermalAuditPath, "transient thermal audit")
    || bool(provenance.meshConvergencePass, "transientEngineering.provenance.meshConvergencePass") !== true
    || bool(provenance.thermalAuditPass, "transientEngineering.provenance.thermalAuditPass") !== true) {
    throw new Error("transientEngineering artifact SHA/pass provenance is stale or inconsistent.");
  }
  const meshGeometryContracts = array(
    provenance.meshGeometryContracts,
    "transientEngineering.provenance.meshGeometryContracts",
  );
  if (meshGeometryContracts.length !== meshAudit.geometryContracts.length) {
    throw new Error("transientEngineering mesh geometry-contract provenance is incomplete.");
  }
  meshGeometryContracts.forEach((entry, index) => {
    const path = `transientEngineering.provenance.meshGeometryContracts[${index}]`;
    const item = record(entry, path);
    expectExactKeys(item, [
      "contractId", "footprintMode", "rotationModel", "phaseGateRequired", "pass", "officialEligible",
    ], path);
    const expected = meshAudit.geometryContracts[index];
    if (text(item.contractId, `${path}.contractId`) !== expected.contractId
      || text(item.footprintMode, `${path}.footprintMode`) !== expected.footprintMode
      || text(item.rotationModel, `${path}.rotationModel`) !== expected.rotationModel
      || bool(item.phaseGateRequired, `${path}.phaseGateRequired`) !== expected.phaseGateRequired
      || bool(item.pass, `${path}.pass`) !== expected.pass
      || bool(item.officialEligible, `${path}.officialEligible`) !== expected.officialEligible) {
      throw new Error(`${path} disagrees with the referenced mesh artifact.`);
    }
  });
  const sharedConnection = record(provenance.sharedConnection, "transientEngineering.provenance.sharedConnection");
  for (const key of [
    "nominalCellAreaM2", "parallelStrings", "cellsPerBypassSubstring", "bypassForwardVoltageV",
    "stringWiringResistanceOhm", "arrayWiringResistanceOhm", "cellIvModel",
  ] as const) {
    if (sharedConnection[key] !== meshAudit.topology[key]) {
      throw new Error(`transientEngineering shared connection disagrees with mesh topology: ${key}.`);
    }
  }
  expectExactContract(
    sharedConnection,
    certifiedFixture.connection,
    "transientEngineering.provenance.sharedConnection",
  );
  if (text(provenance.spatialLayoutVersion, "transientEngineering.provenance.spatialLayoutVersion")
    !== meshAudit.topology.layoutVersion) {
    throw new Error("transientEngineering spatial layout version disagrees with mesh audit.");
  }
  const implementationSourceFiles = stringArray(
    provenance.implementationSourceFiles,
    "transientEngineering.provenance.implementationSourceFiles",
  );
  const implementationSha = sha256(
    provenance.implementationFingerprint,
    "transientEngineering.provenance.implementationFingerprint",
  );
  if (implementationSha !== implementationFingerprint(
    implementationSourceFiles,
    rootDir,
    COMBINED_REQUIRED_IMPLEMENTATION_FILES,
    "transientEngineering.provenance",
  )) {
    throw new Error("transientEngineering implementation fingerprint disagrees with source bytes.");
  }
  const legacy = record(provenance.legacyExploratoryEngineeringArtifact, "transientEngineering.provenance.legacyExploratoryEngineeringArtifact");
  if (!/reference-only.*excluded/i.test(text(legacy.use, "transientEngineering.provenance.legacyExploratoryEngineeringArtifact.use"))) {
    throw new Error("Legacy exploratory engineering values must remain excluded from official gates.");
  }

  const idealArtifact = readJson(rootDir, idealAuditPath, "ideal annual audit");
  const thermalArtifact = readJson(rootDir, thermalAuditPath, "transient thermal audit");
  const thermalMesh = record(thermalArtifact.meshConvergence14Day, "transientThermal.meshConvergence14Day");
  if (thermalArtifact.schemaVersion !== 1 || thermalArtifact.pass !== true || thermalMesh.converged !== true) {
    throw new Error("Referenced transient thermal artifact is not a passing mesh-converged audit.");
  }

  const resolutionSource = record(source.resolution, "transientEngineering.resolution");
  const resolutionByGeometry = record(
    resolutionSource.byGeometryContract,
    "transientEngineering.resolution.byGeometryContract",
  );
  const expectedContractIds = ["static-land-matched", "swept-rotation-envelope"] as const;
  if (Object.keys(resolutionByGeometry).length !== expectedContractIds.length
    || expectedContractIds.some((contractId) => !(contractId in resolutionByGeometry))) {
    throw new Error("transientEngineering resolution must contain both geometry contracts exactly.");
  }
  for (const contractId of expectedContractIds) {
    const contractPath = `transientEngineering.resolution.byGeometryContract.${contractId}`;
    const byShape = record(resolutionByGeometry[contractId], contractPath);
    expectCompleteShapeSet(Object.keys(byShape), contractPath);
    const meshContract = meshAudit.geometryContracts.find((entry) => entry.contractId === contractId);
    if (!meshContract) throw new Error(`${contractPath} is absent from the mesh artifact.`);
    for (const shape of ENGINEERING_VALIDATION_SHAPES) {
      const shapePath = `${contractPath}.${shape}`;
      const item = record(byShape[shape], shapePath);
      const selected = {
        azimuthSamples: positiveInteger(item.azimuthSamples, `${shapePath}.azimuthSamples`),
        meridionalSegments: positiveInteger(item.meridionalSegments, `${shapePath}.meridionalSegments`),
        phaseSamples: positiveInteger(item.phaseSamples, `${shapePath}.phaseSamples`),
        circuitSamples: positiveInteger(item.circuitSamples, `${shapePath}.circuitSamples`),
      };
      const expected = meshAudit.convergence.officialMinimumResolution;
      const expectedPhase = meshContract.phaseGateRequired ? expected.phaseSamples : 1;
      const meshShape = meshContract.shapes.find((entry) => entry.shape === shape);
      const selectedLevel = meshShape?.levels.find((level) =>
        level.resolution.azimuthSamples === selected.azimuthSamples
          && level.resolution.meridionalSegments === selected.meridionalSegments
          && level.resolution.phaseSamples === selected.phaseSamples
          && level.resolution.circuitSamples === selected.circuitSamples);
      if (selected.azimuthSamples !== expected.azimuthSamples
        || selected.meridionalSegments !== expected.meridionalSegments
        || selected.phaseSamples !== expectedPhase || selected.circuitSamples !== expected.circuitSamples
        || !meshShape?.pass || !meshShape.officialEligible || selectedLevel?.layoutId !== meshShape.layoutId) {
        throw new Error(`${shapePath} is not the mesh-certified contract-specific production resolution.`);
      }
    }
  }
  const opticalByShape = record(
    record(resolutionSource.optical, "transientEngineering.resolution.optical").byShape,
    "transientEngineering.resolution.optical.byShape",
  );
  const phaseByShape = record(
    record(resolutionSource.phaseSamples, "transientEngineering.resolution.phaseSamples").byShape,
    "transientEngineering.resolution.phaseSamples.byShape",
  );
  const circuitByShape = record(
    record(resolutionSource.circuitSamples, "transientEngineering.resolution.circuitSamples").byShape,
    "transientEngineering.resolution.circuitSamples.byShape",
  );
  expectCompleteShapeSet(Object.keys(opticalByShape), "transientEngineering.resolution.optical.byShape");
  expectCompleteShapeSet(Object.keys(phaseByShape), "transientEngineering.resolution.phaseSamples.byShape");
  expectCompleteShapeSet(Object.keys(circuitByShape), "transientEngineering.resolution.circuitSamples.byShape");
  for (const shape of ENGINEERING_VALIDATION_SHAPES) {
    const sweptResolution = record(record(resolutionByGeometry["swept-rotation-envelope"],
      "transientEngineering.resolution.byGeometryContract.swept-rotation-envelope")[shape], `transientEngineering.resolution.byGeometryContract.swept-rotation-envelope.${shape}`);
    const optical = record(opticalByShape[shape], `transientEngineering.resolution.optical.byShape.${shape}`);
    positiveInteger(optical.azimuthSamples, `transientEngineering.resolution.optical.byShape.${shape}.azimuthSamples`);
    positiveInteger(optical.meridionalSegments, `transientEngineering.resolution.optical.byShape.${shape}.meridionalSegments`);
    const opticalPhase = positiveInteger(optical.phaseSamples, `transientEngineering.resolution.optical.byShape.${shape}.phaseSamples`);
    const opticalCircuit = positiveInteger(optical.circuitSamples, `transientEngineering.resolution.optical.byShape.${shape}.circuitSamples`);
    if (positiveInteger(phaseByShape[shape], `transientEngineering.resolution.phaseSamples.byShape.${shape}`) !== opticalPhase
      || positiveInteger(circuitByShape[shape], `transientEngineering.resolution.circuitSamples.byShape.${shape}`) !== opticalCircuit
      || optical.azimuthSamples !== sweptResolution.azimuthSamples
      || optical.meridionalSegments !== sweptResolution.meridionalSegments
      || optical.phaseSamples !== sweptResolution.phaseSamples
      || optical.circuitSamples !== sweptResolution.circuitSamples) {
      throw new Error(`transientEngineering ${shape} optical/phase/circuit resolutions disagree.`);
    }
  }
  const thermalNodeCount = positiveInteger(resolutionSource.thermalNodeCount, "transientEngineering.resolution.thermalNodeCount");
  const thermalMaximumSubstepSeconds = positiveInteger(
    resolutionSource.thermalMaximumSubstepSeconds,
    "transientEngineering.resolution.thermalMaximumSubstepSeconds",
  );
  const couplingStepSeconds = positiveInteger(resolutionSource.couplingStepSeconds, "transientEngineering.resolution.couplingStepSeconds");
  if (thermalNodeCount !== 6 || thermalMaximumSubstepSeconds > 3_600 || couplingStepSeconds !== 900
    || Object.keys(record(resolutionSource.warmup, "transientEngineering.resolution.warmup")).length === 0) {
    throw new Error("transientEngineering selected thermal/coupling/warm-up resolution is invalid.");
  }

  const coverage = record(source.coverage, "transientEngineering.coverage");
  const annualCoverage = record(coverage.annual, "transientEngineering.coverage.annual");
  if (positiveInteger(annualCoverage.points, "transientEngineering.coverage.annual.points") !== expectedHours + 1
    || positiveInteger(annualCoverage.intervals, "transientEngineering.coverage.annual.intervals") !== expectedHours
    || finite(annualCoverage.durationHours, "transientEngineering.coverage.annual.durationHours") !== expectedHours
    || annualCoverage.closingEndpointPresent !== true || annualCoverage.isFullCalendarYear !== true) {
    throw new Error("transientEngineering annual coverage lacks every interval and closing endpoint.");
  }
  const leap = record(coverage.leapRegression, "transientEngineering.coverage.leapRegression");
  if (positiveInteger(leap.steps, "transientEngineering.coverage.leapRegression.steps") !== 8_785
    || positiveInteger(leap.intervals, "transientEngineering.coverage.leapRegression.intervals") !== 8_784
    || finite(leap.durationHours, "transientEngineering.coverage.leapRegression.durationHours") !== 8_784
    || leap.closingEndpointPresent !== true || leap.isFullCalendarYear !== true) {
    throw new Error("transientEngineering leap regression lacks 8784 intervals and closing endpoint.");
  }

  const unsupportedMatrix = record(source.unsupportedMatrix, "transientEngineering.unsupportedMatrix");
  expectExactKeys(
    unsupportedMatrix, ["obstacle", "verticalRotation", "planeTracking"], "transientEngineering.unsupportedMatrix",
  );
  for (const [key, supported] of [
    ["obstacle", false], ["verticalRotation", true], ["planeTracking", false],
  ] as const) {
    const entry = record(unsupportedMatrix[key], `transientEngineering.unsupportedMatrix.${key}`);
    expectExactKeys(entry, ["supported", "reason"], `transientEngineering.unsupportedMatrix.${key}`);
    if (bool(entry.supported, `transientEngineering.unsupportedMatrix.${key}.supported`) !== supported) {
      throw new Error(`transientEngineering unsupported matrix is wrong for ${key}.`);
    }
    text(entry.reason, `transientEngineering.unsupportedMatrix.${key}.reason`);
  }

  const baselineRegression = validateBaselineRegression(
    source.baselineRegression,
    rootDir,
    idealArtifact,
    idealAuditSha256,
  );
  const couplingConvergence = validateCouplingConvergence(source.couplingConvergence);
  const thermalMeshConvergence = validateThermalMeshConvergence(source.thermalMeshConvergence);
  const thermalComparison = validateThermalModelComparison(source.thermalModelComparison, year, meshAudit);
  const workerFullYearParity = validateWorkerParity(source.workerFullYearParity);

  const rankingsSource = record(source.rankings, "transientEngineering.rankings");
  const rankings = {} as TransientEngineeringAudit["rankings"];
  for (const mode of ["static", "controlled", "natural"] as const) {
    const modePath = `transientEngineering.rankings.${mode}`;
    const group = record(rankingsSource[mode], modePath);
    if (bool(group.official, `${modePath}.official`) !== true) {
      throw new Error(`${modePath} cannot carry ranks unless every official gate passes.`);
    }
    const rows = array(group.rows, `${modePath}.rows`).map((entry, index) => {
      const raw = record(entry, `${modePath}.rows[${index}]`);
      const shape = text(raw.shape, `${modePath}.rows[${index}].shape`) as EngineeringValidationShape;
      const row = parseRankingRow(
        entry,
        `${modePath}.rows[${index}]`,
        mode,
        year,
        landAreaM2,
        couplingStepSeconds,
        meshAudit.topology,
        thermalComparison.netKWhByMode[mode][shape],
      );
      const expectedContractId = mode === "controlled" ? "swept-rotation-envelope" : "static-land-matched";
      const expectedMeshShape = meshAudit.geometryContracts
        .find((contract) => contract.contractId === expectedContractId)?.shapes
        .find((meshShape) => meshShape.shape === shape);
      if (!expectedMeshShape || row.electricalLayoutId !== expectedMeshShape.layoutId
        || !close(row.activePvAreaM2, expectedMeshShape.activeAreaM2, 1e-10)
        || text(row.provenance.footprintMethod, `${modePath}.rows[${index}].provenance.footprintMethod`)
          !== expectedContractId) {
        throw new Error(`${modePath}.rows[${index}] disagrees with its mesh-certified layout/area/geometry contract.`);
      }
      return row;
    });
    expectCompleteShapeSet(rows.map((row) => row.shape), `${modePath}.rows`);
    if (rows.some((row, index) => row.rank !== index + 1
      || (index > 0 && rows[index - 1].kWhPerLandM2Year < row.kWhPerLandM2Year))) {
      throw new Error(`${modePath}.rows must carry exact descending official ranks.`);
    }
    rankings[mode] = { official: true, rows };
  }
  for (const shape of ENGINEERING_VALIDATION_SHAPES) {
    const staticRow = rankings.static.rows.find((row) => row.shape === shape)!;
    const naturalRow = rankings.natural.rows.find((row) => row.shape === shape)!;
    for (const key of [
      "landAreaM2", "activePvAreaM2", "dcKWhYear", "idealLocalMppDcKWhYear",
      "mismatchAndWiringLossKWhYear", "grossAcKWhYear", "netAcKWhYear",
      "kWhPerLandM2Year", "kWhPerPvM2Year", "quasiSteadyEngineeringNetAcKWhYear",
    ] as const) {
      if (naturalRow[key] !== staticRow[key]) {
        throw new Error(`Natural no-C_Q ${shape} must exactly reuse the stationary ${key}.`);
      }
    }
    if (naturalRow.electricalLayoutId !== staticRow.electricalLayoutId
      || JSON.stringify(naturalRow.monthly) !== JSON.stringify(staticRow.monthly)) {
      throw new Error(`Natural no-C_Q ${shape} must exactly reuse stationary layout/monthly output.`);
    }
  }

  const shortFactorialDecomposition = validateShortFactorial(source.shortFactorialDecomposition);
  const deterministicReplay = record(source.deterministicReplay, "transientEngineering.deterministicReplay");
  const firstReplaySha = sha256(deterministicReplay.firstSha256, "transientEngineering.deterministicReplay.firstSha256");
  const replaySha = sha256(deterministicReplay.replaySha256, "transientEngineering.deterministicReplay.replaySha256");
  if (text(deterministicReplay.shape, "transientEngineering.deterministicReplay.shape") !== "cylinder"
    || finite(deterministicReplay.actualClockHours, "transientEngineering.deterministicReplay.actualClockHours") !== 24
    || bool(deterministicReplay.exactReplay, "transientEngineering.deterministicReplay.exactReplay") !== true
    || firstReplaySha !== replaySha) {
    throw new Error("transientEngineering deterministic replay SHA values differ.");
  }
  const runtime = record(source.runtime, "transientEngineering.runtime");
  text(runtime.checkpointPath, "transientEngineering.runtime.checkpointPath");
  sha256(runtime.checkpointFingerprint, "transientEngineering.runtime.checkpointFingerprint");
  positiveInteger(runtime.taskCount, "transientEngineering.runtime.taskCount");
  nonnegative(runtime.taskElapsedMs, "transientEngineering.runtime.taskElapsedMs");
  nonnegative(runtime.generatedProcessUptimeSeconds, "transientEngineering.runtime.generatedProcessUptimeSeconds");

  return {
    schemaVersion: 1,
    generatedAtUtc,
    verdict: "pass",
    officialRankingEligible: true,
    blockingReasons: [],
    conditions,
    certifiedFixture,
    provenance,
    resolution: resolutionSource,
    coverage,
    unsupportedMatrix,
    baselineRegression,
    couplingConvergence,
    thermalMeshConvergence,
    thermalModelComparison: thermalComparison.source,
    workerFullYearParity,
    rankings,
    shortFactorialDecomposition,
    deterministicReplay,
    runtime,
  };
}

export function validateTransientEngineeringGate(
  value: unknown,
  audit: TransientEngineeringAudit,
  meshAudit: EngineeringMeshAudit,
  rootDir = process.cwd(),
): TransientEngineeringGate {
  const source = record(value, "transientEngineeringGate");
  expectExactKeys(source, [
    "schemaVersion", "generatedAtUtc", "status", "artifactSchemaVersion", "artifactPath", "artifactSha256",
    "meshAuditPath", "meshAuditSha256", "thermalAuditPath", "thermalAuditSha256", "implementationSha256",
    "configurationSha256", "year", "coverage", "geometryContracts", "validatedMinimumResolution", "validatedCoupledSettings",
    "certifiedFixture", "officialRankings", "layoutVersion", "officialRankingEligible",
  ], "transientEngineeringGate");
  if (source.schemaVersion !== 1 || source.artifactSchemaVersion !== 1
    || source.status !== "pass" || source.officialRankingEligible !== true
    || !audit.officialRankingEligible) {
    throw new Error("transientEngineeringGate must be schema 1, status=pass, and official with its full artifact.");
  }
  const generatedAtUtc = text(source.generatedAtUtc, "transientEngineeringGate.generatedAtUtc");
  if (generatedAtUtc !== audit.generatedAtUtc) throw new Error("transientEngineeringGate timestamp disagrees with its artifact.");
  const emittedArtifactPath = text(source.artifactPath, "transientEngineeringGate.artifactPath");
  if (emittedArtifactPath !== TRANSIENT_ENGINEERING_ARTIFACT_PATH) throw new Error("transientEngineeringGate artifactPath is unexpected.");
  const artifactSha256 = sha256(source.artifactSha256, "transientEngineeringGate.artifactSha256");
  if (artifactSha256 !== fileSha256(rootDir, emittedArtifactPath, "transient engineering full-year artifact")) {
    throw new Error("transientEngineeringGate artifact SHA disagrees with current report bytes.");
  }
  const provenance = audit.provenance;
  const meshAuditPath = text(source.meshAuditPath, "transientEngineeringGate.meshAuditPath");
  const meshAuditSha256 = sha256(source.meshAuditSha256, "transientEngineeringGate.meshAuditSha256");
  const thermalAuditPath = text(source.thermalAuditPath, "transientEngineeringGate.thermalAuditPath");
  const thermalAuditSha256 = sha256(source.thermalAuditSha256, "transientEngineeringGate.thermalAuditSha256");
  const implementationSha256 = sha256(source.implementationSha256, "transientEngineeringGate.implementationSha256");
  const configurationSha256 = sha256(source.configurationSha256, "transientEngineeringGate.configurationSha256");
  if (meshAuditPath !== provenance.meshAuditPath || meshAuditSha256 !== provenance.meshAuditSha256
    || thermalAuditPath !== provenance.thermalAuditPath || thermalAuditSha256 !== provenance.thermalAuditSha256
    || implementationSha256 !== provenance.implementationFingerprint
    || configurationSha256 !== audit.runtime.checkpointFingerprint) {
    throw new Error("transientEngineeringGate dependency/configuration fingerprints disagree with the full artifact.");
  }
  const year = positiveInteger(source.year, "transientEngineeringGate.year");
  if (year !== audit.conditions.year) throw new Error("transientEngineeringGate year disagrees with conditions.");
  const coverageSource = record(source.coverage, "transientEngineeringGate.coverage");
  expectExactKeys(coverageSource, ["points", "intervals", "durationHours", "closingEndpointPresent"], "transientEngineeringGate.coverage");
  const coverage = {
    points: positiveInteger(coverageSource.points, "transientEngineeringGate.coverage.points"),
    intervals: positiveInteger(coverageSource.intervals, "transientEngineeringGate.coverage.intervals"),
    durationHours: finite(coverageSource.durationHours, "transientEngineeringGate.coverage.durationHours"),
    closingEndpointPresent: bool(coverageSource.closingEndpointPresent, "transientEngineeringGate.coverage.closingEndpointPresent"),
  };
  const annual = record(audit.coverage.annual, "transientEngineering.coverage.annual");
  if (!coverage.closingEndpointPresent || coverage.points !== annual.points
    || coverage.intervals !== annual.intervals || coverage.durationHours !== annual.durationHours) {
    throw new Error("transientEngineeringGate coverage disagrees with the full annual clock.");
  }
  const validatedSource = record(source.validatedMinimumResolution, "transientEngineeringGate.validatedMinimumResolution");
  const reportResolution = record(audit.resolution.byGeometryContract, "transientEngineering.resolution.byGeometryContract");
  const validatedMinimumResolution = {} as TransientEngineeringGate["validatedMinimumResolution"];
  const geometryContracts: TransientEngineeringGate["geometryContracts"] = [];
  const contractEntries = array(source.geometryContracts, "transientEngineeringGate.geometryContracts");
  const contractIds = ["static-land-matched", "swept-rotation-envelope"] as const;
  if (contractEntries.length !== contractIds.length || Object.keys(validatedSource).length !== contractIds.length) {
    throw new Error("transientEngineeringGate must contain both geometry contracts exactly.");
  }
  contractIds.forEach((contractId, contractIndex) => {
    const path = `transientEngineeringGate.geometryContracts[${contractIndex}]`;
    const item = record(contractEntries[contractIndex], path);
    expectExactKeys(item, [
      "contractId", "footprintMode", "rotationModel", "phaseGateRequired", "validatedResolution",
      "layoutIdByShape", "pass", "officialEligible",
    ], path);
    const expectedMesh = meshAudit.geometryContracts[contractIndex];
    if (!expectedMesh || expectedMesh.contractId !== contractId) throw new Error(`${path} order disagrees with mesh audit.`);
    const reportByShape = record(reportResolution[contractId], `transientEngineering.resolution.byGeometryContract.${contractId}`);
    const gateByShape = record(validatedSource[contractId], `transientEngineeringGate.validatedMinimumResolution.${contractId}`);
    expectCompleteShapeSet(Object.keys(gateByShape), `transientEngineeringGate.validatedMinimumResolution.${contractId}`);
    validatedMinimumResolution[contractId] = {} as Record<EngineeringValidationShape, CombinedResolution>;
    for (const shape of ENGINEERING_VALIDATION_SHAPES) {
      const shapePath = `transientEngineeringGate.validatedMinimumResolution.${contractId}.${shape}`;
      const selected = combinedResolution(gateByShape[shape], shapePath);
      const expected = combinedResolution(
        reportByShape[shape],
        `transientEngineering.resolution.byGeometryContract.${contractId}.${shape}`,
      );
      if (!sameCombinedResolution(selected, expected)) {
        throw new Error(`${shapePath} disagrees with the full artifact resolution.`);
      }
      validatedMinimumResolution[contractId][shape] = selected;
    }
    const validatedResolution = combinedResolution(item.validatedResolution, `${path}.validatedResolution`);
    if (!sameCombinedResolution(validatedResolution, validatedMinimumResolution[contractId].plane)) {
      throw new Error(`${path}.validatedResolution disagrees with its per-shape contract.`);
    }
    const layoutSource = record(item.layoutIdByShape, `${path}.layoutIdByShape`);
    expectCompleteShapeSet(Object.keys(layoutSource), `${path}.layoutIdByShape`);
    const layoutIdByShape = {} as Record<EngineeringValidationShape, string>;
    for (const shape of ENGINEERING_VALIDATION_SHAPES) {
      const layout = text(layoutSource[shape], `${path}.layoutIdByShape.${shape}`);
      const expectedLayout = expectedMesh.shapes.find((entry) => entry.shape === shape)?.layoutId;
      if (layout !== expectedLayout) throw new Error(`${path}.layoutIdByShape.${shape} disagrees with mesh audit.`);
      layoutIdByShape[shape] = layout;
    }
    const contractIdValue = text(item.contractId, `${path}.contractId`);
    const footprintModeValue = text(item.footprintMode, `${path}.footprintMode`);
    const rotationModelValue = text(item.rotationModel, `${path}.rotationModel`);
    const phaseGateRequired = bool(item.phaseGateRequired, `${path}.phaseGateRequired`);
    if (contractIdValue !== expectedMesh.contractId || footprintModeValue !== expectedMesh.footprintMode
      || rotationModelValue !== expectedMesh.rotationModel || phaseGateRequired !== expectedMesh.phaseGateRequired
      || bool(item.pass, `${path}.pass`) !== true || bool(item.officialEligible, `${path}.officialEligible`) !== true) {
      throw new Error(`${path} disagrees with the passing mesh geometry contract.`);
    }
    geometryContracts.push({
      contractId: expectedMesh.contractId,
      footprintMode: expectedMesh.footprintMode,
      rotationModel: expectedMesh.rotationModel,
      phaseGateRequired,
      validatedResolution,
      layoutIdByShape,
      pass: true,
      officialEligible: true,
    });
  });
  const coupledSource = record(source.validatedCoupledSettings, "transientEngineeringGate.validatedCoupledSettings");
  expectExactKeys(coupledSource, [
    "thermalNodeCount", "maximumThermalSubstepSeconds", "maximumElectricalCouplingStepSeconds",
    "couplingConvergenceToleranceFraction", "thermalMeshEnergyToleranceFraction",
    "thermalMeshTemperatureToleranceC", "maximumElectricalExtractionClosureErrorW",
    "maximumHeatEnergyResidualFraction",
  ], "transientEngineeringGate.validatedCoupledSettings");
  const couplingEvidence = record(audit.couplingConvergence, "transientEngineering.couplingConvergence");
  const thermalMeshEvidence = record(audit.thermalMeshConvergence, "transientEngineering.thermalMeshConvergence");
  const validatedCoupledSettings = {
    thermalNodeCount: positiveInteger(coupledSource.thermalNodeCount, "transientEngineeringGate.validatedCoupledSettings.thermalNodeCount"),
    maximumThermalSubstepSeconds: positiveInteger(coupledSource.maximumThermalSubstepSeconds, "transientEngineeringGate.validatedCoupledSettings.maximumThermalSubstepSeconds"),
    maximumElectricalCouplingStepSeconds: positiveInteger(coupledSource.maximumElectricalCouplingStepSeconds, "transientEngineeringGate.validatedCoupledSettings.maximumElectricalCouplingStepSeconds"),
    couplingConvergenceToleranceFraction: finite(coupledSource.couplingConvergenceToleranceFraction, "transientEngineeringGate.validatedCoupledSettings.couplingConvergenceToleranceFraction"),
    thermalMeshEnergyToleranceFraction: finite(coupledSource.thermalMeshEnergyToleranceFraction, "transientEngineeringGate.validatedCoupledSettings.thermalMeshEnergyToleranceFraction"),
    thermalMeshTemperatureToleranceC: finite(coupledSource.thermalMeshTemperatureToleranceC, "transientEngineeringGate.validatedCoupledSettings.thermalMeshTemperatureToleranceC"),
    maximumElectricalExtractionClosureErrorW: finite(coupledSource.maximumElectricalExtractionClosureErrorW, "transientEngineeringGate.validatedCoupledSettings.maximumElectricalExtractionClosureErrorW"),
    maximumHeatEnergyResidualFraction: finite(coupledSource.maximumHeatEnergyResidualFraction, "transientEngineeringGate.validatedCoupledSettings.maximumHeatEnergyResidualFraction"),
  };
  if (validatedCoupledSettings.thermalNodeCount !== 6
    || validatedCoupledSettings.maximumThermalSubstepSeconds !== 900
    || validatedCoupledSettings.maximumElectricalCouplingStepSeconds !== 900
    || validatedCoupledSettings.couplingConvergenceToleranceFraction !== 0.02
    || validatedCoupledSettings.thermalMeshEnergyToleranceFraction !== 0.01
    || validatedCoupledSettings.thermalMeshTemperatureToleranceC !== 0.2
    || validatedCoupledSettings.maximumElectricalExtractionClosureErrorW !== 1e-8
    || validatedCoupledSettings.maximumHeatEnergyResidualFraction !== 1e-8
    || validatedCoupledSettings.thermalNodeCount !== audit.resolution.thermalNodeCount
    || validatedCoupledSettings.maximumThermalSubstepSeconds !== audit.resolution.thermalMaximumSubstepSeconds
    || validatedCoupledSettings.maximumElectricalCouplingStepSeconds !== audit.resolution.couplingStepSeconds
    || validatedCoupledSettings.couplingConvergenceToleranceFraction !== couplingEvidence.toleranceFraction
    || validatedCoupledSettings.thermalMeshEnergyToleranceFraction !== thermalMeshEvidence.energyToleranceFraction
    || validatedCoupledSettings.thermalMeshTemperatureToleranceC !== thermalMeshEvidence.temperatureToleranceC) {
    throw new Error("transientEngineeringGate coupled settings drifted from predeclared/report evidence.");
  }
  const certifiedFixture = validateCertifiedFixture(
    source.certifiedFixture,
    "transientEngineeringGate.certifiedFixture",
  );
  expectExactContract(
    source.certifiedFixture,
    audit.certifiedFixture,
    "transientEngineeringGate.certifiedFixture",
  );
  if (certifiedFixture.year !== year
    || certifiedFixture.weather.intervals !== coverage.intervals
    || certifiedFixture.weather.closingEndpointPresent !== coverage.closingEndpointPresent
    || certifiedFixture.thermal.thermalNodeCount !== validatedCoupledSettings.thermalNodeCount
    || certifiedFixture.thermal.materialConfig.maximumSubstepSeconds
      !== validatedCoupledSettings.maximumThermalSubstepSeconds) {
    throw new Error("transientEngineeringGate certified fixture disagrees with annual/coupled evidence.");
  }
  for (const key of [
    "nominalCellAreaM2", "parallelStrings", "cellsPerBypassSubstring", "bypassForwardVoltageV",
    "stringWiringResistanceOhm", "arrayWiringResistanceOhm", "cellIvModel",
  ] as const) {
    if (certifiedFixture.connection[key] !== meshAudit.topology[key]) {
      throw new Error("transientEngineeringGate certified connection disagrees with the mesh topology.");
    }
  }
  const rankingReference = {
    static: audit.rankings.static.rows,
    controlled: audit.rankings.controlled.rows,
    natural: audit.rankings.natural.rows,
  } satisfies Record<TransientEngineeringRankingMode,
    readonly TransientEngineeringOfficialRankingReferenceRow[]>;
  const officialRankings = validateTransientEngineeringOfficialRankings(
    source.officialRankings,
    rankingReference,
  );
  const layoutVersion = text(source.layoutVersion, "transientEngineeringGate.layoutVersion");
  if (layoutVersion !== meshAudit.topology.layoutVersion || layoutVersion !== audit.provenance.spatialLayoutVersion) {
    throw new Error("transientEngineeringGate layout version disagrees with mesh/report provenance.");
  }
  return {
    schemaVersion: 1,
    generatedAtUtc,
    status: "pass",
    artifactSchemaVersion: 1,
    artifactPath: TRANSIENT_ENGINEERING_ARTIFACT_PATH,
    artifactSha256,
    meshAuditPath,
    meshAuditSha256,
    thermalAuditPath,
    thermalAuditSha256,
    implementationSha256,
    configurationSha256,
    year,
    coverage: { ...coverage, closingEndpointPresent: true },
    geometryContracts,
    validatedMinimumResolution,
    validatedCoupledSettings: validatedCoupledSettings as TransientEngineeringGate["validatedCoupledSettings"],
    certifiedFixture,
    officialRankings,
    layoutVersion,
    officialRankingEligible: true,
  };
}
export type TransientEngineeringRunningOrFailedGate = {
  schemaVersion: 1;
  status: "running-or-failed";
  certifiedFixture: TransientEngineeringCertifiedFixture;
  officialRankings: Record<TransientEngineeringRankingMode, []>;
  officialRankingEligible: false;
};

function emptyOrSha256(value: unknown, path: string): string {
  if (value === "") return "";
  return sha256(value, path);
}

export function validateTransientEngineeringRunningOrFailedGate(
  value: unknown,
): TransientEngineeringRunningOrFailedGate {
  const path = "transientEngineeringRunningOrFailedGate";
  const source = record(value, path);
  expectExactKeys(source, [
    "schemaVersion", "generatedAtUtc", "status", "artifactSchemaVersion", "artifactPath", "artifactSha256",
    "meshAuditPath", "meshAuditSha256", "thermalAuditPath", "thermalAuditSha256", "implementationSha256",
    "configurationSha256", "year", "coverage", "geometryContracts", "validatedMinimumResolution",
    "validatedCoupledSettings", "certifiedFixture", "officialRankings", "layoutVersion",
    "officialRankingEligible",
  ], path);
  if (source.schemaVersion !== 1 || source.artifactSchemaVersion !== 1
    || source.status !== "running-or-failed" || source.officialRankingEligible !== false) {
    throw new Error(`${path} must be schema 1, running-or-failed, and ineligible.`);
  }
  if (!Number.isFinite(Date.parse(text(source.generatedAtUtc, `${path}.generatedAtUtc`)))
    || text(source.artifactPath, `${path}.artifactPath`) !== TRANSIENT_ENGINEERING_ARTIFACT_PATH
    || source.artifactSha256 !== ""
    || text(source.meshAuditPath, `${path}.meshAuditPath`)
      !== "docs/engineering-mesh-convergence-audit-2026.json"
    || text(source.thermalAuditPath, `${path}.thermalAuditPath`)
      !== "docs/annual-transient-audit-2026.json") {
    throw new Error(`${path} paths, timestamp, or unpublished artifact SHA are invalid.`);
  }
  for (const key of [
    "meshAuditSha256", "thermalAuditSha256", "implementationSha256", "configurationSha256",
  ] as const) {
    emptyOrSha256(source[key], `${path}.${key}`);
  }
  const certifiedFixture = validateCertifiedFixture(source.certifiedFixture, `${path}.certifiedFixture`);
  if (positiveInteger(source.year, `${path}.year`) !== certifiedFixture.year) {
    throw new Error(`${path}.year disagrees with the certified fixture.`);
  }
  expectExactContract(source.coverage, {
    points: certifiedFixture.weather.intervals + 1,
    intervals: certifiedFixture.weather.intervals,
    durationHours: certifiedFixture.weather.intervals,
    closingEndpointPresent: certifiedFixture.weather.closingEndpointPresent,
  }, `${path}.coverage`);
  expectExactContract(source.validatedCoupledSettings, {
    thermalNodeCount: 6,
    maximumThermalSubstepSeconds: 900,
    maximumElectricalCouplingStepSeconds: 900,
    couplingConvergenceToleranceFraction: 0.02,
    thermalMeshEnergyToleranceFraction: 0.01,
    thermalMeshTemperatureToleranceC: 0.2,
    maximumElectricalExtractionClosureErrorW: 1e-8,
    maximumHeatEnergyResidualFraction: 1e-8,
  }, `${path}.validatedCoupledSettings`);

  const contractSpecs = [
    {
      contractId: "static-land-matched",
      footprintMode: "static",
      rotationModel: "stationary-rpm0",
      phaseGateRequired: false,
      phaseSamples: 1,
    },
    {
      contractId: "swept-rotation-envelope",
      footprintMode: "swept",
      rotationModel: "controlled-y-axis-phase-quadrature",
      phaseGateRequired: true,
      phaseSamples: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.phaseSamples,
    },
  ] as const;
  const validatedMinimum = record(source.validatedMinimumResolution, `${path}.validatedMinimumResolution`);
  expectExactKeys(validatedMinimum, contractSpecs.map((entry) => entry.contractId), `${path}.validatedMinimumResolution`);
  const contracts = array(source.geometryContracts, `${path}.geometryContracts`);
  if (contracts.length !== contractSpecs.length) throw new Error(`${path} must contain both geometry contracts.`);
  contractSpecs.forEach((spec, index) => {
    const contractPath = `${path}.geometryContracts[${index}]`;
    const contract = record(contracts[index], contractPath);
    expectExactKeys(contract, [
      "contractId", "footprintMode", "rotationModel", "phaseGateRequired", "validatedResolution",
      "layoutIdByShape", "pass", "officialEligible",
    ], contractPath);
    const expectedResolution = {
      azimuthSamples: 32,
      meridionalSegments: 16,
      phaseSamples: spec.phaseSamples,
      circuitSamples: 256,
    };
    if (contract.contractId !== spec.contractId || contract.footprintMode !== spec.footprintMode
      || contract.rotationModel !== spec.rotationModel
      || contract.phaseGateRequired !== spec.phaseGateRequired
      || typeof contract.pass !== "boolean" || contract.officialEligible !== contract.pass) {
      throw new Error(`${contractPath} metadata is inconsistent.`);
    }
    expectExactContract(contract.validatedResolution, expectedResolution, `${contractPath}.validatedResolution`);
    const layouts = record(contract.layoutIdByShape, `${contractPath}.layoutIdByShape`);
    expectCompleteShapeSet(Object.keys(layouts), `${contractPath}.layoutIdByShape`);
    for (const shape of ENGINEERING_VALIDATION_SHAPES) {
      if (typeof layouts[shape] !== "string") {
        throw new TypeError(`${contractPath}.layoutIdByShape.${shape} must be a string.`);
      }
    }
    const byShape = record(validatedMinimum[spec.contractId], `${path}.validatedMinimumResolution.${spec.contractId}`);
    expectCompleteShapeSet(Object.keys(byShape), `${path}.validatedMinimumResolution.${spec.contractId}`);
    for (const shape of ENGINEERING_VALIDATION_SHAPES) {
      expectExactContract(
        byShape[shape],
        expectedResolution,
        `${path}.validatedMinimumResolution.${spec.contractId}.${shape}`,
      );
    }
  });

  // Bound to the exported constant, not a literal: a literal silently pins a
  // superseded physical layout and has to be hand-edited in lockstep with the
  // module it is supposed to certify.
  if (text(source.layoutVersion, `${path}.layoutVersion`)
    !== ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION) {
    throw new Error(`${path}.layoutVersion is not the certified engineering layout.`);
  }
  const rankingSource = record(source.officialRankings, `${path}.officialRankings`);
  expectExactKeys(rankingSource, TRANSIENT_ENGINEERING_RANKING_MODES, `${path}.officialRankings`);
  for (const mode of TRANSIENT_ENGINEERING_RANKING_MODES) {
    if (array(rankingSource[mode], `${path}.officialRankings.${mode}`).length !== 0) {
      throw new Error(`${path}.officialRankings.${mode} must be empty while the gate is not pass.`);
    }
  }
  return {
    schemaVersion: 1,
    status: "running-or-failed",
    certifiedFixture,
    officialRankings: { static: [], controlled: [], natural: [] },
    officialRankingEligible: false,
  };
}
