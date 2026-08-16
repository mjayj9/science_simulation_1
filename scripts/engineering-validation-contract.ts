import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export const ENGINEERING_VALIDATION_SHAPES = Object.freeze([
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
] as const);
export type EngineeringValidationShape = (typeof ENGINEERING_VALIDATION_SHAPES)[number];

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

function positiveInteger(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isInteger(result) || result <= 0) {
    throw new RangeError(`${path} must be a positive integer.`);
  }
  return result;
}

function nonnegative(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) throw new RangeError(`${path} must not be negative.`);
  return result;
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

function timestamp(value: unknown, path: string): string {
  const result = text(value, path);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${path} must be an ISO timestamp.`);
  return result;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) => text(entry, `${path}[${index}]`));
}

function positiveIntegerArray(value: unknown, path: string): number[] {
  return array(value, path).map((entry, index) => positiveInteger(entry, `${path}[${index}]`));
}

function close(actual: number, expected: number, tolerance = 1e-10): boolean {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function expectCompleteShapeSet(values: readonly string[], path: string): void {
  if (values.length !== ENGINEERING_VALIDATION_SHAPES.length
    || new Set(values).size !== ENGINEERING_VALIDATION_SHAPES.length
    || ENGINEERING_VALIDATION_SHAPES.some((shape) => !values.includes(shape))) {
    throw new Error(`${path} must contain all six comparison shapes exactly once.`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Canonical audit configuration contains an unsupported value.");
  return serialized;
}

function digestCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertPathInsideRoot(rootDir: string, relativePath: string, label: string): string {
  const root = realpathSync(rootDir);
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error(`${label} source is missing or is not a file: ${relativePath}`);
  }
  const real = realpathSync(absolutePath);
  const fromRoot = relative(root, real);
  if (fromRoot === "" || fromRoot.startsWith("..") || /^[A-Za-z]:/.test(fromRoot)) {
    throw new Error(`${label} source escapes the workspace: ${relativePath}`);
  }
  return real;
}

export function implementationFingerprint(
  sourceFiles: readonly string[],
  rootDir: string,
  requiredFiles: readonly string[],
  label: string,
): string {
  if (sourceFiles.length === 0 || new Set(sourceFiles).size !== sourceFiles.length) {
    throw new Error(`${label}.sourceFiles must be a non-empty list without duplicates.`);
  }
  for (const required of requiredFiles) {
    if (!sourceFiles.includes(required)) throw new Error(`${label}.sourceFiles is missing ${required}.`);
  }
  const canonical = [...sourceFiles].sort().map((relativePath) => {
    const real = assertPathInsideRoot(rootDir, relativePath, label);
    return `${relativePath}\0${readFileSync(real)}`;
  }).join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function meshImplementationFingerprint(
  sourceFiles: readonly string[],
  rootDir: string,
  requiredFiles: readonly string[],
  label: string,
): string {
  if (sourceFiles.length === 0 || new Set(sourceFiles).size !== sourceFiles.length) {
    throw new Error(`${label}.sourceFiles must be a non-empty list without duplicates.`);
  }
  for (const required of requiredFiles) {
    if (!sourceFiles.includes(required)) throw new Error(`${label}.sourceFiles is missing ${required}.`);
  }
  const bytes = sourceFiles.map((relativePath) => {
    const real = assertPathInsideRoot(rootDir, relativePath, label);
    return `${relativePath}\n${readFileSync(real, "utf8")}`;
  }).join("\n---\n");
  return createHash("sha256").update(bytes).digest("hex");
}

export type EngineeringMeshResolution = {
  azimuthSamples: number;
  meridionalSegments: number;
  phaseSamples: number;
  circuitSamples: number;
};

function resolution(value: unknown, path: string): EngineeringMeshResolution {
  const source = record(value, path);
  return {
    azimuthSamples: positiveInteger(source.azimuthSamples, `${path}.azimuthSamples`),
    meridionalSegments: positiveInteger(source.meridionalSegments, `${path}.meridionalSegments`),
    phaseSamples: positiveInteger(source.phaseSamples, `${path}.phaseSamples`),
    circuitSamples: positiveInteger(source.circuitSamples, `${path}.circuitSamples`),
  };
}

function sameResolution(left: EngineeringMeshResolution, right: EngineeringMeshResolution): boolean {
  return left.azimuthSamples === right.azimuthSamples
    && left.meridionalSegments === right.meridionalSegments
    && left.phaseSamples === right.phaseSamples
    && left.circuitSamples === right.circuitSamples;
}

export type EngineeringMeshTopology = {
  layoutVersion: string;
  nominalCellAreaM2: number;
  parallelStrings: number;
  cellsPerBypassSubstring: number;
  bypassForwardVoltageV: number;
  stringWiringResistanceOhm: number;
  arrayWiringResistanceOhm: number;
  cellIvModel: string;
};

export type EngineeringMeshLevel = {
  levelId: string;
  resolution: EngineeringMeshResolution;
  sampleCount: number;
  activeAreaM2: number;
  clippedAreaM2: number;
  areaClosureErrorM2: number;
  maximumCellAreaClosureErrorM2: number;
  cellCount: number;
  cellIds: string[];
  cellTopologyFingerprint: string;
  trimmedCellCount: number;
  trimmedCellAreaM2: number;
  parallelStringCount: number;
  stringIds: string[];
  seriesCellCountByString: number[];
  bypassSubstringCount: number;
  bypassSubstringIds: string[];
  layoutId: string;
  projectionFingerprint: string;
  projectionCount: number;
  dcWh: number;
  acWh: number;
  idealLocalMppDcWh: number;
  bypassActivationWeightedHours: number;
  maximumExtractionClosureErrorW: number;
  solveCount: number;
  layoutBuildMs: number;
  repeatedSolveMs: number;
  elapsedMs: number;
};

export type EngineeringMeshShape = {
  shape: EngineeringValidationShape;
  pass: boolean;
  officialEligible: boolean;
  activeAreaM2: number;
  layoutId: string;
  topologyInvariant: boolean;
  cellAreaInvariant: boolean;
  opticalMeshPass: boolean;
  levels: EngineeringMeshLevel[];
  consecutiveDeltas: Array<{
    coarseLevelId: string;
    fineLevelId: string;
    relativeDifference: number;
    toleranceFraction: number;
    pass: boolean;
  }>;
  phaseConvergence: EngineeringPhaseConvergence;
  circuitConvergence: EngineeringAxisConvergence;
};

export type EngineeringAxisLevel = {
  levelId: string;
  phaseSamples: number;
  circuitSamples: number;
  layoutId: string;
  cellIds: string[];
  stringIds: string[];
  bypassSubstringIds: string[];
  cellTopologyFingerprint: string;
  dcWh: number;
  acWh: number;
  idealLocalMppDcWh: number;
  bypassActivationWeightedHours: number;
  maximumExtractionClosureErrorW: number;
  topologyInvariant: boolean;
  solveCount: number;
  repeatedSolveMs: number;
};

export type EngineeringAxisConvergence = {
  pass: boolean;
  topologyInvariant: boolean;
  levels: EngineeringAxisLevel[];
  consecutiveDeltas: Array<{
    coarseLevelId: string;
    fineLevelId: string;
    relativeDifference: number;
    toleranceFraction: number;
    pass: boolean;
  }>;
};

export type EngineeringPhaseConvergence = EngineeringAxisConvergence & {
  required: boolean;
  status: "evaluated" | "not-applicable-stationary-rpm0";
};

export type EngineeringMeshGeometryContract = {
  contractId: "static-land-matched" | "swept-rotation-envelope";
  footprintMode: "static" | "swept";
  rotationModel: "stationary-rpm0" | "controlled-y-axis-phase-quadrature";
  phaseGateRequired: boolean;
  shapes: EngineeringMeshShape[];
  pass: boolean;
  officialEligible: boolean;
};

export type EngineeringMeshAudit = {
  schemaVersion: 2;
  generatedAt: string;
  fixture: UnknownRecord;
  topology: EngineeringMeshTopology;
  convergence: {
    toleranceFraction: number;
    requiredConsecutivePairs: number;
    officialMinimumResolution: EngineeringMeshResolution;
    opticalMeshLevels: Array<{ id: string; azimuthSamples: number; meridionalSegments: number; circuitSamples: number }>;
    phaseLevels: number[];
    circuitLevels: number[];
  };
  performanceBaseline: UnknownRecord;
  rootCause: UnknownRecord;
  geometryContracts: EngineeringMeshGeometryContract[];
  pass: boolean;
  officialRankingEligible: boolean;
  elapsedMs: number;
  implementation: { sourceFiles: string[]; sha256: string };
};

const MESH_REQUIRED_IMPLEMENTATION_FILES = Object.freeze([
  "scripts/audit-engineering-mesh-convergence.ts",
  "src/lib/physics/engineering-surface-electrical.ts",
  "src/lib/physics/circuit.ts",
] as const);

function parseMeshLevel(value: unknown, path: string): EngineeringMeshLevel {
  const source = record(value, path);
  const result: EngineeringMeshLevel = {
    levelId: text(source.levelId, `${path}.levelId`),
    resolution: resolution(source.resolution, `${path}.resolution`),
    sampleCount: positiveInteger(source.sampleCount, `${path}.sampleCount`),
    activeAreaM2: nonnegative(source.activeAreaM2, `${path}.activeAreaM2`),
    clippedAreaM2: nonnegative(source.clippedAreaM2, `${path}.clippedAreaM2`),
    areaClosureErrorM2: finite(source.areaClosureErrorM2, `${path}.areaClosureErrorM2`),
    maximumCellAreaClosureErrorM2: nonnegative(source.maximumCellAreaClosureErrorM2, `${path}.maximumCellAreaClosureErrorM2`),
    cellCount: positiveInteger(source.cellCount, `${path}.cellCount`),
    cellIds: stringArray(source.cellIds, `${path}.cellIds`),
    cellTopologyFingerprint: sha256(source.cellTopologyFingerprint, `${path}.cellTopologyFingerprint`),
    trimmedCellCount: nonnegative(source.trimmedCellCount, `${path}.trimmedCellCount`),
    trimmedCellAreaM2: nonnegative(source.trimmedCellAreaM2, `${path}.trimmedCellAreaM2`),
    parallelStringCount: positiveInteger(source.parallelStringCount, `${path}.parallelStringCount`),
    stringIds: stringArray(source.stringIds, `${path}.stringIds`),
    seriesCellCountByString: positiveIntegerArray(source.seriesCellCountByString, `${path}.seriesCellCountByString`),
    bypassSubstringCount: positiveInteger(source.bypassSubstringCount, `${path}.bypassSubstringCount`),
    bypassSubstringIds: stringArray(source.bypassSubstringIds, `${path}.bypassSubstringIds`),
    layoutId: text(source.layoutId, `${path}.layoutId`),
    projectionFingerprint: text(source.projectionFingerprint, `${path}.projectionFingerprint`),
    projectionCount: positiveInteger(source.projectionCount, `${path}.projectionCount`),
    dcWh: nonnegative(source.dcWh, `${path}.dcWh`),
    acWh: nonnegative(source.acWh, `${path}.acWh`),
    idealLocalMppDcWh: nonnegative(source.idealLocalMppDcWh, `${path}.idealLocalMppDcWh`),
    bypassActivationWeightedHours: nonnegative(source.bypassActivationWeightedHours, `${path}.bypassActivationWeightedHours`),
    maximumExtractionClosureErrorW: nonnegative(source.maximumExtractionClosureErrorW, `${path}.maximumExtractionClosureErrorW`),
    solveCount: positiveInteger(source.solveCount, `${path}.solveCount`),
    layoutBuildMs: nonnegative(source.layoutBuildMs, `${path}.layoutBuildMs`),
    repeatedSolveMs: nonnegative(source.repeatedSolveMs, `${path}.repeatedSolveMs`),
    elapsedMs: nonnegative(source.elapsedMs, `${path}.elapsedMs`),
  };
  if (result.cellIds.length !== result.cellCount || new Set(result.cellIds).size !== result.cellIds.length
    || result.stringIds.length !== result.parallelStringCount
    || new Set(result.stringIds).size !== result.stringIds.length
    || result.seriesCellCountByString.length !== result.parallelStringCount
    || result.seriesCellCountByString.reduce((sum, count) => sum + count, 0) !== result.cellCount
    || result.bypassSubstringIds.length !== result.bypassSubstringCount
    || new Set(result.bypassSubstringIds).size !== result.bypassSubstringIds.length) {
    throw new Error(`${path} topology counts disagree with stable IDs.`);
  }
  if (!close(result.clippedAreaM2, result.activeAreaM2, 1e-9)
    || !close(Math.abs(result.areaClosureErrorM2), Math.abs(result.clippedAreaM2 - result.activeAreaM2), 1e-9)
    || result.maximumCellAreaClosureErrorM2 > 1e-9 * Math.max(1, result.activeAreaM2)) {
    throw new Error(`${path} does not conserve active cell area.`);
  }
  if (result.dcWh > result.idealLocalMppDcWh && !close(result.dcWh, result.idealLocalMppDcWh, 1e-10)) {
    throw new Error(`${path}.dcWh exceeds the ideal local-MPP upper bound.`);
  }
  if (result.maximumExtractionClosureErrorW > 1e-8 * Math.max(1, result.dcWh)) {
    throw new Error(`${path} sample-to-circuit extraction ledger does not close.`);
  }
  return result;
}

function parseAxisConvergence(
  value: unknown,
  path: string,
  axis: "phase" | "circuit",
  declaredSamples: readonly number[],
  toleranceFraction: number,
  requiredConsecutivePairs: number,
  expectedOpticalResolution: Pick<EngineeringMeshResolution, "azimuthSamples" | "meridionalSegments">,
  expectedOtherSamples: number,
): EngineeringAxisConvergence {
  const source = record(value, path);
  const reportedTopologyInvariant = bool(source.topologyInvariant, `${path}.topologyInvariant`);
  const fixedOptical = record(source.fixedOpticalResolution, `${path}.fixedOpticalResolution`);
  const fixedAzimuth = positiveInteger(fixedOptical.azimuthSamples, `${path}.fixedOpticalResolution.azimuthSamples`);
  const fixedMeridional = positiveInteger(fixedOptical.meridionalSegments, `${path}.fixedOpticalResolution.meridionalSegments`);
  if (fixedAzimuth !== expectedOpticalResolution.azimuthSamples
    || fixedMeridional !== expectedOpticalResolution.meridionalSegments
    || (axis === "circuit"
      && positiveInteger(source.fixedPhaseSamples, `${path}.fixedPhaseSamples`) !== expectedOtherSamples)) {
    throw new Error(`${path} does not hold the declared finest optical/selected phase resolution fixed.`);
  }
  const levels = array(source.levels, `${path}.levels`).map((entry, index): EngineeringAxisLevel => {
    const levelPath = `${path}.levels[${index}]`;
    const item = record(entry, levelPath);
    const result = {
      levelId: text(item.levelId, `${levelPath}.levelId`),
      phaseSamples: positiveInteger(item.phaseSamples, `${levelPath}.phaseSamples`),
      circuitSamples: positiveInteger(item.circuitSamples, `${levelPath}.circuitSamples`),
      layoutId: text(item.layoutId, `${levelPath}.layoutId`),
      cellIds: stringArray(item.cellIds, `${levelPath}.cellIds`),
      stringIds: stringArray(item.stringIds, `${levelPath}.stringIds`),
      bypassSubstringIds: stringArray(item.bypassSubstringIds, `${levelPath}.bypassSubstringIds`),
      cellTopologyFingerprint: sha256(item.cellTopologyFingerprint, `${levelPath}.cellTopologyFingerprint`),
      dcWh: nonnegative(item.dcWh, `${levelPath}.dcWh`),
      acWh: nonnegative(item.acWh, `${levelPath}.acWh`),
      idealLocalMppDcWh: nonnegative(item.idealLocalMppDcWh, `${levelPath}.idealLocalMppDcWh`),
      bypassActivationWeightedHours: nonnegative(item.bypassActivationWeightedHours, `${levelPath}.bypassActivationWeightedHours`),
      maximumExtractionClosureErrorW: nonnegative(item.maximumExtractionClosureErrorW, `${levelPath}.maximumExtractionClosureErrorW`),
      topologyInvariant: bool(item.topologyInvariant, `${levelPath}.topologyInvariant`),
      solveCount: positiveInteger(item.solveCount, `${levelPath}.solveCount`),
      repeatedSolveMs: nonnegative(item.repeatedSolveMs, `${levelPath}.repeatedSolveMs`),
    };
    if (result.dcWh > result.idealLocalMppDcWh && !close(result.dcWh, result.idealLocalMppDcWh)
      || result.maximumExtractionClosureErrorW > 1e-8 * Math.max(1, result.dcWh)) {
      throw new Error(`${levelPath} violates the ideal upper bound or extraction closure.`);
    }
    return result;
  });
  if (levels.length !== declaredSamples.length || levels.length < requiredConsecutivePairs + 1
    || levels.some((level, index) => (axis === "phase" ? level.phaseSamples : level.circuitSamples)
      !== declaredSamples[index])
    || levels.some((level) => (axis === "phase" ? level.circuitSamples : level.phaseSamples)
      !== expectedOtherSamples)) {
    throw new Error(`${path}.levels disagree with the declared three-level ${axis} samples.`);
  }
  const first = levels[0];
  const topologyInvariant = levels.every((level) => level.layoutId === first.layoutId
    && level.cellTopologyFingerprint === first.cellTopologyFingerprint
    && sameStrings(level.cellIds, first.cellIds)
    && sameStrings(level.stringIds, first.stringIds)
    && sameStrings(level.bypassSubstringIds, first.bypassSubstringIds)
    && level.topologyInvariant);
  if (reportedTopologyInvariant !== topologyInvariant) {
    throw new Error(`${path}.topologyInvariant disagrees with stable topology IDs.`);
  }
  const consecutiveDeltas = array(source.consecutiveDeltas, `${path}.consecutiveDeltas`).map((entry, index) => {
    const deltaPath = `${path}.consecutiveDeltas[${index}]`;
    const item = record(entry, deltaPath);
    const coarse = levels[index];
    const fine = levels[index + 1];
    if (!coarse || !fine) throw new Error(`${deltaPath} has no adjacent levels.`);
    const calculated = Math.abs(coarse.acWh - fine.acWh) / Math.max(1e-12, Math.abs(fine.acWh));
    const relativeDifference = finite(item.relativeDifference, `${deltaPath}.relativeDifference`);
    const deltaTolerance = finite(item.toleranceFraction, `${deltaPath}.toleranceFraction`);
    const pass = bool(item.pass, `${deltaPath}.pass`);
    if (text(item.coarseLevelId, `${deltaPath}.coarseLevelId`) !== coarse.levelId
      || text(item.fineLevelId, `${deltaPath}.fineLevelId`) !== fine.levelId
      || !close(relativeDifference, calculated) || !close(deltaTolerance, toleranceFraction)
      || pass !== (calculated <= toleranceFraction)) {
      throw new Error(`${deltaPath} disagrees with adjacent ${axis} AC energies.`);
    }
    return { coarseLevelId: coarse.levelId, fineLevelId: fine.levelId, relativeDifference, toleranceFraction: deltaTolerance, pass };
  });
  const expectedPass = topologyInvariant && consecutiveDeltas.length === levels.length - 1
    && consecutiveDeltas.slice(-requiredConsecutivePairs).every((delta) => delta.pass);
  const pass = bool(source.pass, `${path}.pass`);
  if (pass !== expectedPass) throw new Error(`${path}.pass disagrees with topology and consecutive deltas.`);
  return { pass, topologyInvariant, levels, consecutiveDeltas };
}

function parsePhaseConvergence(
  value: unknown,
  path: string,
  required: boolean,
  declaredSamples: readonly number[],
  toleranceFraction: number,
  requiredConsecutivePairs: number,
  expectedOpticalResolution: Pick<EngineeringMeshResolution, "azimuthSamples" | "meridionalSegments">,
  expectedCircuitSamples: number,
): EngineeringPhaseConvergence {
  const source = record(value, path);
  const reportedRequired = bool(source.required, `${path}.required`);
  const status = text(source.status, `${path}.status`);
  if (reportedRequired !== required) throw new Error(`${path}.required disagrees with its geometry contract.`);
  if (!required) {
    if (status !== "not-applicable-stationary-rpm0"
      || !bool(source.pass, `${path}.pass`)
      || !bool(source.topologyInvariant, `${path}.topologyInvariant`)
      || array(source.levels, `${path}.levels`).length !== 0
      || array(source.consecutiveDeltas, `${path}.consecutiveDeltas`).length !== 0) {
      throw new Error(`${path} must be explicit N/A evidence for stationary RPM=0.`);
    }
    const fixed = record(source.fixedOpticalResolution, `${path}.fixedOpticalResolution`);
    if (positiveInteger(fixed.azimuthSamples, `${path}.fixedOpticalResolution.azimuthSamples`) !== expectedOpticalResolution.azimuthSamples
      || positiveInteger(fixed.meridionalSegments, `${path}.fixedOpticalResolution.meridionalSegments`) !== expectedOpticalResolution.meridionalSegments) {
      throw new Error(`${path} N/A evidence must retain the finest optical resolution.`);
    }
    return { required: false, status, pass: true, topologyInvariant: true, levels: [], consecutiveDeltas: [] };
  }
  if (status !== "evaluated") throw new Error(`${path}.status must be evaluated for swept rotation.`);
  const evaluated = parseAxisConvergence(
    source, path, "phase", declaredSamples, toleranceFraction,
    requiredConsecutivePairs, expectedOpticalResolution, expectedCircuitSamples,
  );
  return { required: true, status, ...evaluated };
}

export const ENGINEERING_MESH_ARTIFACT_PATH = "docs/engineering-mesh-convergence-audit-2026.json";
export const ENGINEERING_MESH_GATE_PATH = "src/lib/physics/engineering-mesh-validation.generated.json";

export type EngineeringMeshGate = {
  schemaVersion: 1;
  status: "pass";
  generatedAt: string;
  artifactSchemaVersion: 2;
  artifactPath: typeof ENGINEERING_MESH_ARTIFACT_PATH;
  artifactSha256: string;
  configurationSha256: string;
  implementationSha256: string;
  officialMinimumResolution: EngineeringMeshResolution;
  layoutVersion: string;
  contracts: Array<{
    contractId: EngineeringMeshGeometryContract["contractId"];
    footprintMode: EngineeringMeshGeometryContract["footprintMode"];
    phaseGateRequired: boolean;
    pass: boolean;
    shapes: Array<{ shape: EngineeringValidationShape; pass: boolean }>;
  }>;
  officialRankingEligible: true;
};

export function validateEngineeringMeshAudit(value: unknown, rootDir = process.cwd()): EngineeringMeshAudit {
  const source = record(value, "engineeringMesh");
  expectExactKeys(source, [
    "schemaVersion", "generatedAt", "implementation", "fixture", "topology", "convergence",
    "performanceBaseline", "rootCause", "geometryContracts", "pass", "officialRankingEligible", "elapsedMs",
  ], "engineeringMesh");
  if (source.schemaVersion !== 2) throw new Error("engineeringMesh.schemaVersion must be 2.");
  const generatedAt = timestamp(source.generatedAt, "engineeringMesh.generatedAt");
  const fixture = record(source.fixture, "engineeringMesh.fixture");
  const fixtureConfiguration = record(fixture.configuration, "engineeringMesh.fixture.configuration");
  const fixtureConfigurationSha256 = sha256(fixture.configurationSha256, "engineeringMesh.fixture.configurationSha256");
  if (fixtureConfigurationSha256 !== digestCanonicalJson(fixtureConfiguration)) {
    throw new Error("engineeringMesh fixture configuration SHA disagrees with canonical configuration bytes.");
  }
  const fixtureImplementationSha256 = sha256(fixture.implementationSha256, "engineeringMesh.fixture.implementationSha256");
  const fixtureImplementationSourceFiles = stringArray(fixture.implementationSourceFiles, "engineeringMesh.fixture.implementationSourceFiles");
  const implementationSource = record(source.implementation, "engineeringMesh.implementation");
  const implementation = {
    sourceFiles: stringArray(implementationSource.sourceFiles, "engineeringMesh.implementation.sourceFiles"),
    sha256: sha256(implementationSource.sha256, "engineeringMesh.implementation.sha256"),
  };
  const calculatedImplementation = meshImplementationFingerprint(
    implementation.sourceFiles,
    rootDir,
    MESH_REQUIRED_IMPLEMENTATION_FILES,
    "engineeringMesh.implementation",
  );
  if (fixtureImplementationSha256 !== implementation.sha256
    || implementation.sha256 !== calculatedImplementation
    || !sameStrings(fixtureImplementationSourceFiles, implementation.sourceFiles)) {
    throw new Error("engineeringMesh implementation SHA/source list disagrees with current source bytes.");
  }

  const topologySource = record(source.topology, "engineeringMesh.topology");
  const topology: EngineeringMeshTopology = {
    layoutVersion: text(topologySource.layoutVersion, "engineeringMesh.topology.layoutVersion"),
    nominalCellAreaM2: nonnegative(topologySource.nominalCellAreaM2, "engineeringMesh.topology.nominalCellAreaM2"),
    parallelStrings: positiveInteger(topologySource.parallelStrings, "engineeringMesh.topology.parallelStrings"),
    cellsPerBypassSubstring: positiveInteger(topologySource.cellsPerBypassSubstring, "engineeringMesh.topology.cellsPerBypassSubstring"),
    bypassForwardVoltageV: nonnegative(topologySource.bypassForwardVoltageV, "engineeringMesh.topology.bypassForwardVoltageV"),
    stringWiringResistanceOhm: nonnegative(topologySource.stringWiringResistanceOhm, "engineeringMesh.topology.stringWiringResistanceOhm"),
    arrayWiringResistanceOhm: nonnegative(topologySource.arrayWiringResistanceOhm, "engineeringMesh.topology.arrayWiringResistanceOhm"),
    cellIvModel: text(topologySource.cellIvModel, "engineeringMesh.topology.cellIvModel"),
  };
  if (topology.nominalCellAreaM2 <= 0) throw new Error("engineeringMesh nominal cell area must be positive.");

  const convergenceSource = record(source.convergence, "engineeringMesh.convergence");
  const toleranceFraction = finite(convergenceSource.toleranceFraction, "engineeringMesh.convergence.toleranceFraction");
  const requiredConsecutivePairs = positiveInteger(convergenceSource.requiredConsecutivePairs, "engineeringMesh.convergence.requiredConsecutivePairs");
  if (!close(toleranceFraction, 0.02, 1e-12) || requiredConsecutivePairs !== 2) {
    throw new Error("engineeringMesh convergence contract must retain the predeclared 2% / two-pair gate.");
  }
  const officialMinimumResolution = resolution(convergenceSource.officialMinimumResolution, "engineeringMesh.convergence.officialMinimumResolution");
  const opticalMeshLevels = array(convergenceSource.opticalMeshLevels, "engineeringMesh.convergence.opticalMeshLevels").map((entry, index) => {
    const path = `engineeringMesh.convergence.opticalMeshLevels[${index}]`;
    const item = record(entry, path);
    return {
      id: text(item.id, `${path}.id`),
      azimuthSamples: positiveInteger(item.azimuthSamples, `${path}.azimuthSamples`),
      meridionalSegments: positiveInteger(item.meridionalSegments, `${path}.meridionalSegments`),
      circuitSamples: positiveInteger(item.circuitSamples, `${path}.circuitSamples`),
    };
  });
  const phaseLevels = array(convergenceSource.phaseLevels, "engineeringMesh.convergence.phaseLevels")
    .map((entry, index) => positiveInteger(entry, `engineeringMesh.convergence.phaseLevels[${index}]`));
  const circuitLevels = array(convergenceSource.circuitLevels, "engineeringMesh.convergence.circuitLevels")
    .map((entry, index) => positiveInteger(entry, `engineeringMesh.convergence.circuitLevels[${index}]`));
  if (opticalMeshLevels.length < requiredConsecutivePairs + 1
    || phaseLevels.length < requiredConsecutivePairs + 1 || circuitLevels.length < requiredConsecutivePairs + 1
    || new Set(opticalMeshLevels.map((level) => level.id)).size !== opticalMeshLevels.length) {
    throw new Error("engineeringMesh must declare at least three unique independent resolutions.");
  }
  for (let index = 1; index < opticalMeshLevels.length; index += 1) {
    const coarse = opticalMeshLevels[index - 1];
    const fine = opticalMeshLevels[index];
    if (fine.azimuthSamples <= coarse.azimuthSamples || fine.meridionalSegments <= coarse.meridionalSegments
      || fine.circuitSamples < coarse.circuitSamples) {
      throw new Error("engineeringMesh levels are not monotonically refined independent resolutions.");
    }
  }
  if (phaseLevels.some((entry, index) => index > 0 && entry <= phaseLevels[index - 1])
    || circuitLevels.some((entry, index) => index > 0 && entry <= circuitLevels[index - 1])
    || opticalMeshLevels.at(-2)?.azimuthSamples !== officialMinimumResolution.azimuthSamples
    || opticalMeshLevels.at(-2)?.meridionalSegments !== officialMinimumResolution.meridionalSegments
    || opticalMeshLevels.at(-2)?.circuitSamples !== officialMinimumResolution.circuitSamples
    || officialMinimumResolution.phaseSamples !== phaseLevels.at(-2)
    || officialMinimumResolution.circuitSamples !== circuitLevels.at(-2)) {
    throw new Error("engineeringMesh official minimum resolution is absent from the declared levels.");
  }

  const geometryContracts = array(source.geometryContracts, "engineeringMesh.geometryContracts")
    .map((contractEntry, contractIndex): EngineeringMeshGeometryContract => {
      const contractPath = `engineeringMesh.geometryContracts[${contractIndex}]`;
      const contractSource = record(contractEntry, contractPath);
      const contractId = text(contractSource.contractId, `${contractPath}.contractId`);
      const isStatic = contractId === "static-land-matched";
      const isSwept = contractId === "swept-rotation-envelope";
      if (!isStatic && !isSwept) throw new Error(`${contractPath}.contractId is unsupported.`);
      const footprintMode = text(contractSource.footprintMode, `${contractPath}.footprintMode`);
      const rotationModel = text(contractSource.rotationModel, `${contractPath}.rotationModel`);
      const phaseGateRequired = bool(contractSource.phaseGateRequired, `${contractPath}.phaseGateRequired`);
      if ((isStatic && (footprintMode !== "static" || rotationModel !== "stationary-rpm0" || phaseGateRequired))
        || (isSwept && (footprintMode !== "swept" || rotationModel !== "controlled-y-axis-phase-quadrature" || !phaseGateRequired))) {
        throw new Error(`${contractPath} geometry/rotation/phase contract is inconsistent.`);
      }
      const contractPhaseSamples = phaseGateRequired ? officialMinimumResolution.phaseSamples : 1;
      const shapes = array(contractSource.shapes, `${contractPath}.shapes`).map((entry, shapeIndex): EngineeringMeshShape => {
    const path = `${contractPath}.shapes[${shapeIndex}]`;
    const shapeSource = record(entry, path);
    const shape = text(shapeSource.shape, `${path}.shape`) as EngineeringValidationShape;
    if (!ENGINEERING_VALIDATION_SHAPES.includes(shape)) throw new Error(`${path}.shape is unsupported.`);
    const activeAreaM2 = nonnegative(shapeSource.activeAreaM2, `${path}.activeAreaM2`);
    const layoutId = text(shapeSource.layoutId, `${path}.layoutId`);
    const levels = array(shapeSource.levels, `${path}.levels`).map(
      (level, levelIndex) => parseMeshLevel(level, `${path}.levels[${levelIndex}]`),
    );
    if (levels.length !== opticalMeshLevels.length || levels.some((level, index) =>
      level.levelId !== opticalMeshLevels[index].id
        || level.resolution.azimuthSamples !== opticalMeshLevels[index].azimuthSamples
        || level.resolution.meridionalSegments !== opticalMeshLevels[index].meridionalSegments
        || level.resolution.phaseSamples !== contractPhaseSamples
        || level.resolution.circuitSamples !== opticalMeshLevels[index].circuitSamples)) {
      throw new Error(`${path}.levels disagree with the declared convergence levels.`);
    }
    const first = levels[0];
    const topologyInvariant = levels.every((level) => level.layoutId === layoutId
      && level.cellCount === first.cellCount
      && level.cellTopologyFingerprint === first.cellTopologyFingerprint
      && sameStrings(level.cellIds, first.cellIds)
      && sameStrings(level.stringIds, first.stringIds)
      && sameNumbers(level.seriesCellCountByString, first.seriesCellCountByString)
      && sameStrings(level.bypassSubstringIds, first.bypassSubstringIds)
      && level.parallelStringCount === topology.parallelStrings
      && level.bypassSubstringCount === first.bypassSubstringCount);
    const cellAreaInvariant = activeAreaM2 > 0 && levels.every((level) =>
      close(level.activeAreaM2, activeAreaM2, 1e-10)
        && close(level.clippedAreaM2, activeAreaM2, 1e-9));
    if (bool(shapeSource.topologyInvariant, `${path}.topologyInvariant`) !== topologyInvariant
      || bool(shapeSource.cellAreaInvariant, `${path}.cellAreaInvariant`) !== cellAreaInvariant) {
      throw new Error(`${path} reported topology/area invariants disagree with recomputation.`);
    }

    const consecutiveDeltas = array(shapeSource.consecutiveDeltas, `${path}.consecutiveDeltas`).map((delta, index) => {
      const deltaPath = `${path}.consecutiveDeltas[${index}]`;
      const item = record(delta, deltaPath);
      const coarse = levels[index];
      const fine = levels[index + 1];
      if (!coarse || !fine) throw new Error(`${deltaPath} has no adjacent level pair.`);
      const relativeDifference = finite(item.relativeDifference, `${deltaPath}.relativeDifference`);
      const deltaTolerance = finite(item.toleranceFraction, `${deltaPath}.toleranceFraction`);
      const calculated = Math.abs(coarse.acWh - fine.acWh) / Math.max(1e-12, Math.abs(fine.acWh));
      const pass = bool(item.pass, `${deltaPath}.pass`);
      if (text(item.coarseLevelId, `${deltaPath}.coarseLevelId`) !== coarse.levelId
        || text(item.fineLevelId, `${deltaPath}.fineLevelId`) !== fine.levelId
        || !close(relativeDifference, calculated, 1e-10)
        || !close(deltaTolerance, toleranceFraction, 1e-12)
        || pass !== (calculated <= toleranceFraction)) {
        throw new Error(`${deltaPath} disagrees with adjacent AC energies and the 2% tolerance.`);
      }
      return {
        coarseLevelId: coarse.levelId,
        fineLevelId: fine.levelId,
        relativeDifference,
        toleranceFraction: deltaTolerance,
        pass,
      };
    });
    if (consecutiveDeltas.length !== levels.length - 1) {
      throw new Error(`${path} must report every consecutive level pair.`);
    }
    const requiredDeltas = consecutiveDeltas.slice(-requiredConsecutivePairs);
    const opticalMeshPass = topologyInvariant && cellAreaInvariant
      && requiredDeltas.length === requiredConsecutivePairs
      && requiredDeltas.every((delta) => delta.pass);
    if (bool(shapeSource.opticalMeshPass, `${path}.opticalMeshPass`) !== opticalMeshPass) {
      throw new Error(`${path}.opticalMeshPass disagrees with the optical level evidence.`);
    }
    const phaseConvergence = parsePhaseConvergence(
      shapeSource.phaseConvergence,
      `${path}.phaseConvergence`,
      phaseGateRequired,
      phaseLevels,
      toleranceFraction,
      requiredConsecutivePairs,
      opticalMeshLevels.at(-1)!,
      officialMinimumResolution.circuitSamples,
    );
    const circuitConvergence = parseAxisConvergence(
      shapeSource.circuitConvergence,
      `${path}.circuitConvergence`,
      "circuit",
      circuitLevels,
      toleranceFraction,
      requiredConsecutivePairs,
      opticalMeshLevels.at(-1)!,
      contractPhaseSamples,
    );
    const recalculatedPass = opticalMeshPass && phaseConvergence.pass && circuitConvergence.pass;
    const pass = bool(shapeSource.pass, `${path}.pass`);
    const officialEligible = bool(shapeSource.officialEligible, `${path}.officialEligible`);
    if (pass !== recalculatedPass || officialEligible !== recalculatedPass) {
      throw new Error(`${path} pass/official eligibility disagrees with the invariant and convergence evidence.`);
    }
    return {
      shape, pass, officialEligible, activeAreaM2, layoutId,
      topologyInvariant, cellAreaInvariant, opticalMeshPass, levels, consecutiveDeltas,
      phaseConvergence, circuitConvergence,
    };
  });
      expectCompleteShapeSet(shapes.map((shape) => shape.shape), `${contractPath}.shapes`);
      const calculatedContractPass = shapes.every((shape) => shape.pass && shape.officialEligible);
      const contractPass = bool(contractSource.pass, `${contractPath}.pass`);
      const officialEligible = bool(contractSource.officialEligible, `${contractPath}.officialEligible`);
      if (contractPass !== calculatedContractPass || officialEligible !== calculatedContractPass) {
        throw new Error(`${contractPath} gate disagrees with its six shape gates.`);
      }
      return {
        contractId: isStatic ? "static-land-matched" : "swept-rotation-envelope",
        footprintMode: isStatic ? "static" : "swept",
        rotationModel: isStatic ? "stationary-rpm0" : "controlled-y-axis-phase-quadrature",
        phaseGateRequired,
        shapes,
        pass: contractPass,
        officialEligible,
      };
    });
  if (geometryContracts.length !== 2
    || geometryContracts[0]?.contractId !== "static-land-matched"
    || geometryContracts[1]?.contractId !== "swept-rotation-envelope") {
    throw new Error("engineeringMesh.geometryContracts must contain static then swept exactly once.");
  }
  const expectedPass = geometryContracts.every((contract) => contract.pass && contract.officialEligible);
  const pass = bool(source.pass, "engineeringMesh.pass");
  const officialRankingEligible = bool(source.officialRankingEligible, "engineeringMesh.officialRankingEligible");
  if (pass !== expectedPass || officialRankingEligible !== expectedPass) {
    throw new Error("engineeringMesh top-level gate disagrees with both geometry contracts.");
  }
  const performanceBaseline = record(source.performanceBaseline, "engineeringMesh.performanceBaseline");
  const rootCause = record(source.rootCause, "engineeringMesh.rootCause");
  if (Object.keys(rootCause).length === 0 || Object.keys(performanceBaseline).length === 0) {
    throw new Error("engineeringMesh must report root-cause and performance evidence.");
  }
  return {
    schemaVersion: 2,
    generatedAt,
    fixture,
    topology,
    convergence: {
      toleranceFraction,
      requiredConsecutivePairs,
      officialMinimumResolution,
      opticalMeshLevels,
      phaseLevels,
      circuitLevels,
    },
    performanceBaseline,
    rootCause,
    geometryContracts,
    pass,
    officialRankingEligible,
    elapsedMs: nonnegative(source.elapsedMs, "engineeringMesh.elapsedMs"),
    implementation,
  };
}

export function validateEngineeringMeshGate(
  value: unknown,
  audit: EngineeringMeshAudit,
  rootDir = process.cwd(),
): EngineeringMeshGate {
  const source = record(value, "engineeringMeshGate");
  expectExactKeys(source, [
    "schemaVersion", "status", "generatedAt", "artifactSchemaVersion", "artifactPath", "artifactSha256",
    "configurationSha256", "implementationSha256", "officialMinimumResolution", "layoutVersion", "contracts",
    "officialRankingEligible",
  ], "engineeringMeshGate");
  if (source.schemaVersion !== 1 || source.artifactSchemaVersion !== 2) {
    throw new Error("engineeringMeshGate schema versions are unsupported.");
  }
  if (source.status !== "pass" || source.officialRankingEligible !== true
    || !audit.pass || !audit.officialRankingEligible) {
    throw new Error("engineeringMeshGate must be status=pass and agree with the full official audit.");
  }
  const generatedAt = timestamp(source.generatedAt, "engineeringMeshGate.generatedAt");
  if (generatedAt !== audit.generatedAt) throw new Error("engineeringMeshGate generatedAt disagrees with its artifact.");
  const artifactPath = text(source.artifactPath, "engineeringMeshGate.artifactPath");
  if (artifactPath !== ENGINEERING_MESH_ARTIFACT_PATH) throw new Error("engineeringMeshGate artifactPath is unexpected.");
  const artifactSha256 = sha256(source.artifactSha256, "engineeringMeshGate.artifactSha256");
  const artifactBytes = readFileSync(assertPathInsideRoot(rootDir, artifactPath, "engineeringMeshGate"));
  if (artifactSha256 !== createHash("sha256").update(artifactBytes).digest("hex")) {
    throw new Error("engineeringMeshGate artifact SHA disagrees with current JSON bytes.");
  }
  const configurationSha256 = sha256(source.configurationSha256, "engineeringMeshGate.configurationSha256");
  const auditConfigurationSha256 = sha256(audit.fixture.configurationSha256, "engineeringMesh.fixture.configurationSha256");
  const implementationSha256 = sha256(source.implementationSha256, "engineeringMeshGate.implementationSha256");
  if (configurationSha256 !== auditConfigurationSha256 || implementationSha256 !== audit.implementation.sha256) {
    throw new Error("engineeringMeshGate configuration/implementation fingerprints disagree with its artifact.");
  }
  const officialMinimumResolution = resolution(source.officialMinimumResolution, "engineeringMeshGate.officialMinimumResolution");
  if (!sameResolution(officialMinimumResolution, audit.convergence.officialMinimumResolution)) {
    throw new Error("engineeringMeshGate official resolution disagrees with its artifact.");
  }
  const layoutVersion = text(source.layoutVersion, "engineeringMeshGate.layoutVersion");
  if (layoutVersion !== audit.topology.layoutVersion) throw new Error("engineeringMeshGate layout version disagrees.");
  const contracts = array(source.contracts, "engineeringMeshGate.contracts").map((entry, contractIndex) => {
    const path = `engineeringMeshGate.contracts[${contractIndex}]`;
    const item = record(entry, path);
    expectExactKeys(item, ["contractId", "footprintMode", "phaseGateRequired", "pass", "shapes"], path);
    const expected = audit.geometryContracts[contractIndex];
    if (!expected) throw new Error(`${path} has no corresponding full-audit contract.`);
    const shapes = array(item.shapes, `${path}.shapes`).map((shapeEntry, shapeIndex) => {
      const shapePath = `${path}.shapes[${shapeIndex}]`;
      const shapeItem = record(shapeEntry, shapePath);
      expectExactKeys(shapeItem, ["shape", "pass"], shapePath);
      const expectedShape = expected.shapes[shapeIndex];
      const shape = text(shapeItem.shape, `${shapePath}.shape`) as EngineeringValidationShape;
      const pass = bool(shapeItem.pass, `${shapePath}.pass`);
      if (!expectedShape || shape !== expectedShape.shape || pass !== expectedShape.pass) {
        throw new Error(`${shapePath} disagrees with the full mesh artifact.`);
      }
      return { shape, pass };
    });
    const contractId = text(item.contractId, `${path}.contractId`);
    const footprintMode = text(item.footprintMode, `${path}.footprintMode`);
    const phaseGateRequired = bool(item.phaseGateRequired, `${path}.phaseGateRequired`);
    const pass = bool(item.pass, `${path}.pass`);
    if (shapes.length !== expected.shapes.length || contractId !== expected.contractId
      || footprintMode !== expected.footprintMode || phaseGateRequired !== expected.phaseGateRequired
      || pass !== expected.pass) throw new Error(`${path} disagrees with the full mesh artifact.`);
    return { contractId: expected.contractId, footprintMode: expected.footprintMode, phaseGateRequired, pass, shapes };
  });
  if (contracts.length !== audit.geometryContracts.length) throw new Error("engineeringMeshGate contracts are incomplete.");
  return {
    schemaVersion: 1, status: "pass", generatedAt, artifactSchemaVersion: 2,
    artifactPath: ENGINEERING_MESH_ARTIFACT_PATH, artifactSha256, configurationSha256, implementationSha256,
    officialMinimumResolution, layoutVersion, contracts, officialRankingEligible: true,
  };
}
