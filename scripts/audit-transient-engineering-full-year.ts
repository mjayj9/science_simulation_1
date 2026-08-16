import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import {
  commonMaximumHeightM,
  createComparisonSurface,
  type ComparisonFootprintMode,
  type ComparisonShapeKind,
  type ComparisonSurfaceModel,
} from "../src/lib/geometry/index";
import {
  DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER,
  DEFAULT_THERMAL,
  DEFAULT_TRANSIENT_THERMAL_CONFIG,
  ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
  ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  annualTransientPhaseAtInterval,
  mergeAnnualTransientSurfaceSegments,
  simulateAnnualRotationDecomposition,
  simulateAnnualTransientSurface,
  type AnnualTransientSurfaceInput,
  type AnnualTransientSurfaceResult,
} from "../src/lib/physics/index";
import { getOfflineWeather, type WeatherPoint } from "../src/lib/weather/index";
import { runSimulationKernel } from "../src/workers/kernel";
import {
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  type SimulationKernelInput,
  type SimulationVariantWorkItem,
} from "../src/workers/protocol";
import {
  validateEngineeringMeshAudit,
  validateEngineeringMeshGate,
} from "./engineering-validation-contract";
import { validateAnnualAudit, validateThermalAudit } from "./validation-report-contract";
import { acceptExactTransientEngineeringCheckpoint } from "./transient-engineering-checkpoint";
import { computeSourceClosure } from "./source-closure";

const jsonPath = process.argv[3]?.startsWith("--")
  ? "docs/transient-engineering-full-year-audit-2026.json"
  : process.argv[3] ?? "docs/transient-engineering-full-year-audit-2026.json";
const markdownPath = process.argv[4]?.startsWith("--")
  ? "docs/transient-engineering-full-year-audit-2026.md"
  : process.argv[4] ?? "docs/transient-engineering-full-year-audit-2026.md";
const meshAuditPath = "docs/engineering-mesh-convergence-audit-2026.json";
const meshValidationGatePath = "src/lib/physics/engineering-mesh-validation.generated.json";
const idealAuditPath = "docs/full-year-comparison-audit-2026.json";
const thermalAuditPath = "docs/annual-transient-audit-2026.json";
const baselineFixturePath = "tests/fixtures/d9ff14a-ideal-annual-baseline.json";
const checkpointPath = "docs/.transient-engineering-full-year-audit-checkpoint.json";
const validationGatePath = "src/lib/physics/transient-engineering-validation.generated.json";
const preflightOnly = process.argv.includes("--preflight-only");
const requestedShapesArgument = process.argv.find((argument) => argument.startsWith("--shapes="))
  ?.slice("--shapes=".length);

const SCHEMA_VERSION = 1;
const COMPUTATION_SCHEMA_VERSION = 1;
const YEAR = 2025;
const LAND_AREA_M2 = 0.05;
const MAXIMUM_HEIGHT_M = commonMaximumHeightM(LAND_AREA_M2);
const CONTROLLED_RPM = 2;
const REPORTING_OFFSET_MINUTES = 540;
const REPORTING_OFFSET_MS = REPORTING_OFFSET_MINUTES * 60_000;
const LOCATION = Object.freeze({ latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 });
const WEATHER_SEED = "full-year-fair-comparison-2025";
const THERMAL_NODE_COUNT = 6;
const THERMAL_MAXIMUM_SUBSTEP_SECONDS = 900;
const THERMAL_MESH_ENERGY_TOLERANCE_FRACTION = 0.01;
const THERMAL_MESH_TEMPERATURE_TOLERANCE_C = 0.2;
const OFFICIAL_COUPLING_STEP_SECONDS = 900;
const COUPLING_STEPS_SECONDS = Object.freeze([3_600, 1_800, 900] as const);
const COUPLING_TOLERANCE_FRACTION = 0.02;
const BASELINE_RELATIVE_TOLERANCE = 0.001;
const SEASON_DAY_OFFSETS = Object.freeze([19, 109, 201, 293]);
const SHAPES = Object.freeze([
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
] as const satisfies readonly ComparisonShapeKind[]);
const MOTOR_DRIVE = Object.freeze({
  requiredTorqueNm: 0.002,
  motorEfficiency: 0.85,
  source: "user-assumption for audit; not measured and not fitted",
  confidence: "low",
});
const WARMUP = Object.freeze({
  periodHours: 24,
  minimumCycles: 2,
  maximumCycles: 8,
  convergenceToleranceC: 0.05,
});
const electricalReference = Object.freeze({
  ...DEFAULT_ELECTRICAL,
  efficiency: 0.2,
  pmaxW: DEFAULT_ELECTRICAL.areaM2 * 0.2 * DEFAULT_ELECTRICAL.referenceIrradianceWm2,
  gammaPmpPerC: -0.004,
  cellsInSeries: 1,
});
const inverter = Object.freeze({
  ...DEFAULT_INVERTER,
  ratedAcPowerW: 100,
  nominalEfficiency: 0.96,
  mpptMinVoltageV: 0.1,
  mpptMaxVoltageV: 100,
  maxDcVoltageV: 500,
  maxInputCurrentA: 100,
  startPowerW: 0,
  nightConsumptionW: 0,
  wiringLossFraction: 0.015,
});
const certifiedFixture = Object.freeze({
  year: YEAR,
  location: LOCATION,
  reportingOffsetMinutes: REPORTING_OFFSET_MINUTES,
  weather: {
    source: "offline/model-estimate (not measured Seoul TMY)",
    seed: WEATHER_SEED,
    preset: "partly-cloudy",
    stepMinutes: 60,
    intervals: 8760,
    closingEndpointPresent: true,
  },
  geometry: {
    landAreaM2: LAND_AREA_M2,
    maximumHeightM: MAXIMUM_HEIGHT_M,
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
  pv: { referenceCell: electricalReference, electricalAvailabilityFactor: 1, absorptivity: 0.9 },
  inverter,
  thermal: {
    materialConfig: { ...DEFAULT_TRANSIENT_THERMAL_CONFIG, maximumSubstepSeconds: 900 },
    thermalNodeCount: THERMAL_NODE_COUNT,
  },
  controlledRotation: { rpm: CONTROLLED_RPM, motor: MOTOR_DRIVE },
  connection: OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
});
/**
 * Both fingerprints are derived, never hand-listed. A literal file list cannot
 * stay complete: `annual-transient.ts` reaches `solar.ts`, `irradiance.ts` and
 * `vector.ts` transitively, so a hand-maintained list silently certified annual
 * numbers against sources it had never hashed.
 *
 * The two closures are deliberately different. The implementation fingerprint
 * covers the audit and reporting code as well, and identifies the artifact. The
 * computation fingerprint covers only modules that can change a computed
 * number, and keys the resumable checkpoint — so editing a report table does
 * not discard hours of completed annual work, while editing any physics module
 * does.
 */
const IMPLEMENTATION_SOURCE_FILES = computeSourceClosure({
  entryPoints: [
    "scripts/audit-transient-engineering-full-year.ts",
    "scripts/audit-annual-transient.ts",
  ],
  rootDir: process.cwd(),
  label: "transientEngineering.implementation",
});
const COMPUTATION_SOURCE_FILES = computeSourceClosure({
  entryPoints: [
    "src/lib/geometry/index.ts",
    "src/lib/physics/index.ts",
    "src/lib/weather/index.ts",
    "src/workers/kernel.ts",
    "src/workers/protocol.ts",
  ],
  rootDir: process.cwd(),
  // This audit writes the gate before it computes, so hashing it would make the
  // checkpoint fingerprint depend on the previous run's own output.
  excluded: ["src/lib/physics/transient-engineering-validation.generated.json"],
  label: "transientEngineering.computation",
});

interface MeshResolution {
  azimuthSamples: number;
  meridionalSegments: number;
  phaseSamples: number;
  circuitSamples: number;
}

interface MeshAuditLevel {
  levelId: string;
  resolution: MeshResolution;
  layoutId: string;
}

interface MeshAuditShape {
  shape: ComparisonShapeKind;
  pass: boolean;
  officialEligible: boolean;
  layoutId: string;
  levels: MeshAuditLevel[];
  consecutiveDeltas: unknown[];
  opticalMeshPass: boolean;
  phaseConvergence: {
    required: boolean;
    status: string;
    pass: boolean;
    topologyInvariant?: boolean;
  };
  circuitConvergence: { pass: boolean; topologyInvariant: boolean };
}

interface MeshAuditGeometryContract {
  contractId: "static-land-matched" | "swept-rotation-envelope";
  footprintMode: "static" | "swept";
  rotationModel: string;
  phaseGateRequired: boolean;
  shapes: MeshAuditShape[];
  pass: boolean;
  officialEligible: boolean;
}

interface MeshAuditArtifact {
  schemaVersion: number;
  pass: boolean;
  officialRankingEligible: boolean;
  geometryContracts: MeshAuditGeometryContract[];
  implementation: {
    sha256: string;
  };
  fixture: {
    configurationSha256: string;
    implementationSha256: string;
  };
  convergence: {
    officialMinimumResolution: MeshResolution;
  };
}

interface ThermalAuditArtifact {
  schemaVersion: number;
  pass: boolean;
  scenario: {
    thermalNodes: number;
    expectedIntervals: number;
  };
  acceptance: {
    heatResidualToleranceFraction: number;
    thermalMeshEnergyToleranceFraction: number;
    thermalMeshTemperatureToleranceC: number;
  };
  thermalMesh: {
    requestedThermalNodeCount: number;
    thermalNodeCount: number;
  };
  meshConvergence14Day: {
    energyToleranceFraction: number;
    temperatureToleranceC: number;
    converged: boolean;
  };
}

interface IdealGroupRow {
  shape: ComparisonShapeKind;
  acKWhYear: number;
}

interface IdealGroup {
  id: string;
  officialRankingEligible: boolean;
  rankingVerdict: string;
  rows: IdealGroupRow[];
}

interface IdealAuditArtifact {
  schemaVersion: number;
  conditions: {
    year: number;
    landAreaM2: number;
    weatherPoints: number;
    intervals: number;
    durationHours: number;
    configurationFingerprint: string;
    implementationFingerprint: string;
    integration: string;
  };
  groups: IdealGroup[];
}

interface BaselineFixture {
  schemaVersion: number;
  baselineCommit: string;
  sourceArtifact: string;
  sourceArtifactSha256AtBaseline: string;
  sourceArtifactSchemaVersion: number;
  configurationFingerprint: string;
  implementationFingerprint: string;
  relativeTolerance: number;
  staticLandMatchedAcKWhYear: Record<ComparisonShapeKind, number>;
  controlledMotorNetAcKWhYear: Record<ComparisonShapeKind, number>;
}

interface CaseSummary {
  shape: ComparisonShapeKind;
  geometryContract: "static-land-matched" | "swept-rotation-envelope";
  rotationModel: "held-static" | "controlled-2-rpm" | "natural-no-cq-zero-rpm";
  landAreaM2: number;
  activePvAreaM2: number;
  selectedFootprintM2: number;
  heightM: number;
  electricalLayoutId: string;
  dcEnergyWh: number;
  idealLocalMppDcEnergyWh: number;
  mismatchAndWiringLossEnergyWh: number;
  grossAcEnergyWh: number;
  motorEnergyWh: number;
  netAcEnergyWh: number;
  inverterLossWh: number;
  bypassActivationDeviceHours: number;
  averageTemperatureC: number;
  minimumTemperatureC: number;
  maximumTemperatureC: number;
  heatResidualFraction: number;
  warmupConverged: boolean;
  coverage: AnnualTransientSurfaceResult["coverage"];
  monthly: AnnualTransientSurfaceResult["monthly"];
  topology: NonNullable<AnnualTransientSurfaceResult["engineeringCircuit"]>;
  identityResidualWh: number;
  validationPass: boolean;
  elapsedMs: number;
}

interface CouplingLevelSummary {
  stepSeconds: number;
  actualClockHours: number;
  netAcEnergyWh: number;
  dcEnergyWh: number;
  averageTemperatureC: number;
  layoutIds: string[];
  layoutInvariant: boolean;
  maximumExtractionClosureErrorW: number;
  maximumHeatResidualFraction: number;
  elapsedMs: number;
}

interface QuasiCaseSummary {
  shape: ComparisonShapeKind;
  geometryContract: "static-land-matched" | "swept-rotation-envelope";
  rotationModel: "held-static" | "controlled-2-rpm" | "natural-no-cq-zero-rpm";
  thermalModel: "quasi-steady-faiman";
  periodIntegration: "pointwise-quasi-steady";
  electricalModel: "explicit-series-parallel-bypass";
  electricalLayoutId: string;
  dcEnergyWh: number;
  grossAcEnergyWh: number;
  motorEnergyWh: number;
  netAcEnergyWh: number;
  coverage: {
    points: number;
    intervals: number;
    durationHours: number;
    closingEndpointPresent: boolean;
  };
  monthly: Array<{
    month: string;
    dcEnergyWh: number;
    grossAcEnergyWh: number;
    motorEnergyWh: number;
    netAcEnergyWh: number;
  }>;
  validationPass: boolean;
  elapsedMs: number;
}

interface WorkerFullYearParitySummary {
  shape: "cylinder";
  actualClockHours: number;
  layoutInvariant: boolean;
  annualParity: boolean;
  monthlyParity: boolean;
  ledgerParity: boolean;
  maximumAbsoluteDifferenceWh: number;
  pass: boolean;
  elapsedMs: number;
}

interface ThermalMeshLevelSummary {
  requestedNodeCount: number;
  actualClockHours: number;
  netAcEnergyWh: number;
  averageTemperatureC: number;
  layoutIds: string[];
  layoutInvariant: boolean;
  maximumExtractionClosureErrorW: number;
  maximumHeatResidualFraction: number;
  elapsedMs: number;
}

interface FactorialCaseSummary {
  dcEnergyWh: number;
  idealLocalMppDcEnergyWh: number;
  mismatchAndWiringLossEnergyWh: number;
  grossAcEnergyWh: number;
  motorEnergyWh: number;
  netAcEnergyWh: number;
  bypassActivationDeviceHours: number;
}

interface FactorialSummary {
  actualClockHours: number;
  cases: Record<"e00" | "e10" | "e01" | "e11", FactorialCaseSummary>;
  decomposition: {
    opticalWh: number;
    thermalWh: number;
    interactionWh: number;
    netWh: number;
    closureResidualWh: number;
  };
  layoutIds: string[];
  layoutInvariant: boolean;
  maximumHeatResidualFraction: number;
  maximumExtractionClosureErrorW: number;
  closurePass: boolean;
  elapsedMs: number;
}

interface Checkpoint {
  schemaVersion: 2;
  fingerprint: string;
  tasks: Record<string, unknown>;
}

interface AnnualSegmentCheckpoint {
  segmentId: string;
  startInterval: number;
  endIntervalExclusive: number;
  initialOpticalPhaseRad: number;
  initialConvectionPhaseRad: number;
  result: AnnualTransientSurfaceResult;
  elapsedMs: number;
}

interface WeatherSegment {
  id: string;
  startInterval: number;
  endIntervalExclusive: number;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function atomicWriteFile(path: string, contents: string): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, contents, "utf8");
  renameSync(temporaryPath, path);
}

function invalidValidationGate(): Record<string, unknown> {
  const resolutionByShape = (phaseSamples: number) => Object.fromEntries(SHAPES.map((shape) => [
    shape,
    {
      azimuthSamples: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.azimuthSamples,
      meridionalSegments: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.meridionalSegments,
      phaseSamples,
      circuitSamples: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.circuitSamples,
    },
  ]));
  const emptyLayoutIdByShape = Object.fromEntries(SHAPES.map((shape) => [shape, ""]));
  const staticResolution = resolutionByShape(1);
  const sweptResolution = resolutionByShape(ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.phaseSamples);
  return {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    status: "running-or-failed",
    artifactSchemaVersion: SCHEMA_VERSION,
    artifactPath: jsonPath.replaceAll("\\", "/"),
    artifactSha256: "",
    meshAuditPath: meshAuditPath.replaceAll("\\", "/"),
    meshAuditSha256: "",
    thermalAuditPath: thermalAuditPath.replaceAll("\\", "/"),
    thermalAuditSha256: "",
    implementationSha256: "",
    configurationSha256: "",
    year: YEAR,
    coverage: { points: 8761, intervals: 8760, durationHours: 8760, closingEndpointPresent: true },
    geometryContracts: [
      {
        contractId: "static-land-matched",
        footprintMode: "static",
        rotationModel: "stationary-rpm0",
        phaseGateRequired: false,
        validatedResolution: staticResolution.plane,
        layoutIdByShape: emptyLayoutIdByShape,
        pass: false,
        officialEligible: false,
      },
      {
        contractId: "swept-rotation-envelope",
        footprintMode: "swept",
        rotationModel: "controlled-y-axis-phase-quadrature",
        phaseGateRequired: true,
        validatedResolution: sweptResolution.plane,
        layoutIdByShape: emptyLayoutIdByShape,
        pass: false,
        officialEligible: false,
      },
    ],
    validatedMinimumResolution: {
      "static-land-matched": staticResolution,
      "swept-rotation-envelope": sweptResolution,
    },
    validatedCoupledSettings: {
      thermalNodeCount: THERMAL_NODE_COUNT,
      maximumThermalSubstepSeconds: THERMAL_MAXIMUM_SUBSTEP_SECONDS,
      maximumElectricalCouplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
      couplingConvergenceToleranceFraction: COUPLING_TOLERANCE_FRACTION,
      thermalMeshEnergyToleranceFraction: THERMAL_MESH_ENERGY_TOLERANCE_FRACTION,
      thermalMeshTemperatureToleranceC: THERMAL_MESH_TEMPERATURE_TOLERANCE_C,
      maximumElectricalExtractionClosureErrorW: 1e-8,
      maximumHeatEnergyResidualFraction: 1e-8,
    },
    certifiedFixture,
    officialRankings: { static: [], controlled: [], natural: [] },
    layoutVersion: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
    officialRankingEligible: false,
  };
}

// Invalidate a previous pass before reading any dependency. Every invocation
// (full, partial, or preflight) is fail-closed; only a complete no-flag run can restore pass.
atomicWriteFile(validationGatePath, `${JSON.stringify(invalidValidationGate(), null, 2)}\n`);

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return value;
}

function relativeDifference(selected: number, reference: number): number {
  return Math.abs(selected - reference) / Math.max(1e-12, Math.abs(reference));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function findGroupById(artifact: IdealAuditArtifact, id: string): IdealGroup {
  const group = artifact.groups.find((candidate) => candidate.id === id);
  if (group === undefined) throw new Error(`Ideal annual artifact is missing group ${id}.`);
  if (group.rows.length !== SHAPES.length) {
    throw new Error(`Ideal annual group ${id} must contain all six shapes.`);
  }
  return group;
}

function officialIdealGroupById(artifact: IdealAuditArtifact, id: string): IdealGroup {
  const group = findGroupById(artifact, id);
  if (!group.officialRankingEligible || group.rankingVerdict !== "pass") {
    throw new Error(`Ideal annual group ${id} is not official/pass.`);
  }
  return group;
}

function groupValue(group: IdealGroup, shape: ComparisonShapeKind): number {
  const row = group.rows.find((candidate) => candidate.shape === shape);
  if (row === undefined) throw new Error(`${group.id} is missing ${shape}.`);
  return finite(row.acKWhYear, `${group.id}/${shape} acKWhYear`);
}

if (!existsSync(meshAuditPath) || !existsSync(meshValidationGatePath) || !existsSync(idealAuditPath)
  || !existsSync(thermalAuditPath) || !existsSync(baselineFixturePath)) {
  throw new Error("Transient-engineering audit preflight is missing a mesh gate, mesh, thermal, ideal-annual, or baseline artifact.");
}

const meshAuditSha256 = sha256File(meshAuditPath);
const idealAuditSha256 = sha256File(idealAuditPath);
const thermalAuditSha256 = sha256File(thermalAuditPath);
const baselineFixtureSha256 = sha256File(baselineFixturePath);
const meshAuditValue = readJson<unknown>(meshAuditPath);
const meshValidationGateValue = readJson<unknown>(meshValidationGatePath);
const idealAuditValue = readJson<unknown>(idealAuditPath);
const thermalAuditValue = readJson<unknown>(thermalAuditPath);
const meshAudit = meshAuditValue as MeshAuditArtifact;
const idealAudit = idealAuditValue as IdealAuditArtifact;
const thermalAudit = thermalAuditValue as ThermalAuditArtifact;
const baselineFixture = readJson<BaselineFixture>(baselineFixturePath);
const preflightBlockingReasons: string[] = [];
let strictMeshValidationPass = true;
try {
  const strictMeshAudit = validateEngineeringMeshAudit(meshAuditValue, process.cwd());
  validateEngineeringMeshGate(meshValidationGateValue, strictMeshAudit, process.cwd());
} catch (error) {
  strictMeshValidationPass = false;
  preflightBlockingReasons.push(
    `Strict mesh dependency validation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
try {
  validateAnnualAudit(idealAuditValue, process.cwd());
} catch (error) {
  preflightBlockingReasons.push(
    `Strict annual dependency validation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
try {
  validateThermalAudit(thermalAuditValue);
} catch (error) {
  preflightBlockingReasons.push(
    `Strict thermal dependency validation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
let meshConvergencePass = strictMeshValidationPass;

if (meshAudit.schemaVersion !== 2 || !meshAudit.pass || !meshAudit.officialRankingEligible) {
  meshConvergencePass = false;
  preflightBlockingReasons.push("Engineering mesh audit is not pass/officialRankingEligible.");
}
const staticMeshContract = meshAudit.geometryContracts?.find(
  (entry) => entry.contractId === "static-land-matched",
);
const sweptMeshContract = meshAudit.geometryContracts?.find(
  (entry) => entry.contractId === "swept-rotation-envelope",
);
if (meshAudit.geometryContracts?.length !== 2
  || staticMeshContract === undefined || sweptMeshContract === undefined
  || staticMeshContract.footprintMode !== "static"
  || staticMeshContract.phaseGateRequired
  || !staticMeshContract.pass || !staticMeshContract.officialEligible
  || staticMeshContract.shapes.length !== SHAPES.length
  || sweptMeshContract.footprintMode !== "swept"
  || !sweptMeshContract.phaseGateRequired
  || !sweptMeshContract.pass || !sweptMeshContract.officialEligible
  || sweptMeshContract.shapes.length !== SHAPES.length) {
  meshConvergencePass = false;
  preflightBlockingReasons.push("Engineering mesh audit does not certify both static-land-matched and swept-rotation-envelope geometry contracts.");
}
if (!/^[0-9a-f]{64}$/.test(meshAudit.fixture?.configurationSha256 ?? "")
  || !/^[0-9a-f]{64}$/.test(meshAudit.fixture?.implementationSha256 ?? "")
  || meshAudit.fixture?.implementationSha256 !== meshAudit.implementation?.sha256) {
  meshConvergencePass = false;
  preflightBlockingReasons.push("Engineering mesh audit lacks stable matching configuration/implementation fingerprints.");
}
const officialMeshResolution = meshAudit.convergence?.officialMinimumResolution;
if (officialMeshResolution === undefined
  || officialMeshResolution.azimuthSamples
    !== ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.azimuthSamples
  || officialMeshResolution.meridionalSegments
    !== ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.meridionalSegments
  || officialMeshResolution.phaseSamples
    !== ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.phaseSamples
  || officialMeshResolution.circuitSamples
    !== ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.circuitSamples) {
  meshConvergencePass = false;
  preflightBlockingReasons.push("Engineering mesh audit official minimum resolution drifted from the shared production contract.");
}
const staticMeshShapeByKind = Object.fromEntries(
  (staticMeshContract?.shapes ?? []).map((entry) => [entry.shape, entry]),
) as Partial<Record<ComparisonShapeKind, MeshAuditShape>>;
const sweptMeshShapeByKind = Object.fromEntries(
  (sweptMeshContract?.shapes ?? []).map((entry) => [entry.shape, entry]),
) as Partial<Record<ComparisonShapeKind, MeshAuditShape>>;
for (const contract of [staticMeshContract, sweptMeshContract]) {
  if (contract === undefined) continue;
  const shapeByKind = contract.contractId === "static-land-matched"
    ? staticMeshShapeByKind
    : sweptMeshShapeByKind;
  for (const shape of SHAPES) {
    const entry = shapeByKind[shape];
    const expectedPhaseSamples = contract.phaseGateRequired
      ? officialMeshResolution?.phaseSamples
      : 1;
    const selected = entry?.levels.find((level) => officialMeshResolution !== undefined
      && level.resolution.azimuthSamples === officialMeshResolution.azimuthSamples
      && level.resolution.meridionalSegments === officialMeshResolution.meridionalSegments
      && level.resolution.phaseSamples === expectedPhaseSamples
      && level.resolution.circuitSamples === officialMeshResolution.circuitSamples);
    const phaseContractPass = entry?.phaseConvergence.pass
      && entry.phaseConvergence.required === contract.phaseGateRequired
      && (contract.phaseGateRequired
        ? entry.phaseConvergence.topologyInvariant === true
        : entry.phaseConvergence.status === "not-applicable-stationary-rpm0");
    if (entry === undefined || !entry.pass || !entry.officialEligible || entry.levels.length < 3
      || entry.consecutiveDeltas.length < 2 || !entry.opticalMeshPass || !phaseContractPass
      || !entry.circuitConvergence.pass || !entry.circuitConvergence.topologyInvariant
      || selected === undefined || selected.layoutId !== entry.layoutId) {
      meshConvergencePass = false;
      preflightBlockingReasons.push(`${contract.contractId}/${shape} lacks a passing immutable optical/phase/circuit convergence chain.`);
    }
  }
}
if (thermalAudit.schemaVersion !== 1 || !thermalAudit.pass
  || thermalAudit.scenario.thermalNodes !== THERMAL_NODE_COUNT
  || thermalAudit.scenario.expectedIntervals !== 8760
  || thermalAudit.thermalMesh.requestedThermalNodeCount !== THERMAL_NODE_COUNT
  || thermalAudit.thermalMesh.thermalNodeCount !== THERMAL_NODE_COUNT
  || !thermalAudit.meshConvergence14Day.converged
  || thermalAudit.meshConvergence14Day.energyToleranceFraction
    !== THERMAL_MESH_ENERGY_TOLERANCE_FRACTION
  || thermalAudit.meshConvergence14Day.temperatureToleranceC
    !== THERMAL_MESH_TEMPERATURE_TOLERANCE_C
  || thermalAudit.acceptance.thermalMeshEnergyToleranceFraction
    !== THERMAL_MESH_ENERGY_TOLERANCE_FRACTION
  || thermalAudit.acceptance.thermalMeshTemperatureToleranceC
    !== THERMAL_MESH_TEMPERATURE_TOLERANCE_C) {
  preflightBlockingReasons.push("Annual transient thermal audit schema/pass/6-node/1%/0.2 C contract is not satisfied.");
}
if (idealAudit.schemaVersion !== baselineFixture.sourceArtifactSchemaVersion
  || idealAudit.conditions.year !== YEAR
  || idealAudit.conditions.landAreaM2 !== LAND_AREA_M2
  || idealAudit.conditions.weatherPoints !== 8761
  || idealAudit.conditions.intervals !== 8760
  || idealAudit.conditions.durationHours !== 8760
  || !idealAudit.conditions.integration.includes("actual")) {
  preflightBlockingReasons.push("Ideal annual artifact schema/configuration is not the required actual 8760-hour clock.");
}
for (const fingerprint of [
  idealAudit.conditions.configurationFingerprint,
  idealAudit.conditions.implementationFingerprint,
  baselineFixture.configurationFingerprint,
  baselineFixture.implementationFingerprint,
  baselineFixture.sourceArtifactSha256AtBaseline,
]) {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    preflightBlockingReasons.push("Ideal/baseline provenance contains a malformed SHA-256 fingerprint.");
    break;
  }
}
if (baselineFixture.baselineCommit !== "d9ff14abc6c4bec6217ca38ef45f1f499377d83c"
  || baselineFixture.relativeTolerance !== BASELINE_RELATIVE_TOLERANCE) {
  preflightBlockingReasons.push("Immutable d9ff14a baseline commit/tolerance contract changed.");
}

let idealStaticGroup: IdealGroup | undefined;
let idealControlledGroup: IdealGroup | undefined;
let quasiStaticEngineeringGroup: IdealGroup | undefined;
let quasiControlledEngineeringGroup: IdealGroup | undefined;
let quasiNaturalEngineeringGroup: IdealGroup | undefined;
try {
  idealStaticGroup = officialIdealGroupById(idealAudit, "transient-static-land-matched:local-mpp-area-integral");
  idealControlledGroup = officialIdealGroupById(idealAudit, "transient-controlled-motor-net:local-mpp-area-integral");
  quasiStaticEngineeringGroup = findGroupById(idealAudit, "static-land-matched:explicit-series-parallel-bypass");
  quasiControlledEngineeringGroup = findGroupById(idealAudit, "controlled-motor-net:explicit-series-parallel-bypass");
  quasiNaturalEngineeringGroup = findGroupById(idealAudit, "natural-no-cq:explicit-series-parallel-bypass");
} catch (error) {
  preflightBlockingReasons.push(error instanceof Error ? error.message : String(error));
}

const baselineByShape = Object.fromEntries(SHAPES.map((shape) => {
  const currentStatic = idealStaticGroup === undefined ? Number.NaN : groupValue(idealStaticGroup, shape);
  const currentControlled = idealControlledGroup === undefined
    ? Number.NaN
    : groupValue(idealControlledGroup, shape);
  const staticDifference = relativeDifference(
    currentStatic,
    baselineFixture.staticLandMatchedAcKWhYear[shape],
  );
  const controlledDifference = relativeDifference(
    currentControlled,
    baselineFixture.controlledMotorNetAcKWhYear[shape],
  );
  return [shape, {
    static: {
      baselineKWhYear: baselineFixture.staticLandMatchedAcKWhYear[shape],
      currentKWhYear: currentStatic,
      relativeDifference: staticDifference,
      pass: staticDifference <= BASELINE_RELATIVE_TOLERANCE,
    },
    controlled: {
      baselineKWhYear: baselineFixture.controlledMotorNetAcKWhYear[shape],
      currentKWhYear: currentControlled,
      relativeDifference: controlledDifference,
      pass: controlledDifference <= BASELINE_RELATIVE_TOLERANCE,
    },
  }];
})) as Record<ComparisonShapeKind, {
  static: { baselineKWhYear: number; currentKWhYear: number; relativeDifference: number; pass: boolean };
  controlled: { baselineKWhYear: number; currentKWhYear: number; relativeDifference: number; pass: boolean };
}>;
const baselinePass = Object.values(baselineByShape)
  .every((entry) => entry.static.pass && entry.controlled.pass);
if (!baselinePass) preflightBlockingReasons.push("d9ff14a ideal annual baseline regression exceeded 0.1%.");

if (preflightOnly) {
  console.log(JSON.stringify({
    meshAuditPath,
    meshAuditSha256,
    meshConvergencePass,
    thermalAuditPath,
    thermalAuditSha256,
    thermalAuditPass: thermalAudit.pass && thermalAudit.meshConvergence14Day.converged,
    idealAuditPath,
    idealAuditSha256,
    baselinePass,
    blockingReasons: preflightBlockingReasons,
  }, null, 2));
  if (preflightBlockingReasons.length > 0) throw new Error(preflightBlockingReasons.join(" "));
  process.exit(0);
}
if (preflightBlockingReasons.length > 0) {
  throw new Error(`Transient-engineering preflight blocked before expensive execution: ${preflightBlockingReasons.join(" ")}`);
}

const requestedShapes = requestedShapesArgument === undefined
  ? [...SHAPES]
  : requestedShapesArgument.split(",") as ComparisonShapeKind[];
if (requestedShapes.length === 0 || requestedShapes.some((shape) => !SHAPES.includes(shape))) {
  throw new RangeError(`--shapes must be a comma-separated subset of ${SHAPES.join(",")}.`);
}

const weatherSeries = getOfflineWeather({
  ...LOCATION,
  start: Date.UTC(YEAR, 0, 1) - REPORTING_OFFSET_MS,
  end: Date.UTC(YEAR + 1, 0, 1) - REPORTING_OFFSET_MS,
  stepMinutes: 60,
  seed: WEATHER_SEED,
  offlinePreset: "partly-cloudy",
}, { now: new Date(0) });
const weather = weatherSeries.points;
if (weather.length !== 8761
  || (weather.at(-1)!.timeUtcMs - weather[0].timeUtcMs) / 3_600_000 !== 8760) {
  throw new Error("Annual offline model estimate must contain 8761 boundaries over 8760 hours.");
}
const annualWeatherSegments: readonly WeatherSegment[] = (() => {
  const segments: WeatherSegment[] = [];
  let startInterval = 0;
  let activeMonth = new Date(weather[0].timeUtcMs + REPORTING_OFFSET_MS)
    .toISOString().slice(0, 7);
  for (let interval = 1; interval < weather.length - 1; interval += 1) {
    const month = new Date(weather[interval].timeUtcMs + REPORTING_OFFSET_MS)
      .toISOString().slice(0, 7);
    if (month === activeMonth) continue;
    segments.push({ id: activeMonth, startInterval, endIntervalExclusive: interval });
    startInterval = interval;
    activeMonth = month;
  }
  segments.push({
    id: activeMonth,
    startInterval,
    endIntervalExclusive: weather.length - 1,
  });
  if (segments.length !== 12
    || segments.reduce((total, segment) => total
      + segment.endIntervalExclusive - segment.startInterval, 0) !== 8760) {
    throw new Error("Annual checkpoint segments must exactly partition twelve reporting months.");
  }
  return Object.freeze(segments);
})();

if (officialMeshResolution === undefined) {
  throw new Error("Engineering mesh audit has no official production resolution.");
}
const selectedResolutionByShape = Object.fromEntries(SHAPES.map((shape) => [
  shape,
  { ...officialMeshResolution },
])) as Record<ComparisonShapeKind, MeshResolution>;
const selectedResolutionByGeometryContract = {
  "static-land-matched": Object.fromEntries(SHAPES.map((shape) => [shape, {
    ...officialMeshResolution,
    phaseSamples: 1,
  }])) as Record<ComparisonShapeKind, MeshResolution>,
  "swept-rotation-envelope": Object.fromEntries(SHAPES.map((shape) => [shape, {
    ...officialMeshResolution,
  }])) as Record<ComparisonShapeKind, MeshResolution>,
};
const selectedPhaseSamplesByShape = Object.fromEntries(SHAPES.map((shape) => [
  shape,
  selectedResolutionByShape[shape].phaseSamples,
])) as Record<ComparisonShapeKind, number>;
const selectedCircuitSamplesByShape = Object.fromEntries(SHAPES.map((shape) => [
  shape,
  selectedResolutionByShape[shape].circuitSamples,
])) as Record<ComparisonShapeKind, number>;

function makeSurface(
  shape: ComparisonShapeKind,
  footprintMode: ComparisonFootprintMode,
): ComparisonSurfaceModel {
  const resolution = selectedResolutionByShape[shape];
  const surface = createComparisonSurface(shape, {
    landAreaM2: LAND_AREA_M2,
    maxHeightM: MAXIMUM_HEIGHT_M,
    cylinderHeightM: MAXIMUM_HEIGHT_M,
    coneHeightM: MAXIMUM_HEIGHT_M,
    planeTiltDeg: 30,
    planeAzimuthDeg: 180,
    footprintMode,
    groundClearanceM: 0,
    maximumActiveAreaM2: 100_000,
    maximumAspectRatio: 4,
    azimuthSamples: resolution.azimuthSamples,
    meridionalSegments: resolution.meridionalSegments,
  });
  const selectedFootprintM2 = surface.comparison.footprint.selectedStructureAreaM2;
  if (Math.abs(selectedFootprintM2 - LAND_AREA_M2) > LAND_AREA_M2 * 1e-8
    || surface.dimensions.centreY + surface.comparison.dimensions.heightM / 2
      > MAXIMUM_HEIGHT_M + 1e-10) {
    throw new Error(`${shape}/${footprintMode} violates the common land/height geometry contract.`);
  }
  return surface;
}

const staticSurfaces = Object.fromEntries(SHAPES.map((shape) => [shape, makeSurface(shape, "static")])) as
  Record<ComparisonShapeKind, ComparisonSurfaceModel>;
const controlledSurfaces = Object.fromEntries(SHAPES.map((shape) => [shape, makeSurface(shape, "swept")])) as
  Record<ComparisonShapeKind, ComparisonSurfaceModel>;

function annualInput(args: {
  surface: ComparisonSurfaceModel;
  weather: readonly WeatherPoint[];
  rpm: number;
  couplingStepSeconds: number;
  motor: boolean;
  thermalNodeCount?: number;
}): AnnualTransientSurfaceInput {
  const resolution = selectedResolutionByShape[args.surface.kind];
  const phaseSamples = args.rpm === 0 ? 1 : resolution.phaseSamples;
  return {
    surface: args.surface,
    weather: args.weather,
    location: LOCATION,
    rpm: args.rpm,
    initialPhaseRad: 0,
    referenceEfficiency: electricalReference.efficiency,
    gammaPerC: electricalReference.gammaPmpPerC,
    referenceTemperatureC: electricalReference.referenceTemperatureC,
    absorptivity: 0.9,
    electricalAvailabilityFactor: 1,
    soilingLossFraction: 0.02,
    albedo: 0.2,
    iam: { model: "ashrae", b0: 0.05 },
    diffuseModel: "hay-davies",
    inverter,
    ...(args.motor ? { motorDrive: MOTOR_DRIVE, motorRpm: args.rpm } : {}),
    engineeringElectrical: {
      referenceCell: electricalReference,
      connection: {
        ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
        circuitSamples: resolution.circuitSamples,
      },
      maximumCouplingStepSeconds: args.couplingStepSeconds,
    },
    thermalMesh: { targetNodeCount: args.thermalNodeCount ?? THERMAL_NODE_COUNT },
    thermalConfig: {
      ...DEFAULT_TRANSIENT_THERMAL_CONFIG,
      maximumSubstepSeconds: THERMAL_MAXIMUM_SUBSTEP_SECONDS,
    },
    warmup: WARMUP,
    opticalPhaseSamples: phaseSamples,
    convectionPhaseSamples: phaseSamples,
    reportingOffsetMinutes: REPORTING_OFFSET_MINUTES,
  };
}

function validateAndSummarize(
  shape: ComparisonShapeKind,
  surface: ComparisonSurfaceModel,
  geometryContract: CaseSummary["geometryContract"],
  rotationModel: CaseSummary["rotationModel"],
  result: AnnualTransientSurfaceResult,
  elapsedMs: number,
): CaseSummary {
  const topology = result.engineeringCircuit;
  if (result.electricalModel !== "explicit-series-parallel-bypass" || topology === undefined) {
    throw new Error(`${shape}/${rotationModel} silently left the explicit engineering path.`);
  }
  const identityResidualWh = result.idealLocalMppDcEnergyWh - result.dcEnergyWh
    - result.mismatchAndWiringLossEnergyWh;
  const monthlyDcWh = sum(result.monthly.map((entry) => entry.dcEnergyWh));
  const monthlyNetWh = sum(result.monthly.map((entry) => entry.acEnergyWh));
  const monthlyMotorWh = sum(result.monthly.map((entry) => entry.motorEnergyWh));
  const expectedLayoutId = (geometryContract === "static-land-matched"
    ? staticMeshShapeByKind[shape]
    : sweptMeshShapeByKind[shape])?.layoutId;
  const validationPass = result.coverage.closingEndpointPresent
    && result.coverage.durationHours > 0
    && result.warmup.converged
    && result.energyAudit.relativeEnergyResidual <= 1e-8
    && topology.maximumElectricalExtractionClosureErrorW <= 1e-8
    && result.electricalLayoutId === expectedLayoutId
    && result.dcEnergyWh <= result.idealLocalMppDcEnergyWh
      + Math.max(1e-9, result.idealLocalMppDcEnergyWh * 1e-8)
    && Math.abs(identityResidualWh) <= Math.max(1e-8, result.idealLocalMppDcEnergyWh * 1e-8)
    && Math.abs(monthlyDcWh - result.dcEnergyWh) <= Math.max(1e-8, result.dcEnergyWh * 1e-9)
    && Math.abs(monthlyNetWh - result.acEnergyWh) <= Math.max(1e-8, result.acEnergyWh * 1e-9)
    && Math.abs(monthlyMotorWh - result.motorEnergyWh)
      <= Math.max(1e-8, result.motorEnergyWh * 1e-9);
  return {
    shape,
    geometryContract,
    rotationModel,
    landAreaM2: LAND_AREA_M2,
    activePvAreaM2: surface.dimensions.activeAreaM2,
    selectedFootprintM2: surface.comparison.footprint.selectedStructureAreaM2,
    heightM: surface.comparison.dimensions.heightM,
    electricalLayoutId: result.electricalLayoutId,
    dcEnergyWh: result.dcEnergyWh,
    idealLocalMppDcEnergyWh: result.idealLocalMppDcEnergyWh,
    mismatchAndWiringLossEnergyWh: result.mismatchAndWiringLossEnergyWh,
    grossAcEnergyWh: result.grossAcEnergyWh,
    motorEnergyWh: result.motorEnergyWh,
    netAcEnergyWh: result.acEnergyWh,
    inverterLossWh: result.inverterLossWh,
    bypassActivationDeviceHours: result.bypassActivationDeviceHours,
    averageTemperatureC: result.averageTemperatureC,
    minimumTemperatureC: result.minimumTemperatureC,
    maximumTemperatureC: result.maximumTemperatureC,
    heatResidualFraction: result.energyAudit.relativeEnergyResidual,
    warmupConverged: result.warmup.converged,
    coverage: result.coverage,
    monthly: result.monthly,
    topology,
    identityResidualWh,
    validationPass,
    elapsedMs,
  };
}

const implementationFingerprint = createHash("sha256").update(
  IMPLEMENTATION_SOURCE_FILES.slice().sort()
    .map((path) => `${path}\0${readFileSync(path)}`).join("\n"),
).digest("hex");
const computationImplementationFingerprint = createHash("sha256").update(
  COMPUTATION_SOURCE_FILES.slice().sort()
    .map((path) => `${path}\0${readFileSync(path)}`).join("\n"),
).digest("hex");
const thermalValidationContract = {
  schemaVersion: thermalAudit.schemaVersion,
  acceptance: thermalAudit.acceptance,
  scenario: {
    thermalNodes: thermalAudit.scenario.thermalNodes,
    expectedIntervals: thermalAudit.scenario.expectedIntervals,
  },
  thermalMesh: thermalAudit.thermalMesh,
  convergence: {
    energyToleranceFraction: thermalAudit.meshConvergence14Day.energyToleranceFraction,
    temperatureToleranceC: thermalAudit.meshConvergence14Day.temperatureToleranceC,
  },
};
const gateContracts = ([staticMeshContract, sweptMeshContract] as const).map((contract) => ({
  contractId: contract!.contractId,
  footprintMode: contract!.footprintMode,
  rotationModel: contract!.rotationModel,
  phaseGateRequired: contract!.phaseGateRequired,
  validatedResolution: contract!.contractId === "static-land-matched"
    ? selectedResolutionByGeometryContract["static-land-matched"].plane
    : selectedResolutionByGeometryContract["swept-rotation-envelope"].plane,
  layoutIdByShape: Object.fromEntries(contract!.shapes.map((entry) => [
    entry.shape,
    entry.layoutId,
  ])),
  pass: contract!.pass,
  officialEligible: contract!.officialEligible,
}));
const checkpointFingerprint = createHash("sha256").update(JSON.stringify({
  checkpointSchemaVersion: 2,
  computationSchemaVersion: COMPUTATION_SCHEMA_VERSION,
  computationImplementationFingerprint,
  meshValidationContract: {
    configurationSha256: meshAudit.fixture.configurationSha256,
    implementationSha256: meshAudit.fixture.implementationSha256,
    selectedResolutionByGeometryContract,
    contracts: gateContracts,
  },
  thermalValidationContract,
  conditions: {
    YEAR, LAND_AREA_M2, MAXIMUM_HEIGHT_M, CONTROLLED_RPM,
    selectedResolutionByGeometryContract,
    THERMAL_NODE_COUNT, THERMAL_MAXIMUM_SUBSTEP_SECONDS,
    OFFICIAL_COUPLING_STEP_SECONDS, WARMUP, WEATHER_SEED,
    LOCATION, REPORTING_OFFSET_MINUTES, MOTOR_DRIVE,
    annualWeatherSegments,
    computationSchemaVersion: COMPUTATION_SCHEMA_VERSION,
    electricalReference, inverter,
    connection: OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  },
})).digest("hex");
function validationGate(
  status: "running-or-failed" | "pass",
  artifactSha256: string,
  generatedAtUtc: string,
  officialRankings: Record<"static" | "controlled" | "natural",
    readonly Record<string, unknown>[]> = { static: [], controlled: [], natural: [] },
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAtUtc,
    status,
    artifactSchemaVersion: SCHEMA_VERSION,
    artifactPath: jsonPath.replaceAll("\\", "/"),
    artifactSha256,
    meshAuditPath: meshAuditPath.replaceAll("\\", "/"),
    meshAuditSha256,
    thermalAuditPath: thermalAuditPath.replaceAll("\\", "/"),
    thermalAuditSha256,
    implementationSha256: implementationFingerprint,
    configurationSha256: checkpointFingerprint,
    year: YEAR,
    coverage: {
      points: weather.length,
      intervals: weather.length - 1,
      durationHours: (weather.at(-1)!.timeUtcMs - weather[0].timeUtcMs) / 3_600_000,
      closingEndpointPresent: true,
    },
    geometryContracts: gateContracts,
    validatedMinimumResolution: selectedResolutionByGeometryContract,
    validatedCoupledSettings: {
      thermalNodeCount: THERMAL_NODE_COUNT,
      maximumThermalSubstepSeconds: THERMAL_MAXIMUM_SUBSTEP_SECONDS,
      maximumElectricalCouplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
      couplingConvergenceToleranceFraction: COUPLING_TOLERANCE_FRACTION,
      thermalMeshEnergyToleranceFraction: THERMAL_MESH_ENERGY_TOLERANCE_FRACTION,
      thermalMeshTemperatureToleranceC: THERMAL_MESH_TEMPERATURE_TOLERANCE_C,
      maximumElectricalExtractionClosureErrorW: 1e-8,
      maximumHeatEnergyResidualFraction: 1e-8,
    },
    certifiedFixture,
    officialRankings,
    layoutVersion: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
    officialRankingEligible: status === "pass",
  };
}
if (!preflightOnly && requestedShapesArgument === undefined) {
  atomicWriteFile(validationGatePath, `${JSON.stringify(
    validationGate("running-or-failed", "", new Date().toISOString()), null, 2,
  )}\n`);
}
let checkpoint: Checkpoint = {
  schemaVersion: 2,
  fingerprint: checkpointFingerprint,
  tasks: {},
};
if (existsSync(checkpointPath)) {
  const parsed = acceptExactTransientEngineeringCheckpoint(
    readJson<unknown>(checkpointPath), checkpointFingerprint,
  );
  if (parsed !== undefined) {
    checkpoint = parsed;
    console.log(`[transient-engineering] resumed ${Object.keys(checkpoint.tasks).length} checkpoints`);
  }
}
const saveCheckpoint = () => atomicWriteFile(
  checkpointPath,
  `${JSON.stringify(checkpoint, null, 2)}\n`,
);
function cached<T>(key: string, compute: () => T): T {
  if (checkpoint.tasks[key] !== undefined) return checkpoint.tasks[key] as T;
  const value = compute();
  checkpoint.tasks[key] = value;
  saveCheckpoint();
  return value;
}
async function cachedAsync<T>(key: string, compute: () => Promise<T>): Promise<T> {
  if (checkpoint.tasks[key] !== undefined) return checkpoint.tasks[key] as T;
  const value = await compute();
  checkpoint.tasks[key] = value;
  saveCheckpoint();
  return value;
}

function closeEnergy(left: number, right: number, relativeTolerance = 1e-9): boolean {
  return Math.abs(left - right) <= Math.max(1e-8, Math.abs(right) * relativeTolerance);
}

function auditWorkerVariant(args: {
  variantId: string;
  surface: ComparisonSurfaceModel;
  rpm: number;
  motor: boolean;
  transient: boolean;
  initialAngleRad?: number;
}): SimulationVariantWorkItem {
  const resolution = selectedResolutionByShape[args.surface.kind];
  const phaseSamples = args.rpm === 0 ? 1 : resolution.phaseSamples;
  return {
    variantId: args.variantId,
    referenceEfficiency: electricalReference.efficiency,
    continuousSurface: createContinuousSurfaceWorkItem(args.surface, {
      landAreaM2: LAND_AREA_M2,
      electricalModel: "explicit-series-parallel-bypass",
      engineeringConnection: {
        ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
        circuitSamples: resolution.circuitSamples,
      },
      surfaceOptions: {
        albedo: 0.2,
        iam: { model: "ashrae", b0: 0.05 },
        diffuseModel: "hay-davies",
        soilingLossFraction: 0.02,
      },
    }),
    rotation: { mode: "fixed", rpm: args.rpm, initialAngleRad: args.initialAngleRad ?? 0 },
    rotationPhaseSamples: phaseSamples,
    inverter,
    ...(args.motor ? {
      motorDrive: {
        requiredTorqueNm: MOTOR_DRIVE.requiredTorqueNm,
        motorEfficiency: MOTOR_DRIVE.motorEfficiency,
      },
    } : {}),
    ...(args.transient ? {
      annualTransientThermal: {
        surface: args.surface,
        referenceEfficiency: electricalReference.efficiency,
        gammaPerC: electricalReference.gammaPmpPerC,
        referenceTemperatureC: electricalReference.referenceTemperatureC,
        absorptivity: 0.9,
        thermalNodeCount: THERMAL_NODE_COUNT,
        maximumThermalSubstepSeconds: THERMAL_MAXIMUM_SUBSTEP_SECONDS,
        maximumElectricalCouplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
        warmupPeriodHours: WARMUP.periodHours,
        warmupConvergenceToleranceC: WARMUP.convergenceToleranceC,
      },
    } : {}),
  };
}

function auditWorkerInput(
  variants: SimulationVariantWorkItem[],
  selectedWeather: readonly WeatherPoint[] = weather,
): SimulationKernelInput {
  return {
    mode: "annual",
    weather: [...selectedWeather],
    variants,
    physics: {
      location: LOCATION,
      electrical: {
        mode: "simple",
        config: electricalReference,
        aggregateLossFraction: 0,
      },
      thermal: DEFAULT_THERMAL,
      inverter,
    },
    chunkSize: 168,
    maximumGapHours: 1,
    reportingOffsetMinutes: REPORTING_OFFSET_MINUTES,
  };
}

async function runQuasiWorkerSegment(
  shape: ComparisonShapeKind,
  rotation: "static" | "controlled",
  segment: WeatherSegment,
  initialAngleRad: number,
): Promise<QuasiCaseSummary> {
  const started = Date.now();
  const controlled = rotation === "controlled";
  const surface = controlled ? controlledSurfaces[shape] : staticSurfaces[shape];
  const rpm = controlled ? CONTROLLED_RPM : 0;
  const grossId = `quasi:${rotation}:${shape}:${segment.id}:gross`;
  const netId = `quasi:${rotation}:${shape}:${segment.id}:net`;
  const variants = [auditWorkerVariant({
    variantId: grossId, surface, rpm, motor: false, transient: false, initialAngleRad,
  })];
  if (controlled) variants.push(auditWorkerVariant({
    variantId: netId, surface, rpm, motor: true, transient: false, initialAngleRad,
  }));
  const segmentWeather = weather.slice(segment.startInterval, segment.endIntervalExclusive + 1);
  const complete = await runSimulationKernel(createSimulationRunRequest(
    `transient-engineering-audit-${rotation}-${shape}-${segment.id}-quasi`,
    auditWorkerInput(variants, segmentWeather),
  ));
  const selectedNetId = controlled ? netId : grossId;
  const grossMetadata = complete.thermalModelMetadataByVariant[grossId];
  const netMetadata = complete.thermalModelMetadataByVariant[selectedNetId];
  const grossLayoutId = complete.electricalLayoutIdByVariant[grossId];
  const netLayoutId = complete.electricalLayoutIdByVariant[selectedNetId];
  const grossDcEnergyWh = complete.dcEnergyWhByVariant[grossId];
  const netDcEnergyWh = complete.dcEnergyWhByVariant[selectedNetId];
  const grossAcEnergyWh = complete.acEnergyWhByVariant[grossId];
  const netAcEnergyWh = complete.acEnergyWhByVariant[selectedNetId];
  const motorEnergyWh = complete.motorEnergyWhByVariant?.[selectedNetId] ?? 0;
  const monthly = complete.monthlyEnergy.map((entry) => ({
    month: entry.monthUtc,
    dcEnergyWh: entry.dcEnergyWhByVariant[grossId],
    grossAcEnergyWh: entry.acEnergyWhByVariant[grossId],
    motorEnergyWh: entry.motorEnergyWhByVariant?.[selectedNetId] ?? 0,
    netAcEnergyWh: entry.acEnergyWhByVariant[selectedNetId],
  }));
  const expectedLayoutId = (controlled
    ? sweptMeshShapeByKind[shape]
    : staticMeshShapeByKind[shape])?.layoutId;
  const expectedIntervals = segment.endIntervalExclusive - segment.startInterval;
  const expectedDurationHours = (segmentWeather.at(-1)!.timeUtcMs
    - segmentWeather[0].timeUtcMs) / 3_600_000;
  const validationPass = complete.steps === expectedIntervals + 1
    && complete.intervals === expectedIntervals
    && complete.durationHours === expectedDurationHours
    && complete.reportingOffsetMinutes === REPORTING_OFFSET_MINUTES
    && complete.authoritativeEnergyPathByVariant[grossId] === "worker-quasi-steady"
    && complete.authoritativeEnergyPathByVariant[selectedNetId] === "worker-quasi-steady"
    && grossMetadata?.model === "quasi-steady-faiman"
    && grossMetadata.periodIntegration === "pointwise-quasi-steady"
    && !grossMetadata.includesThermalHistory
    && netMetadata?.model === "quasi-steady-faiman"
    && netMetadata.periodIntegration === "pointwise-quasi-steady"
    && !netMetadata.includesThermalHistory
    && grossLayoutId === netLayoutId
    && expectedLayoutId !== undefined && grossLayoutId === expectedLayoutId
    && closeEnergy(grossDcEnergyWh, netDcEnergyWh)
    && netAcEnergyWh >= 0
    && netAcEnergyWh <= grossAcEnergyWh + 1e-8
    && motorEnergyWh >= 0
    && closeEnergy(sum(monthly.map((entry) => entry.dcEnergyWh)), grossDcEnergyWh)
    && closeEnergy(sum(monthly.map((entry) => entry.grossAcEnergyWh)), grossAcEnergyWh)
    && closeEnergy(sum(monthly.map((entry) => entry.motorEnergyWh)), motorEnergyWh)
    && closeEnergy(sum(monthly.map((entry) => entry.netAcEnergyWh)), netAcEnergyWh);
  return {
    shape,
    geometryContract: controlled ? "swept-rotation-envelope" : "static-land-matched",
    rotationModel: controlled ? "controlled-2-rpm" : "held-static",
    thermalModel: "quasi-steady-faiman",
    periodIntegration: "pointwise-quasi-steady",
    electricalModel: "explicit-series-parallel-bypass",
    electricalLayoutId: grossLayoutId,
    dcEnergyWh: grossDcEnergyWh,
    grossAcEnergyWh,
    motorEnergyWh,
    netAcEnergyWh,
    coverage: {
      points: complete.steps,
      intervals: complete.intervals,
      durationHours: complete.durationHours,
      closingEndpointPresent: complete.steps === complete.intervals + 1,
    },
    monthly,
    validationPass,
    elapsedMs: Date.now() - started,
  };
}

function mergeQuasiWorkerSegments(
  shape: ComparisonShapeKind,
  rotation: "static" | "controlled",
  segments: readonly QuasiCaseSummary[],
): QuasiCaseSummary {
  if (segments.length !== annualWeatherSegments.length) {
    throw new Error(`${shape}/${rotation} quasi segments are incomplete.`);
  }
  const first = segments[0];
  const monthMap = new Map<string, QuasiCaseSummary["monthly"][number]>();
  for (const segment of segments) {
    for (const entry of segment.monthly) {
      const target = monthMap.get(entry.month) ?? {
        month: entry.month,
        dcEnergyWh: 0,
        grossAcEnergyWh: 0,
        motorEnergyWh: 0,
        netAcEnergyWh: 0,
      };
      target.dcEnergyWh += entry.dcEnergyWh;
      target.grossAcEnergyWh += entry.grossAcEnergyWh;
      target.motorEnergyWh += entry.motorEnergyWh;
      target.netAcEnergyWh += entry.netAcEnergyWh;
      monthMap.set(entry.month, target);
    }
  }
  const monthly = [...monthMap.values()].sort((left, right) => left.month.localeCompare(right.month));
  const dcEnergyWh = sum(segments.map((entry) => entry.dcEnergyWh));
  const grossAcEnergyWh = sum(segments.map((entry) => entry.grossAcEnergyWh));
  const motorEnergyWh = sum(segments.map((entry) => entry.motorEnergyWh));
  const netAcEnergyWh = sum(segments.map((entry) => entry.netAcEnergyWh));
  const intervals = sum(segments.map((entry) => entry.coverage.intervals));
  const durationHours = sum(segments.map((entry) => entry.coverage.durationHours));
  const validationPass = segments.every((entry) => entry.validationPass
    && entry.electricalLayoutId === first.electricalLayoutId
    && entry.geometryContract === first.geometryContract
    && entry.rotationModel === first.rotationModel)
    && intervals === 8760 && durationHours === 8760 && monthly.length === 12
    && closeEnergy(sum(monthly.map((entry) => entry.dcEnergyWh)), dcEnergyWh)
    && closeEnergy(sum(monthly.map((entry) => entry.grossAcEnergyWh)), grossAcEnergyWh)
    && closeEnergy(sum(monthly.map((entry) => entry.motorEnergyWh)), motorEnergyWh)
    && closeEnergy(sum(monthly.map((entry) => entry.netAcEnergyWh)), netAcEnergyWh);
  return {
    ...first,
    dcEnergyWh,
    grossAcEnergyWh,
    motorEnergyWh,
    netAcEnergyWh,
    coverage: {
      points: intervals + 1,
      intervals,
      durationHours,
      closingEndpointPresent: true,
    },
    monthly,
    validationPass,
    elapsedMs: sum(segments.map((entry) => entry.elapsedMs)),
  };
}

async function runQuasiWorkerCase(
  shape: ComparisonShapeKind,
  rotation: "static" | "controlled",
): Promise<QuasiCaseSummary> {
  const controlled = rotation === "controlled";
  const phaseInput = annualInput({
    surface: controlled ? controlledSurfaces[shape] : staticSurfaces[shape],
    weather,
    rpm: controlled ? CONTROLLED_RPM : 0,
    couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
    motor: controlled,
  });
  const results: QuasiCaseSummary[] = [];
  for (const segment of annualWeatherSegments) {
    const initialAngleRad = annualTransientPhaseAtInterval(
      phaseInput, segment.startInterval, "optical",
    );
    results.push(await cachedAsync(
      `quasi-segment:${rotation}:${shape}:${segment.id}`,
      () => runQuasiWorkerSegment(shape, rotation, segment, initialAngleRad),
    ));
  }
  return mergeQuasiWorkerSegments(shape, rotation, results);
}

async function runWorkerFullYearParity(
  direct: CaseSummary,
): Promise<WorkerFullYearParitySummary> {
  const started = Date.now();
  const variantId = "parity:cylinder:static:engineering-transient";
  const complete = await runSimulationKernel(createSimulationRunRequest(
    "transient-engineering-audit-cylinder-worker-parity",
    auditWorkerInput([auditWorkerVariant({
      variantId,
      surface: staticSurfaces.cylinder,
      rpm: 0,
      motor: false,
      transient: true,
    })]),
  ));
  const decomposition = complete.annualTransientRotationByVariant?.[variantId];
  const audit = complete.annualEngineeringElectricalAuditByVariant?.[variantId];
  const workerMonthly = audit?.monthly ?? [];
  const directMonthlyById = new Map(direct.monthly.map((entry) => [entry.month, entry]));
  const differences = decomposition === undefined || audit === undefined
    ? [Number.POSITIVE_INFINITY]
    : [
        decomposition.e11.dcEnergyWh - direct.dcEnergyWh,
        decomposition.e11.acEnergyWh - direct.netAcEnergyWh,
        decomposition.e11.grossAcEnergyWh - direct.grossAcEnergyWh,
        decomposition.e11.motorEnergyWh - direct.motorEnergyWh,
        audit.annual.engineeringDcEnergyWh - direct.dcEnergyWh,
        audit.annual.netAcEnergyWh - direct.netAcEnergyWh,
        ...workerMonthly.flatMap((entry) => {
          const reference = directMonthlyById.get(entry.monthUtc);
          return reference === undefined ? [Number.POSITIVE_INFINITY] : [
            entry.engineeringDcEnergyWh - reference.dcEnergyWh,
            entry.netAcEnergyWh - reference.acEnergyWh,
            entry.grossAcEnergyWh - reference.grossAcEnergyWh,
            entry.motorEnergyWh - reference.motorEnergyWh,
          ];
        }),
      ];
  const maximumAbsoluteDifferenceWh = Math.max(...differences.map(Math.abs));
  const layoutInvariant = decomposition !== undefined && audit !== undefined
    && decomposition.e11.electricalLayoutId === direct.electricalLayoutId
    && audit.electricalLayoutId === direct.electricalLayoutId
    && complete.electricalLayoutIdByVariant[variantId] === direct.electricalLayoutId;
  const annualParity = decomposition !== undefined && audit !== undefined
    && closeEnergy(decomposition.e11.dcEnergyWh, direct.dcEnergyWh)
    && closeEnergy(decomposition.e11.acEnergyWh, direct.netAcEnergyWh)
    && closeEnergy(decomposition.e11.grossAcEnergyWh, direct.grossAcEnergyWh)
    && closeEnergy(audit.annual.engineeringDcEnergyWh, direct.dcEnergyWh)
    && closeEnergy(audit.annual.netAcEnergyWh, direct.netAcEnergyWh);
  const monthlyParity = workerMonthly.length === direct.monthly.length
    && maximumAbsoluteDifferenceWh <= 1e-8;
  const ledgerParity = complete.steps === 8761 && complete.intervals === 8760
    && complete.durationHours === 8760
    && complete.authoritativeEnergyPathByVariant[variantId]
      === "annual-transient-engineering-e11"
    && closeEnergy(complete.dcEnergyWhByVariant[variantId], direct.dcEnergyWh)
    && closeEnergy(complete.acEnergyWhByVariant[variantId], direct.netAcEnergyWh)
    && complete.thermalModelMetadataByVariant[variantId]?.model
      === "annual-transient-material-state"
    && audit?.periodIntegration === "actual-weather-clock";
  return {
    shape: "cylinder",
    actualClockHours: complete.durationHours,
    layoutInvariant,
    annualParity,
    monthlyParity,
    ledgerParity,
    maximumAbsoluteDifferenceWh,
    pass: layoutInvariant && annualParity && monthlyParity && ledgerParity,
    elapsedMs: Date.now() - started,
  };
}

function seasonalDays(): WeatherPoint[][] {
  return SEASON_DAY_OFFSETS.map((dayOffset) => {
    const startIndex = dayOffset * 24;
    const points = weather.slice(startIndex, startIndex + 25);
    if (points.length !== 25
      || (points.at(-1)!.timeUtcMs - points[0].timeUtcMs) / 3_600_000 !== 24) {
      throw new Error(`Seasonal day ${dayOffset} is not an actual closed 24-hour clock.`);
    }
    return points;
  });
}
const seasonWeather = seasonalDays();

function runCouplingLevel(shape: ComparisonShapeKind, stepSeconds: number): CouplingLevelSummary {
  return cached(`coupling:${shape}:${stepSeconds}`, () => {
    const started = Date.now();
    const results = seasonWeather.map((dayWeather) => simulateAnnualTransientSurface(annualInput({
      surface: controlledSurfaces[shape],
      weather: dayWeather,
      rpm: CONTROLLED_RPM,
      couplingStepSeconds: stepSeconds,
      motor: true,
    })));
    const layoutIds = results.map((result) => result.electricalLayoutId);
    return {
      stepSeconds,
      actualClockHours: sum(results.map((result) => result.coverage.durationHours)),
      netAcEnergyWh: sum(results.map((result) => result.acEnergyWh)),
      dcEnergyWh: sum(results.map((result) => result.dcEnergyWh)),
      averageTemperatureC: sum(results.map(
        (result) => result.averageTemperatureC * result.coverage.durationHours,
      )) / sum(results.map((result) => result.coverage.durationHours)),
      layoutIds,
      layoutInvariant: new Set(layoutIds).size === 1,
      maximumExtractionClosureErrorW: Math.max(...results.map(
        (result) => result.engineeringCircuit?.maximumElectricalExtractionClosureErrorW
          ?? Number.POSITIVE_INFINITY,
      )),
      maximumHeatResidualFraction: Math.max(...results.map(
        (result) => result.energyAudit.relativeEnergyResidual,
      )),
      elapsedMs: Date.now() - started,
    };
  });
}

const couplingByShape = Object.fromEntries(requestedShapes.map((shape) => {
  const levels = COUPLING_STEPS_SECONDS.map((stepSeconds) => runCouplingLevel(shape, stepSeconds));
  const consecutiveDeltas = levels.slice(1).map((level, index) => ({
    fromStepSeconds: levels[index].stepSeconds,
    toStepSeconds: level.stepSeconds,
    relativeNetAcDifference: relativeDifference(level.netAcEnergyWh, levels[index].netAcEnergyWh),
    averageTemperatureDifferenceC: Math.abs(
      level.averageTemperatureC - levels[index].averageTemperatureC,
    ),
  }));
  const pass = levels.every((level) => level.actualClockHours === 96
      && level.layoutInvariant
      && level.maximumExtractionClosureErrorW <= 1e-8
      && level.maximumHeatResidualFraction <= 1e-8)
    && consecutiveDeltas.every(
      (entry) => entry.relativeNetAcDifference <= COUPLING_TOLERANCE_FRACTION,
    );
  return [shape, { levels, consecutiveDeltas, pass }];
})) as Record<ComparisonShapeKind, {
  levels: CouplingLevelSummary[];
  consecutiveDeltas: {
    fromStepSeconds: number;
    toStepSeconds: number;
    relativeNetAcDifference: number;
    averageTemperatureDifferenceC: number;
  }[];
  pass: boolean;
}>;

function runThermalMeshLevel(
  shape: ComparisonShapeKind,
  requestedNodeCount: number,
): ThermalMeshLevelSummary {
  return cached(`thermal-mesh:${shape}:${requestedNodeCount}`, () => {
    const started = Date.now();
    const results = seasonWeather.map((dayWeather) => simulateAnnualTransientSurface(annualInput({
      surface: controlledSurfaces[shape],
      weather: dayWeather,
      rpm: CONTROLLED_RPM,
      couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
      motor: true,
      thermalNodeCount: requestedNodeCount,
    })));
    const layoutIds = results.map((result) => result.electricalLayoutId);
    const durationHours = sum(results.map((result) => result.coverage.durationHours));
    return {
      requestedNodeCount,
      actualClockHours: durationHours,
      netAcEnergyWh: sum(results.map((result) => result.acEnergyWh)),
      averageTemperatureC: sum(results.map(
        (result) => result.averageTemperatureC * result.coverage.durationHours,
      )) / durationHours,
      layoutIds,
      layoutInvariant: new Set(layoutIds).size === 1,
      maximumExtractionClosureErrorW: Math.max(...results.map(
        (result) => result.engineeringCircuit?.maximumElectricalExtractionClosureErrorW
          ?? Number.POSITIVE_INFINITY,
      )),
      maximumHeatResidualFraction: Math.max(...results.map(
        (result) => result.energyAudit.relativeEnergyResidual,
      )),
      elapsedMs: Date.now() - started,
    };
  });
}

const thermalMeshByShape = Object.fromEntries(requestedShapes.map((shape) => {
  const levels = [3, 6, 12].map((nodeCount) => runThermalMeshLevel(shape, nodeCount));
  const consecutiveDeltas = levels.slice(1).map((level, index) => ({
    fromNodeCount: levels[index].requestedNodeCount,
    toNodeCount: level.requestedNodeCount,
    relativeNetAcDifference: relativeDifference(level.netAcEnergyWh, levels[index].netAcEnergyWh),
    averageTemperatureDifferenceC: Math.abs(
      level.averageTemperatureC - levels[index].averageTemperatureC,
    ),
  }));
  const layoutInvariantAcrossLevels = new Set(levels.flatMap((level) => level.layoutIds)).size === 1;
  const pass = levels.every((level) => level.actualClockHours === 96
      && level.layoutInvariant
      && level.maximumExtractionClosureErrorW <= 1e-8
      && level.maximumHeatResidualFraction <= 1e-8)
    && layoutInvariantAcrossLevels
    && consecutiveDeltas.every((entry) =>
      entry.relativeNetAcDifference <= THERMAL_MESH_ENERGY_TOLERANCE_FRACTION
      && entry.averageTemperatureDifferenceC <= THERMAL_MESH_TEMPERATURE_TOLERANCE_C);
  return [shape, { levels, consecutiveDeltas, layoutInvariantAcrossLevels, pass }];
})) as Record<ComparisonShapeKind, {
  levels: ThermalMeshLevelSummary[];
  consecutiveDeltas: {
    fromNodeCount: number;
    toNodeCount: number;
    relativeNetAcDifference: number;
    averageTemperatureDifferenceC: number;
  }[];
  layoutInvariantAcrossLevels: boolean;
  pass: boolean;
}>;

function runFactorial(shape: ComparisonShapeKind): FactorialSummary {
  return cached(`factorial:${shape}`, () => {
    const started = Date.now();
    const results = seasonWeather.map((dayWeather) => simulateAnnualRotationDecomposition(annualInput({
      surface: controlledSurfaces[shape],
      weather: dayWeather,
      rpm: CONTROLLED_RPM,
      couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
      motor: true,
    })));
    const names = ["e00", "e10", "e01", "e11"] as const;
    const cases = Object.fromEntries(names.map((name) => [name, {
      dcEnergyWh: sum(results.map((result) => result[name].dcEnergyWh)),
      idealLocalMppDcEnergyWh: sum(results.map(
        (result) => result[name].idealLocalMppDcEnergyWh,
      )),
      mismatchAndWiringLossEnergyWh: sum(results.map(
        (result) => result[name].mismatchAndWiringLossEnergyWh,
      )),
      grossAcEnergyWh: sum(results.map((result) => result[name].grossAcEnergyWh)),
      motorEnergyWh: sum(results.map((result) => result[name].motorEnergyWh)),
      netAcEnergyWh: sum(results.map((result) => result[name].acEnergyWh)),
      bypassActivationDeviceHours: sum(results.map(
        (result) => result[name].bypassActivationDeviceHours,
      )),
    }])) as FactorialSummary["cases"];
    const opticalWh = cases.e10.netAcEnergyWh - cases.e00.netAcEnergyWh;
    const thermalWh = cases.e01.netAcEnergyWh - cases.e00.netAcEnergyWh;
    const interactionWh = cases.e11.netAcEnergyWh - cases.e10.netAcEnergyWh
      - cases.e01.netAcEnergyWh + cases.e00.netAcEnergyWh;
    const netWh = cases.e11.netAcEnergyWh - cases.e00.netAcEnergyWh;
    const closureResidualWh = opticalWh + thermalWh + interactionWh - netWh;
    const histories = results.flatMap((result) => names.map((name) => result[name]));
    const layoutIds = histories.map((result) => result.electricalLayoutId);
    const maximumHeatResidualFraction = Math.max(...histories.map(
      (result) => result.energyAudit.relativeEnergyResidual,
    ));
    const maximumExtractionClosureErrorW = Math.max(...histories.map(
      (result) => result.engineeringCircuit?.maximumElectricalExtractionClosureErrorW
        ?? Number.POSITIVE_INFINITY,
    ));
    return {
      actualClockHours: 96,
      cases,
      decomposition: { opticalWh, thermalWh, interactionWh, netWh, closureResidualWh },
      layoutIds,
      layoutInvariant: new Set(layoutIds).size === 1,
      maximumHeatResidualFraction,
      maximumExtractionClosureErrorW,
      closurePass: Math.abs(closureResidualWh) <= 1e-10
        && maximumHeatResidualFraction <= 1e-8
        && maximumExtractionClosureErrorW <= 1e-8
        && new Set(layoutIds).size === 1,
      elapsedMs: Date.now() - started,
    };
  });
}

function runAnnualStaticCase(shape: ComparisonShapeKind): CaseSummary {
  return cached(`annual:static:${shape}`, () => {
    const started = Date.now();
    const result = simulateAnnualTransientSurface(annualInput({
      surface: staticSurfaces[shape],
      weather,
      rpm: 0,
      couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
      motor: false,
    }));
    return validateAndSummarize(
      shape, staticSurfaces[shape], "static-land-matched", "held-static",
      result, Date.now() - started,
    );
  });
}

function sliceSchedule(
  schedule: readonly number[] | undefined,
  segment: WeatherSegment,
): readonly number[] | undefined {
  return schedule?.slice(segment.startInterval, segment.endIntervalExclusive + 1);
}

function runAnnualControlledCase(shape: ComparisonShapeKind): CaseSummary {
  const baseInput = annualInput({
    surface: controlledSurfaces[shape],
    weather,
    rpm: CONTROLLED_RPM,
    couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
    motor: true,
  });
  const segments: AnnualSegmentCheckpoint[] = [];
  for (const [index, segment] of annualWeatherSegments.entries()) {
    const previous = segments.at(-1);
    const initialOpticalPhaseRad = annualTransientPhaseAtInterval(
      baseInput, segment.startInterval, "optical",
    );
    const initialConvectionPhaseRad = annualTransientPhaseAtInterval(
      baseInput, segment.startInterval, "convection",
    );
    const checkpoint = cached<AnnualSegmentCheckpoint>(
      `annual-segment:controlled:${shape}:${segment.id}`,
      () => {
        const started = Date.now();
        const result = simulateAnnualTransientSurface({
          ...baseInput,
          weather: baseInput.weather.slice(
            segment.startInterval, segment.endIntervalExclusive + 1,
          ),
          ...(baseInput.rpmByWeatherStep === undefined ? {} : {
            rpmByWeatherStep: sliceSchedule(baseInput.rpmByWeatherStep, segment),
          }),
          ...(baseInput.opticalRpmByWeatherStep === undefined ? {} : {
            opticalRpmByWeatherStep: sliceSchedule(baseInput.opticalRpmByWeatherStep, segment),
          }),
          ...(baseInput.convectionRpmByWeatherStep === undefined ? {} : {
            convectionRpmByWeatherStep: sliceSchedule(baseInput.convectionRpmByWeatherStep, segment),
          }),
          ...(baseInput.motorRpmByWeatherStep === undefined ? {} : {
            motorRpmByWeatherStep: sliceSchedule(baseInput.motorRpmByWeatherStep, segment),
          }),
          ...(previous === undefined ? {} : {
            initialTemperatureCByNode: previous.result.finalTemperatureCByNode,
          }),
          initialOpticalPhaseRad,
          initialConvectionPhaseRad,
          warmup: index === 0 ? baseInput.warmup : false,
        });
        return {
          segmentId: segment.id,
          startInterval: segment.startInterval,
          endIntervalExclusive: segment.endIntervalExclusive,
          initialOpticalPhaseRad,
          initialConvectionPhaseRad,
          result,
          elapsedMs: Date.now() - started,
        };
      },
    );
    segments.push(checkpoint);
  }
  return cached(`annual:controlled:${shape}`, () => {
    const result = mergeAnnualTransientSurfaceSegments(
      segments.map((entry) => entry.result), weather, REPORTING_OFFSET_MINUTES,
    );
    const elapsedMs = sum(segments.map((entry) => entry.elapsedMs));
    return validateAndSummarize(
      shape, controlledSurfaces[shape], "swept-rotation-envelope", "controlled-2-rpm",
      result, elapsedMs,
    );
  });
}

const factorialByShape = Object.fromEntries(requestedShapes.map(
  (shape) => [shape, runFactorial(shape)],
)) as Record<ComparisonShapeKind, FactorialSummary>;
const couplingPass = requestedShapes.length === SHAPES.length
  && Object.values(couplingByShape).every((entry) => entry.pass);
const thermalMeshPass = requestedShapes.length === SHAPES.length
  && Object.values(thermalMeshByShape).every((entry) => entry.pass);
const factorialPass = requestedShapes.length === SHAPES.length
  && Object.values(factorialByShape).every((entry) => entry.closurePass);

if (requestedShapesArgument !== undefined) {
  const partialPrecheckPass = Object.values(couplingByShape).every((entry) => entry.pass)
    && Object.values(thermalMeshByShape).every((entry) => entry.pass)
    && Object.values(factorialByShape).every((entry) => entry.closurePass);
  if (!partialPrecheckPass) {
    throw new Error("Partial shape convergence/factorial checkpoint failed; annual tasks were not run.");
  }
  const annualStatic = {} as Record<ComparisonShapeKind, CaseSummary>;
  const annualControlled = {} as Record<ComparisonShapeKind, CaseSummary>;
  const quasiStatic = {} as Record<ComparisonShapeKind, QuasiCaseSummary>;
  const quasiControlled = {} as Record<ComparisonShapeKind, QuasiCaseSummary>;
  let cylinderWorkerParity: WorkerFullYearParitySummary | undefined;
  for (const shape of requestedShapes) {
    annualStatic[shape] = runAnnualStaticCase(shape);
    annualControlled[shape] = runAnnualControlledCase(shape);
    if (!annualStatic[shape].validationPass || !annualControlled[shape].validationPass) {
      throw new Error(`${shape} partial actual-8760 transient engineering case failed.`);
    }
    quasiStatic[shape] = await cachedAsync(`quasi:static:${shape}`, () =>
      runQuasiWorkerCase(shape, "static"));
    quasiControlled[shape] = await cachedAsync(`quasi:controlled:${shape}`, () =>
      runQuasiWorkerCase(shape, "controlled"));
    if (!quasiStatic[shape].validationPass || !quasiControlled[shape].validationPass) {
      throw new Error(`${shape} partial same-contract quasi engineering case failed.`);
    }
    if (shape === "cylinder") {
      cylinderWorkerParity = await cachedAsync("worker-parity:cylinder:static:8760", () =>
        runWorkerFullYearParity(annualStatic.cylinder));
      if (!cylinderWorkerParity.pass) throw new Error("Cylinder partial Worker parity failed.");
    }
  }
  console.log(JSON.stringify({
    checkpointPath,
    completedShapes: requestedShapes,
    couplingByShape,
    thermalMeshByShape,
    factorialByShape,
    annualStatic,
    annualControlled,
    quasiStatic,
    quasiControlled,
    ...(cylinderWorkerParity === undefined ? {} : { cylinderWorkerParity }),
    note: "Partial run populated checkpoints and left the official gate fail-closed; only a complete no-flag run may publish pass.",
  }, null, 2));
  process.exit(0);
}

const blockingReasons: string[] = [];
if (!couplingPass) blockingReasons.push("900-second circuit/thermal coupling did not converge through 3600/1800/900 seconds within 2% for all shapes.");
if (!thermalMeshPass) blockingReasons.push("Combined engineering path did not converge through 3/6/12 thermal nodes within 1% AC and 0.2 C for all shapes.");
if (!factorialPass) blockingReasons.push("Short actual-clock engineering E00/E10/E01/E11 audit failed closure/layout/energy checks.");

const staticCases = {} as Record<ComparisonShapeKind, CaseSummary>;
const controlledCases = {} as Record<ComparisonShapeKind, CaseSummary>;
if (blockingReasons.length === 0) {
  for (const shape of SHAPES) {
    staticCases[shape] = runAnnualStaticCase(shape);
    controlledCases[shape] = runAnnualControlledCase(shape);
    console.log(`[transient-engineering] annual ${shape} static=${(staticCases[shape].elapsedMs / 1_000).toFixed(1)}s controlled=${(controlledCases[shape].elapsedMs / 1_000).toFixed(1)}s`);
  }
}
if (Object.values(staticCases).some((entry) => !entry.validationPass)
  || Object.values(controlledCases).some((entry) => !entry.validationPass)
  || Object.keys(staticCases).length !== SHAPES.length
  || Object.keys(controlledCases).length !== SHAPES.length) {
  blockingReasons.push("One or more actual 8760-hour coupled annual histories failed coverage, warm-up, circuit, heat, or monthly closure checks.");
}

const quasiStaticCases = {} as Record<ComparisonShapeKind, QuasiCaseSummary>;
const quasiControlledCases = {} as Record<ComparisonShapeKind, QuasiCaseSummary>;
const quasiNaturalCases = {} as Record<ComparisonShapeKind, QuasiCaseSummary>;
let workerFullYearParity: WorkerFullYearParitySummary = {
  shape: "cylinder",
  actualClockHours: 0,
  layoutInvariant: false,
  annualParity: false,
  monthlyParity: false,
  ledgerParity: false,
  maximumAbsoluteDifferenceWh: Number.POSITIVE_INFINITY,
  pass: false,
  elapsedMs: 0,
};
if (Object.keys(staticCases).length === SHAPES.length
  && Object.keys(controlledCases).length === SHAPES.length) {
  for (const shape of SHAPES) {
    quasiStaticCases[shape] = await cachedAsync(`quasi:static:${shape}`, () =>
      runQuasiWorkerCase(shape, "static"));
    quasiControlledCases[shape] = await cachedAsync(`quasi:controlled:${shape}`, () =>
      runQuasiWorkerCase(shape, "controlled"));
    quasiNaturalCases[shape] = {
      ...quasiStaticCases[shape],
      rotationModel: "natural-no-cq-zero-rpm",
      elapsedMs: 0,
    };
    console.log(`[transient-engineering] quasi ${shape} static=${(quasiStaticCases[shape].elapsedMs / 1_000).toFixed(1)}s controlled=${(quasiControlledCases[shape].elapsedMs / 1_000).toFixed(1)}s`);
  }
  workerFullYearParity = await cachedAsync("worker-parity:cylinder:static:8760", () =>
    runWorkerFullYearParity(staticCases.cylinder));
}
const quasiComparisonPass = Object.keys(quasiStaticCases).length === SHAPES.length
  && Object.keys(quasiControlledCases).length === SHAPES.length
  && Object.keys(quasiNaturalCases).length === SHAPES.length
  && [...Object.values(quasiStaticCases), ...Object.values(quasiControlledCases),
    ...Object.values(quasiNaturalCases)].every((entry) => entry.validationPass)
  && SHAPES.every((shape) => quasiNaturalCases[shape].electricalLayoutId
    === quasiStaticCases[shape].electricalLayoutId
    && quasiNaturalCases[shape].netAcEnergyWh === quasiStaticCases[shape].netAcEnergyWh);
if (!quasiComparisonPass) {
  blockingReasons.push("Same-contract actual-8760 Faiman engineering comparison failed metadata, topology, coverage, or monthly closure checks.");
}
if (!workerFullYearParity.pass) {
  blockingReasons.push("Cylinder static actual-8760 Worker publish/ledger did not match the direct coupled core result.");
}

function deterministicFixture(): {
  shape: ComparisonShapeKind;
  actualClockHours: number;
  exactReplay: boolean;
  firstSha256: string;
  replaySha256: string;
} {
  const shape = "cylinder" as const;
  const input = annualInput({
    surface: controlledSurfaces[shape],
    weather: seasonWeather[1],
    rpm: CONTROLLED_RPM,
    couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
    motor: true,
  });
  const fingerprint = (result: AnnualTransientSurfaceResult) => createHash("sha256").update(
    JSON.stringify({
      electricalLayoutId: result.electricalLayoutId,
      dcEnergyWh: result.dcEnergyWh,
      idealLocalMppDcEnergyWh: result.idealLocalMppDcEnergyWh,
      mismatchAndWiringLossEnergyWh: result.mismatchAndWiringLossEnergyWh,
      grossAcEnergyWh: result.grossAcEnergyWh,
      acEnergyWh: result.acEnergyWh,
      motorEnergyWh: result.motorEnergyWh,
      bypassActivationDeviceHours: result.bypassActivationDeviceHours,
      averageTemperatureC: result.averageTemperatureC,
      finalTemperatureCByNode: result.finalTemperatureCByNode,
      monthly: result.monthly,
      engineeringCircuit: result.engineeringCircuit,
    }),
  ).digest("hex");
  const firstSha256 = fingerprint(simulateAnnualTransientSurface(input));
  const replaySha256 = fingerprint(simulateAnnualTransientSurface(input));
  return {
    shape,
    actualClockHours: 24,
    exactReplay: firstSha256 === replaySha256,
    firstSha256,
    replaySha256,
  };
}
const deterministicReplay = cached("deterministic:cylinder:24h", deterministicFixture);
if (!deterministicReplay.exactReplay) blockingReasons.push("Deterministic replay SHA-256 values differ.");

function zeroWeather(year: number, hours: number): WeatherPoint[] {
  return Array.from({ length: hours + 1 }, (_, index) => ({
    timeUtcMs: Date.UTC(year, 0, 1) + index * 3_600_000,
    ghiWm2: 0,
    dniWm2: 0,
    dhiWm2: 0,
    ambientC: 25,
    windSpeedMs: 0,
    windDirectionDeg: 0,
    gustMs: 0,
    cloudFraction: 0,
    precipitationMm: 0,
  }));
}
const leapCoverage = cached("coverage:leap-8784", () => simulateAnnualTransientSurface({
  ...annualInput({
    surface: createComparisonSurface("plane", {
      landAreaM2: LAND_AREA_M2,
      planeTiltDeg: 30,
      planeAzimuthDeg: 180,
      azimuthSamples: 16,
      meridionalSegments: 4,
    }),
    weather: zeroWeather(2024, 8784),
    rpm: 0,
    couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
    motor: false,
  }),
  warmup: false,
  thermalMesh: { targetNodeCount: 1 },
  thermalConfig: {
    ...DEFAULT_TRANSIENT_THERMAL_CONFIG,
    arealHeatCapacityJm2K: 1e12,
    emissivity: 0,
    minimumConvectionWm2K: 0,
    backConvectionFactor: 0,
    maximumSubstepSeconds: 3_600,
  },
  effectiveSkyTemperatureOffsetC: 0,
  radiativeSurfaceFactor: 0,
}).coverage);
if (!leapCoverage.isFullCalendarYear || leapCoverage.durationHours !== 8784
  || leapCoverage.steps !== 8785 || !leapCoverage.closingEndpointPresent) {
  blockingReasons.push("Leap-year 8784-hour closing-endpoint coverage regression failed.");
}
if (!baselinePass) blockingReasons.push("Ideal d9ff14a baseline regression failed.");

const officialRankingEligible = blockingReasons.length === 0;
function rankingRows(
  rotation: "static" | "controlled" | "natural",
): Array<Record<string, unknown>> {
  const source = rotation === "controlled" ? controlledCases : staticCases;
  const quasiSource = rotation === "controlled"
    ? quasiControlledCases
    : rotation === "natural"
      ? quasiNaturalCases
      : quasiStaticCases;
  const ordered = SHAPES.map((shape) => {
    const entry = source[shape];
    const quasiKWhYear = quasiSource[shape].netAcEnergyWh / 1_000;
    const netAcKWhYear = entry.netAcEnergyWh / 1_000;
    return {
      rank: null as number | null,
      shape,
      landAreaM2: entry.landAreaM2,
      activePvAreaM2: entry.activePvAreaM2,
      pvLandRatio: entry.activePvAreaM2 / entry.landAreaM2,
      dcKWhYear: entry.dcEnergyWh / 1_000,
      idealLocalMppDcKWhYear: entry.idealLocalMppDcEnergyWh / 1_000,
      mismatchAndWiringLossKWhYear: entry.mismatchAndWiringLossEnergyWh / 1_000,
      grossAcKWhYear: entry.grossAcEnergyWh / 1_000,
      motorKWhYear: rotation === "natural" ? 0 : entry.motorEnergyWh / 1_000,
      netAcKWhYear,
      kWhPerLandM2Year: netAcKWhYear / entry.landAreaM2,
      kWhPerPvM2Year: netAcKWhYear / entry.activePvAreaM2,
      quasiSteadyEngineeringNetAcKWhYear: quasiKWhYear,
      transientMinusQuasiSteadyKWhYear: netAcKWhYear - quasiKWhYear,
      transientMinusQuasiSteadyFraction: (netAcKWhYear - quasiKWhYear)
        / Math.max(1e-12, Math.abs(quasiKWhYear)),
      electricalLayoutId: entry.electricalLayoutId,
      topology: entry.topology,
      monthly: entry.monthly,
      provenance: {
        weatherSource: "offline/model-estimate (not measured Seoul TMY)",
        timeRange: "2025 local reporting year",
        timeResolution: "60 min weather; actual 8760 intervals + closing endpoint",
        footprintMethod: entry.geometryContract,
        electricalModel: "explicit-series-parallel-bypass",
        thermalModel: "annual-transient-material-state",
        rotationModel: rotation === "natural"
          ? "natural symmetric no-C_Q: exactly 0 RPM; exact static reuse"
          : entry.rotationModel,
        representativeDayScaling: false,
        couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
        officialStatus: officialRankingEligible ? "official" : "blocked",
      },
    };
  }).sort((left, right) => right.kWhPerLandM2Year - left.kWhPerLandM2Year);
  if (officialRankingEligible) ordered.forEach((row, index) => { row.rank = index + 1; });
  return ordered;
}

const rankings = {
  static: { official: officialRankingEligible, rows: rankingRows("static") },
  controlled: { official: officialRankingEligible, rows: rankingRows("controlled") },
  natural: { official: officialRankingEligible, rows: rankingRows("natural") },
};

const report = {
  schemaVersion: SCHEMA_VERSION,
  generatedAtUtc: new Date().toISOString(),
  verdict: officialRankingEligible ? "pass" : "fail",
  officialRankingEligible,
  blockingReasons,
  conditions: {
    year: YEAR,
    landAreaM2: LAND_AREA_M2,
    maximumHeightM: MAXIMUM_HEIGHT_M,
    planeTiltDeg: 30,
    controlledRpm: CONTROLLED_RPM,
    controlledMotor: MOTOR_DRIVE,
    naturalCq: "absent; symmetric shapes use exact 0 RPM and produce no wind electricity",
    reflector: "none",
    obstacles: "none",
    albedo: 0.2,
  },
  certifiedFixture,
  provenance: {
    weatherSource: "offline/model-estimate (not measured Seoul TMY)",
    weatherSeed: WEATHER_SEED,
    idealAuditPath,
    idealAuditSha256,
    meshAuditPath,
    meshAuditSha256,
    meshConvergencePass,
    meshGeometryContracts: meshAudit.geometryContracts.map((contract) => ({
      contractId: contract.contractId,
      footprintMode: contract.footprintMode,
      rotationModel: contract.rotationModel,
      phaseGateRequired: contract.phaseGateRequired,
      pass: contract.pass,
      officialEligible: contract.officialEligible,
    })),
    thermalAuditPath,
    thermalAuditSha256,
    thermalAuditPass: thermalAudit.pass && thermalAudit.meshConvergence14Day.converged,
    sharedConnection: OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
    spatialLayoutVersion: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
    implementationFingerprint,
    computationImplementationFingerprint,
    implementationSourceFiles: IMPLEMENTATION_SOURCE_FILES,
    legacyExploratoryEngineeringArtifact: {
      use: "reference-only; topology/mesh differ and values are excluded from transient-minus-quasi comparisons and official gates",
      groups: [
        quasiStaticEngineeringGroup?.id,
        quasiControlledEngineeringGroup?.id,
        quasiNaturalEngineeringGroup?.id,
      ],
    },
  },
  resolution: {
    byGeometryContract: selectedResolutionByGeometryContract,
    optical: { byShape: selectedResolutionByShape },
    phaseSamples: { byShape: selectedPhaseSamplesByShape },
    circuitSamples: { byShape: selectedCircuitSamplesByShape },
    thermalNodeCount: THERMAL_NODE_COUNT,
    thermalMaximumSubstepSeconds: THERMAL_MAXIMUM_SUBSTEP_SECONDS,
    couplingStepSeconds: OFFICIAL_COUPLING_STEP_SECONDS,
    warmup: WARMUP,
  },
  coverage: {
    annual: {
      points: weather.length,
      intervals: weather.length - 1,
      durationHours: (weather.at(-1)!.timeUtcMs - weather[0].timeUtcMs) / 3_600_000,
      closingEndpointPresent: true,
      isFullCalendarYear: true,
    },
    leapRegression: leapCoverage,
  },
  unsupportedMatrix: {
    obstacle: { supported: false, reason: "Obstacle visibility is rejected before transient execution." },
    verticalRotation: { supported: true, reason: "Material-space topology is invariant under world-Y rotation." },
    planeTracking: { supported: false, reason: "Plane tracking is rejected before transient execution." },
  },
  baselineRegression: {
    pass: baselinePass,
    toleranceFraction: BASELINE_RELATIVE_TOLERANCE,
    fixturePath: baselineFixturePath,
    fixtureSha256: baselineFixtureSha256,
    baselineCommit: baselineFixture.baselineCommit,
    sourceArtifactSha256AtBaseline: baselineFixture.sourceArtifactSha256AtBaseline,
    currentIdealArtifactSha256: idealAuditSha256,
    baselineConfigurationFingerprint: baselineFixture.configurationFingerprint,
    currentConfigurationFingerprint: idealAudit.conditions.configurationFingerprint,
    baselineImplementationFingerprint: baselineFixture.implementationFingerprint,
    currentImplementationFingerprint: idealAudit.conditions.implementationFingerprint,
    byShape: baselineByShape,
  },
  couplingConvergence: {
    stepsSeconds: COUPLING_STEPS_SECONDS,
    toleranceFraction: COUPLING_TOLERANCE_FRACTION,
    byShape: couplingByShape,
    pass: couplingPass,
  },
  thermalMeshConvergence: {
    nodeCounts: [3, 6, 12],
    energyToleranceFraction: THERMAL_MESH_ENERGY_TOLERANCE_FRACTION,
    temperatureToleranceC: THERMAL_MESH_TEMPERATURE_TOLERANCE_C,
    byShape: thermalMeshByShape,
    pass: thermalMeshPass,
  },
  thermalModelComparison: {
    contract: "Same geometry, actual 8760-hour weather clock, engineering connection, optical mesh, phase quadrature, circuit resolution, inverter, and motor contract. The only physical thermal-model change is pointwise quasi-steady Faiman versus persistent annual transient material state; the established Worker quasi path uses boundary-point trapezoidal integration while the transient solver integrates interval substeps.",
    quasiSteadyModel: {
      model: "quasi-steady-faiman",
      periodIntegration: "pointwise-quasi-steady",
      config: DEFAULT_THERMAL,
    },
    transientModel: {
      model: "annual-transient-material-state",
      periodIntegration: "actual-weather-clock",
      config: DEFAULT_TRANSIENT_THERMAL_CONFIG,
    },
    static: quasiStaticCases,
    controlled: quasiControlledCases,
    natural: quasiNaturalCases,
    pass: quasiComparisonPass,
  },
  workerFullYearParity,
  rankings,
  shortFactorialDecomposition: {
    contract: "Four independent actual-clock 24 h seasonal histories (96 h total), never concatenated across gaps and never annual-scaled. E10 and E01 retain active-motor demand because either counterfactual rotation mechanism implies the controlled drive is on; gross, motor, and net are therefore reported separately.",
    byShape: factorialByShape,
  },
  deterministicReplay,
  runtime: {
    checkpointPath,
    checkpointFingerprint,
    taskCount: Object.keys(checkpoint.tasks).length,
    taskElapsedMs: Object.values(checkpoint.tasks).reduce<number>((total, value) => {
      if (value !== null && typeof value === "object" && "elapsedMs" in value
        && typeof value.elapsedMs === "number") return total + value.elapsedMs;
      return total;
    }, 0),
    generatedProcessUptimeSeconds: process.uptime(),
  },
};

const reportJson = `${JSON.stringify(report, null, 2)}\n`;
const rankingTable = (id: keyof typeof rankings) => [
  `### ${id}`,
  "",
  "| rank | shape | net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | ideal local-MPP DC kWh/y | engineering DC kWh/y | mismatch+wiring kWh/y | quasi steady AC kWh/y | transient - quasi |",
  "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...rankings[id].rows.map((row) => `| ${row.rank ?? "-"} | ${row.shape} | ${Number(row.netAcKWhYear).toFixed(6)} | ${Number(row.kWhPerLandM2Year).toFixed(3)} | ${Number(row.kWhPerPvM2Year).toFixed(3)} | ${Number(row.idealLocalMppDcKWhYear).toFixed(6)} | ${Number(row.dcKWhYear).toFixed(6)} | ${Number(row.mismatchAndWiringLossKWhYear).toFixed(6)} | ${Number(row.quasiSteadyEngineeringNetAcKWhYear).toFixed(6)} | ${Number(row.transientMinusQuasiSteadyKWhYear).toFixed(6)} |`),
].join("\n");
const couplingTable = [
  "| shape | 3600s Wh | 1800s Wh | 900s Wh | delta 3600-1800 | delta 1800-900 | pass |",
  "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ...SHAPES.map((shape) => {
    const entry = couplingByShape[shape];
    return `| ${shape} | ${entry.levels[0].netAcEnergyWh.toFixed(6)} | ${entry.levels[1].netAcEnergyWh.toFixed(6)} | ${entry.levels[2].netAcEnergyWh.toFixed(6)} | ${(entry.consecutiveDeltas[0].relativeNetAcDifference * 100).toFixed(4)}% | ${(entry.consecutiveDeltas[1].relativeNetAcDifference * 100).toFixed(4)}% | ${entry.pass ? "pass" : "fail"} |`;
  }),
].join("\n");
const thermalMeshTable = [
  "| shape | 3 nodes Wh | 6 nodes Wh | 12 nodes Wh | max AC delta | max T delta C | pass |",
  "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ...SHAPES.map((shape) => {
    const entry = thermalMeshByShape[shape];
    return `| ${shape} | ${entry.levels[0].netAcEnergyWh.toFixed(6)} | ${entry.levels[1].netAcEnergyWh.toFixed(6)} | ${entry.levels[2].netAcEnergyWh.toFixed(6)} | ${(Math.max(...entry.consecutiveDeltas.map((delta) => delta.relativeNetAcDifference)) * 100).toFixed(4)}% | ${Math.max(...entry.consecutiveDeltas.map((delta) => delta.averageTemperatureDifferenceC)).toFixed(6)} | ${entry.pass ? "pass" : "fail"} |`;
  }),
].join("\n");
const thermalComparisonTable = [
  "| mode | shape | quasi Faiman net AC kWh/y | transient+engineering net AC kWh/y | delta kWh/y | delta |",
  "| --- | --- | ---: | ---: | ---: | ---: |",
  ...(["static", "controlled", "natural"] as const).flatMap((mode) =>
    rankings[mode].rows.map((row) =>
      `| ${mode} | ${row.shape} | ${Number(row.quasiSteadyEngineeringNetAcKWhYear).toFixed(6)} | ${Number(row.netAcKWhYear).toFixed(6)} | ${Number(row.transientMinusQuasiSteadyKWhYear).toFixed(6)} | ${(Number(row.transientMinusQuasiSteadyFraction) * 100).toFixed(4)}% |`)),
].join("\n");
const markdownOutput = `${[
  "# Transient thermal + engineering circuit full-year audit (2026)",
  "",
  `- Verdict: **${report.verdict}**; official ranking eligible: **${officialRankingEligible}**`,
  `- Weather: offline/model-estimate, actual ${report.coverage.annual.intervals} intervals plus closing endpoint; no representative-day annual scaling`,
  `- Electrical topology: ${ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION}; nominal cell ${OFFICIAL_ENGINEERING_SURFACE_CONNECTION.nominalCellAreaM2} m2; ${OFFICIAL_ENGINEERING_SURFACE_CONNECTION.parallelStrings} strings; ${OFFICIAL_ENGINEERING_SURFACE_CONNECTION.cellsPerBypassSubstring} cells/bypass substring`,
  `- Mesh audit SHA-256: \`${meshAuditSha256}\``,
  `- Thermal audit SHA-256: \`${thermalAuditSha256}\``,
  `- Ideal audit SHA-256: \`${idealAuditSha256}\``,
  `- Full-year Worker/direct cylinder parity: **${workerFullYearParity.pass ? "pass" : "fail"}** (max |difference| ${workerFullYearParity.maximumAbsoluteDifferenceWh} Wh)`,
  ...(blockingReasons.length === 0 ? [] : ["", "## Blocking reasons", "", ...blockingReasons.map((reason) => `- ${reason}`)]),
  "",
  "## Circuit/thermal coupling convergence",
  "",
  couplingTable,
  "",
  "## Combined thermal-node mesh convergence",
  "",
  thermalMeshTable,
  "",
  "## Same-contract quasi-steady versus transient thermal model",
  "",
  report.thermalModelComparison.contract,
  "",
  thermalComparisonTable,
  "",
  "## Official annual rankings",
  "",
  rankingTable("static"),
  "",
  rankingTable("controlled"),
  "",
  rankingTable("natural"),
  "",
  "## Factorial interpretation",
  "",
  report.shortFactorialDecomposition.contract,
  "",
  "Natural rotation is exactly 0 RPM because no source-backed C_Q or auxiliary rotor exists. Natural rows reuse the static calculation exactly; wind-generated electricity is excluded.",
  "",
].join("\n")}\n`;
atomicWriteFile(jsonPath, reportJson);
atomicWriteFile(markdownPath, markdownOutput);
if (officialRankingEligible) {
  const artifactSha256 = createHash("sha256").update(reportJson).digest("hex");
  const compactRankingRow = (row: Record<string, unknown>) => ({
    rank: row.rank,
    shape: row.shape,
    landAreaM2: row.landAreaM2,
    activePvAreaM2: row.activePvAreaM2,
    netAcKWhYear: row.netAcKWhYear,
    kWhPerLandM2Year: row.kWhPerLandM2Year,
    kWhPerPvM2Year: row.kWhPerPvM2Year,
    layoutId: row.electricalLayoutId,
    status: "official",
  });
  const compactOfficialRankings = {
    static: rankings.static.rows.map(compactRankingRow),
    controlled: rankings.controlled.rows.map(compactRankingRow),
    natural: rankings.natural.rows.map(compactRankingRow),
  } satisfies Record<"static" | "controlled" | "natural",
    readonly Record<string, unknown>[]>;
  atomicWriteFile(validationGatePath, `${JSON.stringify(
    validationGate("pass", artifactSha256, report.generatedAtUtc, compactOfficialRankings), null, 2,
  )}\n`);
  // The manifest requires audit artifacts to be newer than their source gate.
  atomicWriteFile(jsonPath, reportJson);
  atomicWriteFile(markdownPath, markdownOutput);
}

if (officialRankingEligible && existsSync(checkpointPath)) unlinkSync(checkpointPath);
console.log(JSON.stringify({
  jsonPath,
  markdownPath,
  verdict: report.verdict,
  officialRankingEligible,
  meshAuditSha256,
  idealAuditSha256,
  deterministicReplay,
  couplingPass,
  thermalMeshPass,
  factorialPass,
  quasiComparisonPass,
  workerFullYearParity,
}, null, 2));
if (!officialRankingEligible) throw new Error(blockingReasons.join(" "));
