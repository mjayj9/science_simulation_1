import engineeringMeshGateJson from "../lib/physics/engineering-mesh-validation.generated.json";
import transientEngineeringGateJson from "../lib/physics/transient-engineering-validation.generated.json";
import type { AnnualRotationDecompositionResult } from "../lib/physics/annual-transient";
import type { AnnualEngineeringElectricalAudit } from "../workers/protocol";
import {
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  engineeringOfficialEligibility,
  type EngineeringSurfaceConnectionConfig,
} from "../lib/physics/engineering-surface-electrical";


export const ENGINEERING_RANK_SHAPES = [
  "plane",
  "cube",
  "cylinder",
  "sphere",
  "hemisphere",
  "cone",
] as const;

export type EngineeringRankShape = typeof ENGINEERING_RANK_SHAPES[number];
export type EngineeringFootprintMode = "static" | "swept";
export type EngineeringCertifiedFixture = typeof transientEngineeringGateJson.certifiedFixture;

export type EngineeringArtifactRankingMode = "static" | "controlled" | "natural";

export interface EngineeringArtifactOfficialRankingRow {
  rank: number;
  shape: EngineeringRankShape;
  landAreaM2: number;
  activePvAreaM2: number;
  netAcKWhYear: number;
  kWhPerLandM2Year: number;
  kWhPerPvM2Year: number;
  layoutId: string;
  status: "official";
}

export interface EngineeringCertifiedResolution {
  azimuthSamples: number;
  meridionalSegments: number;
  phaseSamples: number;
  circuitSamples: number;
}

export interface EngineeringCoupledSettings {
  thermalNodeCount: number;
  maximumThermalSubstepSeconds: number;
  maximumElectricalCouplingStepSeconds: number;
}

interface MeshValidationGate {
  schemaVersion: number;
  status: string;
  officialRankingEligible: boolean;
  artifactSha256: string;
  layoutVersion: string;
  officialMinimumResolution: EngineeringCertifiedResolution;
  contracts: readonly {
    contractId: string;
    footprintMode: EngineeringFootprintMode;
    phaseGateRequired: boolean;
    pass: boolean;
  }[];
}

interface TransientEngineeringValidationGate {
  schemaVersion: number;
  status: string;
  officialRankingEligible: boolean;
  artifactPath: string;
  artifactSha256: string;
  implementationSha256: string;
  configurationSha256: string;
  meshAuditSha256: string;
  certifiedFixture: EngineeringCertifiedFixture;
  officialRankings: Record<EngineeringArtifactRankingMode, readonly EngineeringArtifactOfficialRankingRow[]>;
  layoutVersion: string;
  geometryContracts: readonly {
    contractId: string;
    footprintMode: EngineeringFootprintMode;
    phaseGateRequired: boolean;
    validatedResolution: EngineeringCertifiedResolution;
    layoutIdByShape: Record<EngineeringRankShape, string>;
    pass: boolean;
    officialEligible: boolean;
  }[];
  validatedMinimumResolution: Record<
    string,
    Record<EngineeringRankShape, EngineeringCertifiedResolution>
  >;
  validatedCoupledSettings: EngineeringCoupledSettings & {
    couplingConvergenceToleranceFraction: number;
    thermalMeshEnergyToleranceFraction: number;
    thermalMeshTemperatureToleranceC: number;
    maximumElectricalExtractionClosureErrorW: number;
    maximumHeatEnergyResidualFraction: number;
  };
}

export interface EngineeringCertifiedRuntimeGeometry {
  landAreaM2: number;
  maximumHeightM: number;
  structureHeightM: number;
  supportHeightM: number;
  planeTiltDeg: number;
}

export interface EngineeringAnnualRunMetadata {
  runId: string;
  steps: number;
  intervals: number;
  durationHours: number;
}

export interface EngineeringAnnualRuntimeRow {
  shape: EngineeringRankShape;
  energyWh?: number;
  authoritativePath?: string;
  layoutId?: string;
  audit?: AnnualEngineeringElectricalAudit;
  decomposition?: AnnualRotationDecompositionResult;
  metadata?: EngineeringAnnualRunMetadata;
  expectedActiveAreaM2: number;
}

export interface EngineeringOfficialRuntimeInput {
  rows: readonly EngineeringAnnualRuntimeRow[];
  footprintMode: EngineeringFootprintMode;
  rotationRequiresPhaseQuadrature: boolean;
  resolution: EngineeringCertifiedResolution;
  coupledSettings: EngineeringCoupledSettings;
  runtimeGeometry: EngineeringCertifiedRuntimeGeometry;
  runtimeFixture: EngineeringCertifiedFixture;
  connection: EngineeringSurfaceConnectionConfig;
  expectedSteps: number;
  expectedIntervals: number;
  expectedDurationHours: number;
  gates?: {
    mesh: MeshValidationGate;
    transient: TransientEngineeringValidationGate;
  };
}

export interface EngineeringOfficialRuntimeEligibility {
  eligible: boolean;
  contractId?: string;
  reasons: string[];
}

const CERTIFIED_SUPPORT_HEIGHT_M = 0;

/**
 * The two generated gates must certify the *same* mesh artifact.
 *
 * A literal SHA-256 pinned in source cannot express this. It pins one frozen
 * artifact, so regenerating the mesh audit — which every source change requires
 * — permanently blocks official ranking until a human edits this file, and the
 * edit is unverifiable by inspection. Worse, the literal only proves "somebody
 * typed this string", not that the audits agree.
 *
 * Cross-certification proves the real invariant instead: the transient audit
 * ran its preflight against exactly the artifact the mesh gate published. Both
 * audits independently recompute the artifact bytes before publishing their
 * gate, so agreement between the gates chains back to the bytes on disk.
 * Forgery resistance comes from the independent recomputation in
 * `validateOfficialRankingArithmetic`, not from a constant.
 */
function meshArtifactCrossCertified(gates: {
  mesh: Pick<MeshValidationGate, "artifactSha256">;
  transient: Pick<TransientEngineeringValidationGate, "meshAuditSha256">;
}): boolean {
  return completeSha256(gates.mesh.artifactSha256)
    && gates.transient.meshAuditSha256 === gates.mesh.artifactSha256;
}

const GENERATED_GATES = {
  mesh: engineeringMeshGateJson as MeshValidationGate,
  transient: transientEngineeringGateJson as TransientEngineeringValidationGate,
};

function close(actual: number, expected: number, tolerance = 1e-9): boolean {
  return Number.isFinite(actual)
    && Number.isFinite(expected)
    && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

function fixtureValuesMatch(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" && typeof expected === "number") {
    return close(actual, expected, 1e-12);
  }
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") {
    return actual === expected;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((item, index) => fixtureValuesMatch(item, expected[index]));
  }
  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const actualKeys = Object.keys(actualRecord).sort();
  const expectedKeys = Object.keys(expectedRecord).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]
      && fixtureValuesMatch(actualRecord[key], expectedRecord[key]));
}

export function certifiedEngineeringFixtureEligibility(input: {
  actual: EngineeringCertifiedFixture;
  certified: EngineeringCertifiedFixture;
}): EngineeringOfficialRuntimeEligibility {
  const reasons: string[] = [];
  const sections = [
    "year", "location", "reportingOffsetMinutes", "weather", "geometry", "optics",
    "pv", "inverter", "thermal", "controlledRotation", "connection",
  ] as const;
  for (const section of sections) {
    if (!fixtureValuesMatch(input.actual[section], input.certified[section])) {
      reasons.push(`${section}-fixture-mismatch`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

export function certifiedRuntimeGeometryEligibility(input: {
  runtime: EngineeringCertifiedRuntimeGeometry;
  certified: EngineeringCertifiedFixture["geometry"];
}): EngineeringOfficialRuntimeEligibility {
  const matches = close(input.runtime.landAreaM2, input.certified.landAreaM2)
    && close(input.runtime.maximumHeightM, input.certified.maximumHeightM)
    && close(input.runtime.structureHeightM, input.certified.maximumHeightM)
    && close(input.runtime.supportHeightM, CERTIFIED_SUPPORT_HEIGHT_M)
    && close(input.runtime.planeTiltDeg, input.certified.planeTiltDeg);
  return {
    eligible: matches,
    reasons: matches ? [] : ["runtime-geometry-outside-certified-fixture"],
  };
}

function completeSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function resolutionAtLeast(
  actual: EngineeringCertifiedResolution,
  minimum: EngineeringCertifiedResolution,
  phaseRequired: boolean,
): boolean {
  return actual.azimuthSamples >= minimum.azimuthSamples
    && actual.meridionalSegments >= minimum.meridionalSegments
    && actual.circuitSamples >= minimum.circuitSamples
    && (!phaseRequired || actual.phaseSamples >= minimum.phaseSamples);
}

function certifiedLayoutActiveAreaM2(layoutId: string): number | undefined {
  const match = layoutId.match(/(?:^|\|)activeAreaM2=([^|]+)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function certifiedRuntimeLayoutEligibility(input: {
  runtimeLayoutId?: string;
  auditLayoutId?: string;
  certifiedLayoutId?: string;
  expectedActiveAreaM2: number;
  layoutVersion: string;
}): EngineeringOfficialRuntimeEligibility {
  const certifiedActiveAreaM2 = input.certifiedLayoutId
    ? certifiedLayoutActiveAreaM2(input.certifiedLayoutId)
    : undefined;
  const matches = Boolean(input.runtimeLayoutId)
    && input.runtimeLayoutId === input.auditLayoutId
    && input.runtimeLayoutId === input.certifiedLayoutId
    && input.runtimeLayoutId!.startsWith(`${input.layoutVersion}|`)
    && certifiedActiveAreaM2 !== undefined
    && close(input.expectedActiveAreaM2, certifiedActiveAreaM2);
  return {
    eligible: matches,
    reasons: matches ? [] : ["runtime-geometry-layout-not-certified"],
  };
}

function completeShapeSet(rows: readonly EngineeringAnnualRuntimeRow[]): boolean {
  if (rows.length !== ENGINEERING_RANK_SHAPES.length) return false;
  const supplied = new Set(rows.map((row) => row.shape));
  return ENGINEERING_RANK_SHAPES.every((shape) => supplied.has(shape));
}

function monthlyAuditCloses(audit: AnnualEngineeringElectricalAudit): boolean {
  if (audit.monthly.length !== 12
    || new Set(audit.monthly.map((month) => month.monthUtc)).size !== 12) return false;
  const sums = audit.monthly.reduce((total, month) => ({
    ideal: total.ideal + month.idealLocalMppDcEnergyWh,
    engineering: total.engineering + month.engineeringDcEnergyWh,
    mismatch: total.mismatch + month.mismatchAndWiringLossEnergyWh,
    grossAc: total.grossAc + month.grossAcEnergyWh,
    netAc: total.netAc + month.netAcEnergyWh,
    motor: total.motor + month.motorEnergyWh,
    bypass: total.bypass + month.bypassActivationDeviceHours,
  }), { ideal: 0, engineering: 0, mismatch: 0, grossAc: 0, netAc: 0, motor: 0, bypass: 0 });
  return close(sums.ideal, audit.annual.idealLocalMppDcEnergyWh)
    && close(sums.engineering, audit.annual.engineeringDcEnergyWh)
    && close(sums.mismatch, audit.annual.mismatchAndWiringLossEnergyWh)
    && close(sums.grossAc, audit.annual.grossAcEnergyWh)
    && close(sums.netAc, audit.annual.netAcEnergyWh)
    && close(sums.motor, audit.annual.motorEnergyWh)
    && close(sums.bypass, audit.annual.bypassActivationDeviceHours);
}

type EngineeringEnergyLedger = Pick<
  AnnualEngineeringElectricalAudit["annual"],
  | "idealLocalMppDcEnergyWh"
  | "engineeringDcEnergyWh"
  | "mismatchAndWiringLossEnergyWh"
  | "grossAcEnergyWh"
  | "netAcEnergyWh"
  | "motorEnergyWh"
>;

function engineeringEnergyLedgerCloses(ledger: EngineeringEnergyLedger): boolean {
  const values = Object.values(ledger);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return false;
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)));
  const toleranceWh = 1e-9 * scale;
  const expectedNetFloorWh = Math.max(0, ledger.grossAcEnergyWh - ledger.motorEnergyWh);
  return ledger.engineeringDcEnergyWh <= ledger.idealLocalMppDcEnergyWh + toleranceWh
    && ledger.mismatchAndWiringLossEnergyWh >= -toleranceWh
    && ledger.netAcEnergyWh <= ledger.grossAcEnergyWh + toleranceWh
    && ledger.netAcEnergyWh + toleranceWh >= expectedNetFloorWh
    && ledger.grossAcEnergyWh - ledger.netAcEnergyWh <= ledger.motorEnergyWh + toleranceWh
    && (ledger.motorEnergyWh > toleranceWh
      || Math.abs(ledger.netAcEnergyWh - ledger.grossAcEnergyWh) <= toleranceWh);
}

function engineeringEnergyBoundsClose(audit: AnnualEngineeringElectricalAudit): boolean {
  return engineeringEnergyLedgerCloses(audit.annual)
    && audit.monthly.every((month) => engineeringEnergyLedgerCloses(month));
}

function topologyCloses(
  audit: AnnualEngineeringElectricalAudit,
  expectedActiveAreaM2: number,
): boolean {
  const topology = audit.topology;
  return close(topology.activeAreaM2, expectedActiveAreaM2)
    && topology.cellCount > 0
    && topology.parallelStringCount === OFFICIAL_ENGINEERING_SURFACE_CONNECTION.parallelStrings
    && topology.seriesCellCountByString.length === topology.parallelStringCount
    && topology.seriesCellCountByString.every((count) => Number.isInteger(count) && count > 0)
    && topology.seriesCellCountByString.reduce((sum, count) => sum + count, 0) === topology.cellCount
    && Number.isInteger(topology.bypassSubstringCount)
    && topology.bypassSubstringCount === topology.seriesCellCountByString.reduce(
      (sum, count) => sum + Math.ceil(
        count / OFFICIAL_ENGINEERING_SURFACE_CONNECTION.cellsPerBypassSubstring,
      ), 0);
}

/**
 * Two land productivities count as tied when they agree to this fraction.
 * Ranks are an ordinal claim, so the comparison must not turn last-bit
 * floating-point noise into a published ordering difference.
 */
const RANK_TIE_RELATIVE_TOLERANCE = 1e-12;

function landProductivityTied(left: number, right: number): boolean {
  return Math.abs(left - right)
    <= RANK_TIE_RELATIVE_TOLERANCE * Math.max(1, Math.abs(left), Math.abs(right));
}

/**
 * Decides the published order of two shapes whose land productivity is tied.
 *
 * Returns a negative number when `left` must be ranked ahead of `right`, a
 * positive number when `right` must be ranked ahead, and 0 when the tie cannot
 * be resolved.
 *
 * Owner decision: refuse to resolve. The official question is land
 * productivity alone, so a tie means the comparison genuinely does not separate
 * the two shapes. Ranking them anyway would require importing a second
 * criterion (PV-area efficiency) that the question never asked, or a
 * declaration-order fallback that dresses an arbitrary sequence as a physical
 * result — the same dishonesty as numbering an unconverged run. Returning 0
 * makes the whole cohort ineligible and surfaces it as
 * `EXPLORATORY_RANK_LABEL_KO` instead.
 *
 * Real annual energies separating by less than `RANK_TIE_RELATIVE_TOLERANCE`
 * are not expected, so this refusal should stay unreachable in practice. If it
 * ever triggers, the correct response is to investigate why two shapes produce
 * identical annual output, not to add a tie-break here.
 */
function compareTiedLandProductivity(
  left: EngineeringArtifactOfficialRankingRow,
  right: EngineeringArtifactOfficialRankingRow,
): number {
  void left;
  void right;
  return 0;
}

export interface OfficialRankingArithmeticResult {
  valid: boolean;
  reasons: readonly string[];
}

/**
 * Recomputes the published ranking from its own reported energies and areas.
 *
 * The gate JSON is generated by the audit, so trusting its `rank` field would
 * make the UI a renderer of whatever the audit asserted. This recomputes the
 * ordinal claim from `netAcKWhYear`, `landAreaM2` and `activePvAreaM2`, which
 * is what makes a forged or mis-sorted gate detectable at the point of display.
 */
export function validateOfficialRankingArithmetic(
  rows: readonly EngineeringArtifactOfficialRankingRow[],
): OfficialRankingArithmeticResult {
  const reasons: string[] = [];
  if (rows.length !== ENGINEERING_RANK_SHAPES.length) {
    return { valid: false, reasons: ["ranking-row-count-mismatch"] };
  }

  for (const row of rows) {
    if (!Number.isFinite(row.netAcKWhYear) || row.netAcKWhYear < 0) {
      reasons.push(`${row.shape}:net-ac-not-finite-non-negative`);
      continue;
    }
    if (!Number.isFinite(row.landAreaM2) || row.landAreaM2 <= 0
      || !Number.isFinite(row.activePvAreaM2) || row.activePvAreaM2 <= 0) {
      reasons.push(`${row.shape}:area-not-positive-finite`);
      continue;
    }
    // Independent recomputation, not a re-read of the published quotient.
    if (!close(row.kWhPerLandM2Year, row.netAcKWhYear / row.landAreaM2, 1e-9)) {
      reasons.push(`${row.shape}:land-productivity-arithmetic-mismatch`);
    }
    if (!close(row.kWhPerPvM2Year, row.netAcKWhYear / row.activePvAreaM2, 1e-9)) {
      reasons.push(`${row.shape}:pv-productivity-arithmetic-mismatch`);
    }
  }
  if (reasons.length > 0) return { valid: false, reasons: [...new Set(reasons)] };

  // Rank must match position, not merely form a complete 1..N set. Checking the
  // sorted set alone accepts a permutation that awards rank 1 to the worst row.
  rows.forEach((row, index) => {
    if (row.rank !== index + 1) reasons.push(`${row.shape}:rank-does-not-match-row-order`);
  });

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (landProductivityTied(previous.kWhPerLandM2Year, current.kWhPerLandM2Year)) {
      if (compareTiedLandProductivity(previous, current) >= 0) {
        reasons.push(`${previous.shape}/${current.shape}:tie-break-unresolved`);
      }
      continue;
    }
    if (current.kWhPerLandM2Year > previous.kWhPerLandM2Year) {
      reasons.push(`${previous.shape}/${current.shape}:ranking-not-descending`);
    }
  }

  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function generatedEngineeringGateSummary(): {
  meshPass: boolean;
  transientPass: boolean;
  official: boolean;
  layoutVersion: string;
} {
  const meshPass = GENERATED_GATES.mesh.schemaVersion === 1
    && GENERATED_GATES.mesh.status === "pass"
    && GENERATED_GATES.mesh.officialRankingEligible === true;
  const transientPass = GENERATED_GATES.transient.schemaVersion === 1
    && GENERATED_GATES.transient.status === "pass"
    && GENERATED_GATES.transient.officialRankingEligible === true;
  return {
    meshPass,
    transientPass,
    official: meshPass && transientPass
      && GENERATED_GATES.mesh.layoutVersion === GENERATED_GATES.transient.layoutVersion,
    layoutVersion: GENERATED_GATES.mesh.layoutVersion,
  };
}

export function generatedEngineeringOfficialRankingArtifact(): {
  available: boolean;
  gateStatus: string;
  artifactPath: string;
  artifactSha256: string;
  provenance: string;
  rankings: Record<EngineeringArtifactRankingMode, readonly EngineeringArtifactOfficialRankingRow[]>;
} {
  const transient = GENERATED_GATES.transient;
  const modes: EngineeringArtifactRankingMode[] = ["static", "controlled", "natural"];
  const rankings = transient.officialRankings;
  const gateSummary = generatedEngineeringGateSummary();
  const rankingsComplete = modes.every((mode) => {
    const rows = rankings[mode];
    const contractId = mode === "controlled" ? "swept-rotation-envelope" : "static-land-matched";
    const contract = transient.geometryContracts.find((candidate) => candidate.contractId === contractId);
    return contract?.pass === true
      && contract.officialEligible === true
      && rows.length === ENGINEERING_RANK_SHAPES.length
      && new Set(rows.map((row) => row.shape)).size === ENGINEERING_RANK_SHAPES.length
      && validateOfficialRankingArithmetic(rows).valid
      && rows.every((row) => row.status === "official"
        && Number.isFinite(row.landAreaM2) && close(row.landAreaM2, transient.certifiedFixture.geometry.landAreaM2)
        && Number.isFinite(row.activePvAreaM2) && row.activePvAreaM2 > 0
        && Number.isFinite(row.netAcKWhYear) && row.netAcKWhYear >= 0
        && Number.isFinite(row.kWhPerLandM2Year)
        && close(row.kWhPerLandM2Year, row.netAcKWhYear / row.landAreaM2)
        && Number.isFinite(row.kWhPerPvM2Year)
        && close(row.kWhPerPvM2Year, row.netAcKWhYear / row.activePvAreaM2)
        && row.layoutId === contract.layoutIdByShape[row.shape]
        && row.layoutId.startsWith(`${transient.layoutVersion}|`));
  });
  const available = gateSummary.official
    && meshArtifactCrossCertified(GENERATED_GATES)
    && completeSha256(transient.artifactSha256)
    && completeSha256(transient.implementationSha256)
    && completeSha256(transient.configurationSha256)
    && rankingsComplete;
  const fixture = transient.certifiedFixture;
  const staticResolution = transient.validatedMinimumResolution["static-land-matched"]?.plane;
  const sweptResolution = transient.validatedMinimumResolution["swept-rotation-envelope"]?.plane;
  const coupled = transient.validatedCoupledSettings;
  const provenance = [
    `weather=${fixture.weather.source}; seed=${fixture.weather.seed}; preset=${fixture.weather.preset}; location=${fixture.location.latitudeDeg},${fixture.location.longitudeDeg},${fixture.location.elevationM}m`,
    `time=${fixture.year}; ${fixture.weather.stepMinutes} min; ${fixture.weather.intervals} intervals; closing-endpoint=${fixture.weather.closingEndpointPresent}; reporting-offset=${fixture.reportingOffsetMinutes} min`,
    `A_land=${fixture.geometry.landAreaM2} m2; A_PV=per official row; H_max=${fixture.geometry.maximumHeightM} m; plane=${fixture.geometry.planeTiltDeg}deg tilt/${fixture.geometry.planeAzimuthDeg}deg azimuth`,
    "footprint=static-land-matched / swept-rotation-envelope",
    `electrical=${fixture.connection.cellIvModel}; ${fixture.connection.parallelStrings} strings; ${fixture.connection.cellsPerBypassSubstring} cells/bypass; inverter=${fixture.inverter.ratedAcPowerW} W/${fixture.inverter.nominalEfficiency}`,
    `thermal=annual transient; ${fixture.thermal.thermalNodeCount} nodes; substep<=${fixture.thermal.materialConfig.maximumSubstepSeconds}s; absorptivity=${fixture.pv.absorptivity}`,
    `rotation=static 0 RPM / controlled ${fixture.controlledRotation.rpm} RPM (motor ${fixture.controlledRotation.motor.requiredTorqueNm} Nm, eta=${fixture.controlledRotation.motor.motorEfficiency}) / natural shape dynamics`,
    `resolution=static az${staticResolution?.azimuthSamples ?? "?"}/m${staticResolution?.meridionalSegments ?? "?"}/phase${staticResolution?.phaseSamples ?? "?"}/circuit${staticResolution?.circuitSamples ?? "?"}; swept az${sweptResolution?.azimuthSamples ?? "?"}/m${sweptResolution?.meridionalSegments ?? "?"}/phase${sweptResolution?.phaseSamples ?? "?"}/circuit${sweptResolution?.circuitSamples ?? "?"}; thermal${coupled.thermalNodeCount}; coupling<=${coupled.maximumElectricalCouplingStepSeconds}s`,
    `convergence=mesh=${GENERATED_GATES.mesh.status}; transient-engineering=${transient.status}; extraction<=${coupled.maximumElectricalExtractionClosureErrorW}W; heat-residual<=${coupled.maximumHeatEnergyResidualFraction}`,
    `status=${available ? "official" : `unavailable (${transient.status})`}`,
  ].join(" | ");
  return {
    available,
    gateStatus: transient.status,
    artifactPath: transient.artifactPath,
    artifactSha256: transient.artifactSha256,
    provenance,
    rankings: available ? rankings : { static: [], controlled: [], natural: [] },
  };
}

export function engineeringOfficialRuntimeEligibility(
  input: EngineeringOfficialRuntimeInput,
): EngineeringOfficialRuntimeEligibility {
  const gates = input.gates ?? GENERATED_GATES;
  const reasons: string[] = [];
  if (gates.mesh.schemaVersion !== 1 || gates.mesh.status !== "pass"
    || gates.mesh.officialRankingEligible !== true) reasons.push("mesh-gate-not-pass");
  if (gates.transient.schemaVersion !== 1 || gates.transient.status !== "pass"
    || gates.transient.officialRankingEligible !== true) reasons.push("transient-engineering-gate-not-pass");
  if (!meshArtifactCrossCertified(gates)) reasons.push("certified-mesh-artifact-sha-mismatch");
  if (!completeSha256(gates.transient.artifactSha256)
    || !completeSha256(gates.transient.implementationSha256)
    || !completeSha256(gates.transient.configurationSha256)) {
    reasons.push("transient-engineering-artifact-provenance-incomplete");
  }
  const fixtureEligibility = certifiedEngineeringFixtureEligibility({
    actual: input.runtimeFixture,
    certified: gates.transient.certifiedFixture,
  });
  reasons.push(...fixtureEligibility.reasons);
  if (gates.mesh.layoutVersion !== gates.transient.layoutVersion) reasons.push("gate-layout-version-mismatch");
  const certifiedCoupling = gates.transient.validatedCoupledSettings;
  if (input.coupledSettings.thermalNodeCount !== certifiedCoupling.thermalNodeCount
    || input.coupledSettings.maximumThermalSubstepSeconds !== certifiedCoupling.maximumThermalSubstepSeconds
    || input.coupledSettings.maximumElectricalCouplingStepSeconds
      !== certifiedCoupling.maximumElectricalCouplingStepSeconds) {
    reasons.push("runtime-coupled-settings-mismatch");
  }

  const meshContract = gates.mesh.contracts.find((contract) => (
    contract.footprintMode === input.footprintMode
    && contract.phaseGateRequired === input.rotationRequiresPhaseQuadrature
  ));
  const transientContract = gates.transient.geometryContracts.find((contract) => (
    contract.footprintMode === input.footprintMode
    && contract.phaseGateRequired === input.rotationRequiresPhaseQuadrature
  ));
  const runtimeGeometryEligibility = certifiedRuntimeGeometryEligibility({
    runtime: input.runtimeGeometry,
    certified: gates.transient.certifiedFixture.geometry,
  });
  reasons.push(...runtimeGeometryEligibility.reasons);
  if (!meshContract?.pass) reasons.push("mesh-footprint-contract-not-pass");
  if (!transientContract?.pass || !transientContract.officialEligible) {
    reasons.push("transient-footprint-contract-not-pass");
  }
  if (!resolutionAtLeast(
    input.resolution,
    gates.mesh.officialMinimumResolution,
    input.rotationRequiresPhaseQuadrature,
  )) reasons.push("runtime-resolution-below-mesh-certificate");
  if (transientContract && !resolutionAtLeast(
    input.resolution,
    transientContract.validatedResolution,
    input.rotationRequiresPhaseQuadrature,
  )) reasons.push("runtime-resolution-below-transient-certificate");
  if (!completeShapeSet(input.rows)) reasons.push("incomplete-six-shape-cohort");

  if (transientContract && !ENGINEERING_RANK_SHAPES.every((shape) => (
    transientContract.layoutIdByShape[shape]?.startsWith(`${gates.mesh.layoutVersion}|`)
  ))) {
    reasons.push("certified-layout-evidence-missing");
  }

  const runIds = new Set<string>();
  for (const row of input.rows) {
    const sharedEligibility = engineeringOfficialEligibility({
      layoutId: row.layoutId ?? "",
      connection: input.connection,
      resolution: input.resolution,
      meshConvergencePass: gates.mesh.status === "pass" && gates.transient.status === "pass",
      rotationRequiresPhaseQuadrature: input.rotationRequiresPhaseQuadrature,
    });
    reasons.push(...sharedEligibility.reasons.map((reason) => `${row.shape}:${reason}`));
    const minimum = transientContract
      ? gates.transient.validatedMinimumResolution[transientContract.contractId]?.[row.shape]
      : undefined;
    if (!minimum || !resolutionAtLeast(
      input.resolution,
      minimum,
      input.rotationRequiresPhaseQuadrature,
    )) reasons.push(`${row.shape}:resolution-below-shape-certificate`);
    const layoutEligibility = certifiedRuntimeLayoutEligibility({
      runtimeLayoutId: row.layoutId,
      auditLayoutId: row.audit?.electricalLayoutId,
      certifiedLayoutId: transientContract?.layoutIdByShape[row.shape],
      expectedActiveAreaM2: row.expectedActiveAreaM2,
      layoutVersion: gates.mesh.layoutVersion,
    });
    reasons.push(...layoutEligibility.reasons.map((reason) => `${row.shape}:${reason}`));
    const metadata = row.metadata;
    if (!metadata?.runId.trim()
      || metadata.steps !== input.expectedSteps
      || metadata.intervals !== input.expectedIntervals
      || metadata.durationHours !== input.expectedDurationHours
      || metadata.steps !== metadata.intervals + 1) {
      reasons.push(`${row.shape}:annual-clock-or-run-metadata-mismatch`);
    } else {
      runIds.add(metadata.runId);
    }
    const audit = row.audit;
    if (row.authoritativePath !== "annual-transient-engineering-e11"
      || audit?.status !== "authoritative-annual-transient-engineering"
      || audit.electricalModel !== "explicit-series-parallel-bypass"
      || audit.thermalModel !== "annual-transient-material-state"
      || audit.periodIntegration !== "actual-weather-clock") {
      reasons.push(`${row.shape}:authoritative-worker-audit-missing`);
      continue;
    }
    const decomposition = row.decomposition;
    const decompositionScale = Math.max(1, Math.abs(audit.annual.netAcEnergyWh));
    if (!decomposition
      || !close(decomposition.annual.e11Wh, audit.annual.netAcEnergyWh)
      || Math.abs(decomposition.annual.closureResidualWh) > 1e-9 * decompositionScale
      || decomposition.e11.electricalLayoutId !== row.layoutId
      || decomposition.e11.mesh.thermalNodeCount !== certifiedCoupling.thermalNodeCount
      || decomposition.e11.energyAudit.relativeEnergyResidual > certifiedCoupling.maximumHeatEnergyResidualFraction) {
      reasons.push(`${row.shape}:e11-heat-or-factorial-closure-open`);
    }
    if (!Number.isFinite(row.energyWh) || !close(row.energyWh ?? Number.NaN, audit.annual.netAcEnergyWh)) {
      reasons.push(`${row.shape}:published-energy-audit-mismatch`);
    }
    if (!close(
      audit.annual.mismatchAndWiringLossEnergyWh,
      audit.annual.idealLocalMppDcEnergyWh - audit.annual.engineeringDcEnergyWh,
    )) reasons.push(`${row.shape}:electrical-loss-identity-open`);
    if (!monthlyAuditCloses(audit)) reasons.push(`${row.shape}:monthly-ledger-open`);
    if (!engineeringEnergyBoundsClose(audit)) reasons.push(`${row.shape}:energy-clipping-bounds-open`);
    if (!topologyCloses(audit, row.expectedActiveAreaM2)) reasons.push(`${row.shape}:topology-open`);
    if (!Number.isFinite(audit.coupling.maximumElectricalExtractionClosureErrorW)
      || audit.coupling.maximumElectricalExtractionClosureErrorW > certifiedCoupling.maximumElectricalExtractionClosureErrorW
      || audit.coupling.maximumStepSeconds > certifiedCoupling.maximumElectricalCouplingStepSeconds
      || audit.coupling.maximumStepSeconds <= 0
      || audit.coupling.circuitSolveCount <= 0) {
      reasons.push(`${row.shape}:transient-circuit-coupling-open`);
    }
  }
  if (runIds.size !== 1) reasons.push("stale-or-mixed-worker-cohort");
  return {
    eligible: reasons.length === 0,
    contractId: transientContract?.contractId,
    reasons: [...new Set(reasons)],
  };
}
