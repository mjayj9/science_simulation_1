import {
  calculateCircuit,
  interpolateCurrentAtVoltage,
  interpolateVoltageAtCurrent,
  seriesVoltageAtCurrent,
  type CircuitDevice,
  type CircuitResult,
} from "./circuit";
import {
  DEFAULT_ELECTRICAL,
  singleDiodeCurve,
  type ElectricalConfig,
  type IVCurve,
  type IVPoint,
} from "./electrical";
import { PANEL_AREA_M2 } from "../geometry/types";
import { clamp } from "./types";

export type EngineeringCellIvModel = "piecewise-nameplate" | "single-diode";

/**
 * Stable manufacturing order for one gap-free PV skin. The address is a
 * material-space coordinate and therefore does not change when the worker
 * rotates the world-space position/normal.
 */
export const ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION =
  "surface-spatial-uniform-cell-grid-v3" as const;

/** Shared production topology; numerical solver resolution is separate. */
export const OFFICIAL_ENGINEERING_SURFACE_CONNECTION = Object.freeze({
  nominalCellAreaM2: PANEL_AREA_M2,
  parallelStrings: 2,
  cellsPerBypassSubstring: 10,
  bypassForwardVoltageV: 0.5,
  stringWiringResistanceOhm: 0.01,
  arrayWiringResistanceOhm: 0.005,
  cellIvModel: "piecewise-nameplate" as const,
});

export const ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION = Object.freeze({
  azimuthSamples: 32,
  meridionalSegments: 16,
  /**
   * Rotation phase is integrated with the midpoint rule over a full turn, so
   * the sample spacing must resolve the shape's own rotational symmetry. The
   * cube repeats every quarter turn: 4 samples land one full period apart and
   * alias onto a single orientation, and 8 gives only two points per period.
   * The measured refinement sequence is 3.059% (4->8), 1.100% (8->16), 0.092%
   * (16->32) and 0.032% (32->64), so 16 is the first resolution where the
   * rotating cube is actually resolved. This was previously masked: the
   * superseded sliver-cell layout added a large phase-independent loss that
   * dominated the ratio and made 4 and 8 look converged.
   */
  phaseSamples: 16,
  circuitSamples: 256,
});

export interface EngineeringNumericalResolution {
  azimuthSamples: number;
  meridionalSegments: number;
  phaseSamples: number;
  circuitSamples: number;
}

export interface EngineeringOfficialEligibilityInput {
  layoutId: string;
  connection: EngineeringSurfaceConnectionConfig;
  resolution: EngineeringNumericalResolution;
  meshConvergencePass: boolean;
  /** Static cases do not need rotation-phase quadrature. */
  rotationRequiresPhaseQuadrature: boolean;
}

export interface EngineeringOfficialEligibility {
  eligible: boolean;
  reasons: readonly string[];
}

export interface EngineeringSurfaceSpatialAddress {
  zoneId: string;
  zoneIndex: number;
  /** First material coordinate (meridional/vertical cumulative-area axis). */
  u: number;
  /** Second material coordinate (azimuthal/horizontal axis). */
  v: number;
  /** Unrotated material point, used only as a deterministic tie-breaker. */
  positionM: { x: number; y: number; z: number };
}

export interface EngineeringSurfaceLayoutSample extends EngineeringSurfaceSpatialAddress {
  id?: string;
  areaM2: number;
}

export interface EngineeringSurfaceElectricalSample extends EngineeringSurfaceLayoutSample {
  id: string;
  poaWm2: number;
  cellTemperatureC: number;
}

export interface EngineeringSurfaceConnectionConfig {
  /**
   * Nominal manufactured cell area, treated as an upper bound. A zone whose
   * area is not an exact multiple is tiled with uniformly smaller cells rather
   * than nominal cells plus one sliver, so no cell throttles its series string.
   */
  nominalCellAreaM2?: number;
  parallelStrings?: number;
  cellsPerBypassSubstring?: number;
  bypassForwardVoltageV?: number;
  stringWiringResistanceOhm?: number;
  arrayWiringResistanceOhm?: number;
  cellIvModel?: EngineeringCellIvModel;
  cellCurveSamples?: number;
  circuitSamples?: number;
}

export interface EngineeringSurfaceCellDefinition {
  id: string;
  zoneId: string;
  zoneIndex: number;
  zoneCellIndex: number;
  rowIndex: number;
  columnIndex: number;
  areaM2: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  stringIndex: number;
  stringId: string;
  substringIndex: number;
  substringId: string;
  trimmedBelowNominal: boolean;
}

export interface EngineeringSurfaceCellRow {
  rowIndex: number;
  uMin: number;
  uMax: number;
  cellIndices: readonly number[];
}

export interface EngineeringSurfaceZoneLayout {
  zoneId: string;
  zoneIndex: number;
  areaM2: number;
  uMin: number;
  uMax: number;
  rows: readonly EngineeringSurfaceCellRow[];
  cellIndices: readonly number[];
}

export interface EngineeringSurfaceSampleCellOverlap {
  cellIndex: number;
  areaM2: number;
}

export interface EngineeringSurfaceSampleProjection {
  spatialKey: string;
  sampleAreaM2: number;
  overlaps: readonly EngineeringSurfaceSampleCellOverlap[];
}

export interface EngineeringSurfaceCellLayout {
  version: typeof ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION;
  layoutId: string;
  coordinateMode: "zone-local-u" | "global-area-u";
  activeAreaM2: number;
  nominalCellAreaM2: number;
  parallelStringCount: number;
  cellsPerBypassSubstring: number;
  cells: readonly EngineeringSurfaceCellDefinition[];
  zones: readonly EngineeringSurfaceZoneLayout[];
  seriesCellCountByString: readonly number[];
  bypassSubstringCount: number;
  /**
   * Cells tiled below the nominal manufactured area because their zone is not
   * an exact multiple of it. Uniform within a zone, so this is provenance about
   * cell sizing, not a mismatch source.
   */
  trimmedCellCount: number;
  trimmedCellAreaM2: number;
  sampleProjectionFingerprint: string;
  sampleProjectionCount: number;
  sampleProjectionBySpatialKey: Readonly<Record<string, EngineeringSurfaceSampleProjection>>;
}

export interface EngineeringCellOperatingResult {
  id: string;
  zoneId: string;
  zoneIndex: number;
  areaM2: number;
  stringId: string;
  substringId: string;
  poaWm2: number;
  cellTemperatureC: number;
  operatingCurrentA: number;
  operatingVoltageV: number;
  rawElectricalExtractionW: number;
  terminalElectricalExtractionW: number;
  bypassConducting: boolean;
}

export interface EngineeringStringResult {
  id: string;
  cellCount: number;
  bypassSubstringCount: number;
  operatingCurrentA: number;
  bypassActiveCount: number;
  standaloneMppPowerW: number;
}

export interface EngineeringSurfaceElectricalResult {
  connectionModel: "explicit-series-parallel-bypass";
  /** Deterministic material-space cell/string/bypass layout contract. */
  layoutId: string;
  cellIvModel: EngineeringCellIvModel;
  dcPowerW: number;
  dcVoltageV: number;
  dcCurrentA: number;
  idealLocalMppDcPowerW: number;
  mismatchAndWiringLossW: number;
  mismatchAndWiringLossFraction: number;
  bypassActiveCount: number;
  activeAreaM2: number;
  nominalCellAreaM2: number;
  nominalCellDensityPerM2: number;
  cellCount: number;
  trimmedCellAreaM2: number;
  parallelStringCount: number;
  seriesCellCountByString: readonly number[];
  bypassSubstringCount: number;
  trimmedCellCount: number;
  strings: readonly EngineeringStringResult[];
  cells: readonly EngineeringCellOperatingResult[];
  /** Conservative terminal-DC allocation to the caller's optical sample IDs. */
  electricalExtractionWBySampleId: Readonly<Record<string, number>>;
}

export interface AggregatedCellCondition {
  id: string;
  areaM2: number;
  poaWm2: number;
  cellTemperatureC: number;
  definition: EngineeringSurfaceCellDefinition;
  sourceWeights: readonly {
    sampleId: string;
    areaWeight: number;
    poaWm2: number;
    cellTemperatureC: number;
  }[];
}

interface StringNetwork {
  id: string;
  cells: readonly CircuitDevice[];
  substrings: readonly CircuitDevice[];
  result: CircuitResult;
  definitions: readonly EngineeringSurfaceCellDefinition[];
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`);
  return value;
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative and finite.`);
  return value;
}

function integerInRange(value: number, lower: number, upper: number, label: string): number {
  if (!Number.isInteger(value) || value < lower || value > upper) {
    throw new RangeError(`${label} must be an integer in [${lower}, ${upper}].`);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateSpatialAddress(sample: EngineeringSurfaceSpatialAddress, index: number): void {
  if (!sample.zoneId.trim() || sample.zoneId.length > 100) {
    throw new RangeError(`Sample ${index} zoneId must be non-empty and at most 100 characters.`);
  }
  if (!Number.isInteger(sample.zoneIndex) || sample.zoneIndex < 0) {
    throw new RangeError(`Sample ${index} zoneIndex must be a non-negative integer.`);
  }
  for (const coordinate of ["u", "v"] as const) {
    const value = sample[coordinate];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`Sample ${index} ${coordinate} must be finite and in [0, 1].`);
    }
  }
  for (const coordinate of ["x", "y", "z"] as const) {
    if (!Number.isFinite(sample.positionM[coordinate])) {
      throw new RangeError(`Sample ${index} positionM.${coordinate} must be finite.`);
    }
  }
}

/** Total ordering independent of quadrature-array insertion order. */
export function compareEngineeringSurfaceSpatialAddress(
  left: EngineeringSurfaceSpatialAddress,
  right: EngineeringSurfaceSpatialAddress,
): number {
  return compareNumber(left.zoneIndex, right.zoneIndex) ||
    compareText(left.zoneId, right.zoneId) ||
    compareNumber(left.u, right.u) ||
    compareNumber(left.v, right.v) ||
    compareNumber(left.positionM.x, right.positionM.x) ||
    compareNumber(left.positionM.y, right.positionM.y) ||
    compareNumber(left.positionM.z, right.positionM.z);
}

/** Human-readable key used for stable cell provenance and diagnostics. */
export function engineeringSurfaceSpatialKey(sample: EngineeringSurfaceSpatialAddress): string {
  return [
    `zone=${sample.zoneIndex}:${encodeURIComponent(sample.zoneId)}`,
    `u=${sample.u.toPrecision(17)}`,
    `v=${sample.v.toPrecision(17)}`,
    `p=${sample.positionM.x.toPrecision(17)},${sample.positionM.y.toPrecision(17)},${sample.positionM.z.toPrecision(17)}`,
  ].join("|");
}

/** Stable optical-address key: world/body pose changes cannot move a cell. */
export function engineeringSurfaceProjectionKey(sample: EngineeringSurfaceSpatialAddress): string {
  return [
    `zone=${sample.zoneIndex}:${encodeURIComponent(sample.zoneId)}`,
    `u=${sample.u.toPrecision(17)}`,
    `v=${sample.v.toPrecision(17)}`,
  ].join("|");
}

/**
 * Validates and returns material-space row-major order. Already ordered input
 * is reused, avoiding an annual O(n log n) sort at every weather step.
 */
export function orderEngineeringSurfaceLayoutSamples<T extends EngineeringSurfaceLayoutSample>(
  samples: readonly T[],
): readonly T[] {
  if (samples.length === 0) throw new RangeError("At least one surface sample is required.");
  let alreadyOrdered = true;
  samples.forEach((sample, index) => {
    validateSpatialAddress(sample, index);
    positiveFinite(sample.areaM2, `Sample ${index} area`);
    if (index > 0 && compareEngineeringSurfaceSpatialAddress(samples[index - 1], sample) > 0) {
      alreadyOrdered = false;
    }
  });
  return alreadyOrdered
    ? samples
    : [...samples].sort((left, right) =>
        compareEngineeringSurfaceSpatialAddress(left, right) || compareText(
          left.id ?? "",
          right.id ?? "",
        ));
}

function canonicalLayoutNumber(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

function canonicalLayoutValue(value: number): number {
  return Number(value.toPrecision(12));
}

interface ResolvedEngineeringSurfaceConnection {
  nominalCellAreaM2: number;
  parallelStrings: number;
  cellsPerBypassSubstring: number;
  bypassForwardVoltageV: number;
  stringWiringResistanceOhm: number;
  arrayWiringResistanceOhm: number;
  cellIvModel: EngineeringCellIvModel;
}

function resolvedConnection(config: EngineeringSurfaceConnectionConfig): ResolvedEngineeringSurfaceConnection {
  return {
    nominalCellAreaM2: config.nominalCellAreaM2 ?? OFFICIAL_ENGINEERING_SURFACE_CONNECTION.nominalCellAreaM2,
    parallelStrings: Math.round(config.parallelStrings ?? OFFICIAL_ENGINEERING_SURFACE_CONNECTION.parallelStrings),
    cellsPerBypassSubstring: Math.round(
      config.cellsPerBypassSubstring ?? OFFICIAL_ENGINEERING_SURFACE_CONNECTION.cellsPerBypassSubstring,
    ),
    bypassForwardVoltageV: config.bypassForwardVoltageV ?? OFFICIAL_ENGINEERING_SURFACE_CONNECTION.bypassForwardVoltageV,
    stringWiringResistanceOhm: config.stringWiringResistanceOhm
      ?? OFFICIAL_ENGINEERING_SURFACE_CONNECTION.stringWiringResistanceOhm,
    arrayWiringResistanceOhm: config.arrayWiringResistanceOhm
      ?? OFFICIAL_ENGINEERING_SURFACE_CONNECTION.arrayWiringResistanceOhm,
    cellIvModel: config.cellIvModel ?? OFFICIAL_ENGINEERING_SURFACE_CONNECTION.cellIvModel,
  };
}

export function engineeringOfficialEligibility(
  input: EngineeringOfficialEligibilityInput,
): EngineeringOfficialEligibility {
  const reasons: string[] = [];
  const actual = resolvedConnection(input.connection);
  const expected = OFFICIAL_ENGINEERING_SURFACE_CONNECTION;
  if (!input.layoutId.startsWith(`${ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION}|`)) {
    reasons.push("unvalidated-layout-version");
  }
  for (const key of [
    "nominalCellAreaM2",
    "parallelStrings",
    "cellsPerBypassSubstring",
    "bypassForwardVoltageV",
    "stringWiringResistanceOhm",
    "arrayWiringResistanceOhm",
    "cellIvModel",
  ] as const) {
    if (actual[key] !== expected[key]) reasons.push(`non-production-topology:${key}`);
  }
  const minimum = ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION;
  if (input.resolution.azimuthSamples < minimum.azimuthSamples) reasons.push("azimuth-resolution-below-validated-minimum");
  if (input.resolution.meridionalSegments < minimum.meridionalSegments) reasons.push("meridional-resolution-below-validated-minimum");
  if (input.resolution.circuitSamples < minimum.circuitSamples) reasons.push("circuit-resolution-below-validated-minimum");
  if (input.rotationRequiresPhaseQuadrature && input.resolution.phaseSamples < minimum.phaseSamples) {
    reasons.push("rotation-phase-resolution-below-validated-minimum");
  }
  if (!input.meshConvergencePass) reasons.push("mesh-convergence-gate-failed");
  return { eligible: reasons.length === 0, reasons };
}

interface ZoneSourceSummary {
  zoneId: string;
  zoneIndex: number;
  areaM2: number;
  samples: readonly EngineeringSurfaceLayoutSample[];
}

function zoneKey(zoneIndex: number, zoneId: string): string {
  return `${zoneIndex}:${zoneId}`;
}

function summarizeZones(samples: readonly EngineeringSurfaceLayoutSample[]): ZoneSourceSummary[] {
  const ordered = orderEngineeringSurfaceLayoutSamples(samples);
  const byZone = new Map<string, { zoneId: string; zoneIndex: number; areaM2: number; samples: EngineeringSurfaceLayoutSample[] }>();
  for (const sample of ordered) {
    const key = zoneKey(sample.zoneIndex, sample.zoneId);
    const zone = byZone.get(key) ?? {
      zoneId: sample.zoneId,
      zoneIndex: sample.zoneIndex,
      areaM2: 0,
      samples: [],
    };
    zone.areaM2 += sample.areaM2;
    zone.samples.push(sample);
    byZone.set(key, zone);
  }
  const zones = [...byZone.values()].sort((left, right) =>
    compareNumber(left.zoneIndex, right.zoneIndex) || compareText(left.zoneId, right.zoneId));
  const seenIndices = new Set<number>();
  for (const zone of zones) {
    if (seenIndices.has(zone.zoneIndex)) throw new RangeError(`zoneIndex ${zone.zoneIndex} is not unique.`);
    seenIndices.add(zone.zoneIndex);
    zone.areaM2 = canonicalLayoutValue(zone.areaM2);
  }
  return zones;
}

function usesGlobalAreaU(zones: readonly ZoneSourceSummary[], activeAreaM2: number): boolean {
  if (zones.length < 2) return false;
  let prefixAreaM2 = 0;
  let witnessedNonzeroStart = false;
  for (const zone of zones) {
    const lower = prefixAreaM2 / activeAreaM2;
    const upper = (prefixAreaM2 + zone.areaM2) / activeAreaM2;
    const tolerance = 1e-8;
    if (lower > tolerance) witnessedNonzeroStart = true;
    if (zone.samples.some((sample) => sample.u < lower - tolerance || sample.u > upper + tolerance)) return false;
    prefixAreaM2 += zone.areaM2;
  }
  return witnessedNonzeroStart;
}

/**
 * Divides one surface zone into uniform series cells.
 *
 * The zone area is almost never an exact multiple of the manufactured cell
 * area, and how that remainder is absorbed is a physical wiring decision, not a
 * rounding detail. The superseded layout emitted `floor(ratio)` nominal cells
 * plus a single sliver holding the remainder. Because cells inside a bypass
 * substring are wired in series with no per-cell diode, a sliver's photocurrent
 * — proportional to its area — throttled its entire substring. Under perfectly
 * uniform illumination, where the only real loss is wiring resistance (~0.3%),
 * that produced 10-22% losses for exactly the shapes whose area is not an
 * integer multiple of the cell: plane and cone were penalised while cube,
 * sphere, hemisphere and cylinder were not. Those exact multiples are an
 * artifact of A_land=0.05 m² meeting analytic areas like 4*pi*r^2, so the
 * penalty tracked arithmetic coincidence rather than geometry — an unintended
 * per-shape multiplier of the kind the comparison contract forbids.
 *
 * Uniform division is also what manufacturing does: a cell can be cut smaller
 * to tile a surface, never larger. `ceil` therefore keeps every cell at or
 * below the nominal area.
 *
 * The count is then raised to a multiple of the parallel string count. Cells
 * are partitioned into strings contiguously, so an odd total produced strings
 * of unequal series length — 8 and 7 cells for the swept plane, 23 and 22 for
 * the cone. Unequal series length means unequal string voltage, and forcing
 * those onto one bus is a real mismatch loss: 6.9% for the swept plane under
 * uniform illumination. That penalty tracked the parity of the cell count, not
 * the shape's optics, so it was the same class of arithmetic artifact as the
 * sliver. Choosing a per-face cell count that divides evenly into the strings
 * is an ordinary wiring decision and removes it.
 */
function cellAreasForZone(
  zoneAreaM2: number,
  nominalCellAreaM2: number,
  parallelStrings: number,
): number[] {
  const ratio = zoneAreaM2 / nominalCellAreaM2;
  const nearest = Math.round(ratio);
  const snapped = Math.abs(ratio - nearest) <= 1e-9;
  const minimumCount = Math.max(1, snapped ? nearest : Math.ceil(ratio));
  const strings = Math.max(1, Math.round(parallelStrings));
  const cellCount = Math.ceil(minimumCount / strings) * strings;
  const uniformAreaM2 = zoneAreaM2 / cellCount;
  const areas = Array.from({ length: cellCount }, () => uniformAreaM2);
  // Absorb float division residue so Sigma(areas) is exactly the zone area.
  const correction = zoneAreaM2 - areas.reduce((sum, area) => sum + area, 0);
  areas[areas.length - 1] += correction;
  return areas;
}

/**
 * Builds physical cell rectangles before any optical solve. Cells never cross
 * a chart/face boundary and are uniform within a zone, so exact active area is
 * conserved without any cell becoming a series current bottleneck. The topology
 * depends only on material area and config.
 */
export function createEngineeringSurfaceCellLayout(
  samples: readonly EngineeringSurfaceLayoutSample[],
  config: EngineeringSurfaceConnectionConfig = {},
  referenceNominalCellAreaM2 = DEFAULT_ELECTRICAL.areaM2,
): EngineeringSurfaceCellLayout {
  const zones = summarizeZones(samples);
  const activeAreaM2 = canonicalLayoutValue(zones.reduce((sum, zone) => sum + zone.areaM2, 0));
  const nominalCellAreaM2 = positiveFinite(
    config.nominalCellAreaM2 ?? referenceNominalCellAreaM2,
    "Nominal cell area",
  );
  // Resolved before cells exist because each zone's cell count must divide
  // evenly into the strings; the count is clamped to the cells actually built.
  const requestedParallelStrings = Math.max(1, Math.round(config.parallelStrings ?? 2));
  const coordinateMode = usesGlobalAreaU(zones, activeAreaM2) ? "global-area-u" : "zone-local-u";
  const cells: EngineeringSurfaceCellDefinition[] = [];
  const zoneLayouts: EngineeringSurfaceZoneLayout[] = [];
  let prefixAreaM2 = 0;

  for (const zone of zones) {
    const cellAreas = cellAreasForZone(zone.areaM2, nominalCellAreaM2, requestedParallelStrings);
    const rowCount = Math.min(cellAreas.length, Math.max(1, Math.round(Math.sqrt(cellAreas.length))));
    const areaRows = partitionContiguous(cellAreas, rowCount);
    const zoneUMin = coordinateMode === "global-area-u" ? prefixAreaM2 / activeAreaM2 : 0;
    const zoneUMax = coordinateMode === "global-area-u"
      ? (prefixAreaM2 + zone.areaM2) / activeAreaM2
      : 1;
    const zoneUSpan = zoneUMax - zoneUMin;
    const cellIndices: number[] = [];
    const rows: EngineeringSurfaceCellRow[] = [];
    let areaBeforeRowM2 = 0;
    let zoneCellIndex = 0;
    for (const [rowIndex, rowAreas] of areaRows.entries()) {
      const rowAreaM2 = rowAreas.reduce((sum, area) => sum + area, 0);
      const uMin = zoneUMin + zoneUSpan * areaBeforeRowM2 / zone.areaM2;
      const uMax = rowIndex === areaRows.length - 1
        ? zoneUMax
        : zoneUMin + zoneUSpan * (areaBeforeRowM2 + rowAreaM2) / zone.areaM2;
      const rowCellIndices: number[] = [];
      let areaBeforeCellM2 = 0;
      for (const [columnIndex, areaM2] of rowAreas.entries()) {
        const vMin = areaBeforeCellM2 / rowAreaM2;
        const vMax = columnIndex === rowAreas.length - 1 ? 1 : (areaBeforeCellM2 + areaM2) / rowAreaM2;
        const index = cells.length;
        cells.push({
          id: `cell:${zone.zoneIndex}:${encodeURIComponent(zone.zoneId)}:${zoneCellIndex + 1}`,
          zoneId: zone.zoneId,
          zoneIndex: zone.zoneIndex,
          zoneCellIndex,
          rowIndex,
          columnIndex,
          areaM2,
          uMin,
          uMax,
          vMin,
          vMax,
          stringIndex: -1,
          stringId: "",
          substringIndex: -1,
          substringId: "",
          trimmedBelowNominal: areaM2 < nominalCellAreaM2 - Math.max(1e-14, nominalCellAreaM2 * 1e-10),
        });
        cellIndices.push(index);
        rowCellIndices.push(index);
        zoneCellIndex += 1;
        areaBeforeCellM2 += areaM2;
      }
      rows.push({ rowIndex, uMin, uMax, cellIndices: rowCellIndices });
      areaBeforeRowM2 += rowAreaM2;
    }
    zoneLayouts.push({
      zoneId: zone.zoneId,
      zoneIndex: zone.zoneIndex,
      areaM2: zone.areaM2,
      uMin: zoneUMin,
      uMax: zoneUMax,
      rows,
      cellIndices,
    });
    prefixAreaM2 += zone.areaM2;
  }

  const parallelStringCount = integerInRange(
    Math.min(requestedParallelStrings, cells.length),
    1,
    cells.length,
    "Parallel string count",
  );
  const cellsPerBypassSubstring = integerInRange(
    Math.round(config.cellsPerBypassSubstring ?? 10),
    1,
    10_000,
    "Cells per bypass substring",
  );
  const stringGroups = partitionContiguous(cells, parallelStringCount);
  let bypassSubstringCount = 0;
  for (const [stringIndex, stringCells] of stringGroups.entries()) {
    const stringId = `string-${stringIndex + 1}`;
    for (const [cellIndex, cell] of stringCells.entries()) {
      const substringIndex = Math.floor(cellIndex / cellsPerBypassSubstring);
      cell.stringIndex = stringIndex;
      cell.stringId = stringId;
      cell.substringIndex = substringIndex;
      cell.substringId = `${stringId}:substring-${substringIndex + 1}`;
    }
    bypassSubstringCount += Math.ceil(stringCells.length / cellsPerBypassSubstring);
  }
  const trimmedCells = cells.filter((cell) => cell.trimmedBelowNominal);
  const zoneContract = zoneLayouts.map((zone) => [
    `${zone.zoneIndex}:${encodeURIComponent(zone.zoneId)}`,
    canonicalLayoutNumber(zone.areaM2),
    zone.cellIndices.length,
    zone.rows.length,
    canonicalLayoutNumber(zone.uMin),
    canonicalLayoutNumber(zone.uMax),
  ].join(":" )).join(",");
  const sampleProjection = createSparseSampleProjection(
    samples,
    cells,
    zoneLayouts,
    activeAreaM2,
  );
  const layoutId = [
    ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
    `coordinate=${coordinateMode}`,
    `zones=${zoneContract}`,
    `activeAreaM2=${canonicalLayoutNumber(activeAreaM2)}`,
    `nominalCellAreaM2=${canonicalLayoutNumber(nominalCellAreaM2)}`,
    `cells=${cells.length}`,
    `parallel=${parallelStringCount}`,
    `bypass=${cellsPerBypassSubstring}`,
  ].join("|");
  return {
    version: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
    layoutId,
    coordinateMode,
    activeAreaM2,
    nominalCellAreaM2,
    parallelStringCount,
    cellsPerBypassSubstring,
    cells,
    zones: zoneLayouts,
    seriesCellCountByString: stringGroups.map((group) => group.length),
    bypassSubstringCount,
    trimmedCellCount: trimmedCells.length,
    trimmedCellAreaM2: trimmedCells.reduce((sum, cell) => sum + cell.areaM2, 0),
    sampleProjectionFingerprint: sampleProjection.fingerprint,
    sampleProjectionCount: sampleProjection.count,
    sampleProjectionBySpatialKey: sampleProjection.bySpatialKey,
  };
}

/**
 * Identifies the manufacturing topology, independently of optical quadrature
 * refinement. Shape-specific zone IDs distinguish the surface chart, while
 * active area and cell topology make boundary-cell behavior explicit.
 */
export function engineeringSurfaceLayoutId(
  samples: readonly EngineeringSurfaceLayoutSample[],
  config: EngineeringSurfaceConnectionConfig = {},
  referenceNominalCellAreaM2 = DEFAULT_ELECTRICAL.areaM2,
): string {
  return createEngineeringSurfaceCellLayout(samples, config, referenceNominalCellAreaM2).layoutId;
}

interface SampleSupport<T extends EngineeringSurfaceLayoutSample> {
  sample: T;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

function precisionKey(value: number): string {
  return value.toPrecision(15);
}

function midpointSupports(values: readonly number[], lower: number, upper: number): Map<string, [number, number]> {
  const result = new Map<string, [number, number]>();
  values.forEach((value, index) => result.set(precisionKey(value), [
    index === 0 ? lower : (values[index - 1] + value) / 2,
    index === values.length - 1 ? upper : (value + values[index + 1]) / 2,
  ]));
  return result;
}

function gaussPairSupports(values: readonly number[], lower: number, upper: number): Map<string, [number, number]> | null {
  if (values.length < 2 || values.length % 2 !== 0) return null;
  const gl2 = 1 / Math.sqrt(3);
  const result = new Map<string, [number, number]>();
  let previousUpper = lower;
  for (let index = 0; index < values.length; index += 2) {
    const leftNode = values[index];
    const rightNode = values[index + 1];
    const width = (rightNode - leftNode) / gl2;
    const midpoint = (leftNode + rightNode) / 2;
    const segmentLower = midpoint - width / 2;
    const segmentUpper = midpoint + width / 2;
    const tolerance = Math.max(1e-10, Math.abs(upper - lower) * 1e-8);
    if (!(width > 0) || Math.abs(segmentLower - previousUpper) > tolerance) return null;
    if (index === values.length - 2 && Math.abs(segmentUpper - upper) > tolerance) return null;
    result.set(precisionKey(leftNode), [segmentLower, midpoint]);
    result.set(precisionKey(rightNode), [midpoint, segmentUpper]);
    previousUpper = segmentUpper;
  }
  return result;
}

function sampleSupports<T extends EngineeringSurfaceLayoutSample>(
  samples: readonly T[],
  zones: readonly EngineeringSurfaceZoneLayout[],
): SampleSupport<T>[] {
  const supports: SampleSupport<T>[] = [];
  const byZone = new Map<string, T[]>();
  for (const sample of samples) {
    const key = zoneKey(sample.zoneIndex, sample.zoneId);
    const group = byZone.get(key) ?? [];
    group.push(sample);
    byZone.set(key, group);
  }
  for (const zone of zones) {
    const group = byZone.get(zoneKey(zone.zoneIndex, zone.zoneId));
    if (!group?.length) throw new RangeError(`No optical samples cover zone ${zone.zoneId}.`);
    const uValues = [...new Set(group.map((sample) => sample.u))].sort(compareNumber);
    const vValues = [...new Set(group.map((sample) => sample.v))].sort(compareNumber);
    const uSupports = gaussPairSupports(uValues, zone.uMin, zone.uMax)
      ?? midpointSupports(uValues, zone.uMin, zone.uMax);
    const vSupports = midpointSupports(vValues, 0, 1);
    for (const sample of group) {
      const u = uSupports.get(precisionKey(sample.u));
      const v = vSupports.get(precisionKey(sample.v));
      if (!u || !v) throw new Error("Unable to construct optical quadrature support.");
      supports.push({ sample, uMin: u[0], uMax: u[1], vMin: v[0], vMax: v[1] });
    }
  }
  return supports;
}

function overlapLength(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createSparseSampleProjection(
  samples: readonly EngineeringSurfaceLayoutSample[],
  cells: readonly EngineeringSurfaceCellDefinition[],
  zones: readonly EngineeringSurfaceZoneLayout[],
  activeAreaM2: number,
): {
  fingerprint: string;
  count: number;
  bySpatialKey: Readonly<Record<string, EngineeringSurfaceSampleProjection>>;
} {
  const orderedSamples = orderEngineeringSurfaceLayoutSamples(samples);
  const bySpatialKey: Record<string, EngineeringSurfaceSampleProjection> = Object.create(null);
  const cellAreaM2 = Array(cells.length).fill(0) as number[];
  const fingerprintRows: string[] = [];
  let projectedAreaM2 = 0;
  for (const support of sampleSupports(orderedSamples, zones)) {
    const spatialKey = engineeringSurfaceProjectionKey(support.sample);
    if (bySpatialKey[spatialKey] !== undefined) {
      throw new RangeError(`Duplicate optical material address ${spatialKey}.`);
    }
    const supportArea = (support.uMax - support.uMin) * (support.vMax - support.vMin);
    if (!(supportArea > 0)) throw new Error("Optical support area must be positive.");
    const overlaps: EngineeringSurfaceSampleCellOverlap[] = [];
    let fractionSum = 0;
    for (const [cellIndex, cell] of cells.entries()) {
      if (cell.zoneIndex !== support.sample.zoneIndex || cell.zoneId !== support.sample.zoneId) continue;
      const overlapU = overlapLength(support.uMin, support.uMax, cell.uMin, cell.uMax);
      const overlapV = overlapLength(support.vMin, support.vMax, cell.vMin, cell.vMax);
      if (!(overlapU > 0 && overlapV > 0)) continue;
      const fraction = overlapU * overlapV / supportArea;
      const areaM2 = support.sample.areaM2 * fraction;
      overlaps.push({ cellIndex, areaM2 });
      cellAreaM2[cellIndex] += areaM2;
      fractionSum += fraction;
      projectedAreaM2 += areaM2;
    }
    if (Math.abs(fractionSum - 1) > 1e-9) {
      throw new Error(`Optical support clipping did not close for ${spatialKey}.`);
    }
    const projection = { spatialKey, sampleAreaM2: support.sample.areaM2, overlaps };
    bySpatialKey[spatialKey] = projection;
    fingerprintRows.push([
      spatialKey,
      canonicalLayoutNumber(support.sample.areaM2),
      overlaps.map((overlap) => `${overlap.cellIndex}:${canonicalLayoutNumber(overlap.areaM2)}`).join(","),
    ].join("|"));
  }
  if (Math.abs(projectedAreaM2 - activeAreaM2) > Math.max(1e-10, activeAreaM2 * 1e-8)) {
    throw new Error("Sparse optical projection does not close to A_PV.");
  }
  cells.forEach((cell, index) => {
    if (Math.abs(cellAreaM2[index] - cell.areaM2) > Math.max(1e-10, cell.areaM2 * 1e-7)) {
      throw new Error(`Sparse projection area for ${cell.id} does not match its physical area.`);
    }
  });
  fingerprintRows.sort(compareText);
  const fingerprintPayload = fingerprintRows.join("\n");
  return {
    fingerprint: `surface-sample-projection-v1:${fingerprintRows.length}:${fnv1a32(fingerprintPayload)}`,
    count: fingerprintRows.length,
    bySpatialKey,
  };
}

/**
 * Integrates an independent optical quadrature over immutable physical cell
 * rectangles. Exact support clipping, rather than point ownership, prevents
 * optical refinement from moving cell boundaries or crossing surface zones.
 */
export function aggregateSurfaceSamplesIntoCells(
  samples: readonly EngineeringSurfaceElectricalSample[],
  nominalCellAreaM2: number,
  prebuiltLayout?: EngineeringSurfaceCellLayout,
): AggregatedCellCondition[] {
  positiveFinite(nominalCellAreaM2, "Nominal cell area");
  const orderedSamples = orderEngineeringSurfaceLayoutSamples(samples);
  const layout = prebuiltLayout ?? createEngineeringSurfaceCellLayout(
    orderedSamples,
    { nominalCellAreaM2 },
    nominalCellAreaM2,
  );
  if (Math.abs(layout.nominalCellAreaM2 - nominalCellAreaM2) > Math.max(1e-14, nominalCellAreaM2 * 1e-10)) {
    throw new RangeError("Prebuilt layout nominal cell area does not match the solver config.");
  }
  const sampleIds = new Set<string>();
  for (const [index, sample] of orderedSamples.entries()) {
    if (sampleIds.has(sample.id)) throw new RangeError(`Sample ${index} id must be unique.`);
    sampleIds.add(sample.id);
    nonNegativeFinite(sample.poaWm2, `Sample ${index} POA`);
    if (!Number.isFinite(sample.cellTemperatureC)) {
      throw new RangeError(`Sample ${index} temperature must be finite.`);
    }
  }
  const sampleAreaM2 = orderedSamples.reduce((sum, sample) => sum + sample.areaM2, 0);
  if (Math.abs(sampleAreaM2 - layout.activeAreaM2) > Math.max(1e-10, layout.activeAreaM2 * 1e-8)) {
    throw new RangeError("Optical quadrature active area does not match the physical cell layout.");
  }
  const accumulators = layout.cells.map(() => ({
    areaM2: 0,
    poaAreaW: 0,
    temperatureAreaC: 0,
    sources: [] as Array<{ sample: EngineeringSurfaceElectricalSample; areaM2: number }>,
  }));
  let clippedAreaM2 = 0;
  const usedProjectionKeys = new Set<string>();
  for (const sample of orderedSamples) {
    const spatialKey = engineeringSurfaceProjectionKey(sample);
    const projection = layout.sampleProjectionBySpatialKey[spatialKey];
    if (projection === undefined) {
      throw new RangeError(`Optical material address is absent from the prebuilt projection: ${spatialKey}.`);
    }
    if (usedProjectionKeys.has(spatialKey)) {
      throw new RangeError(`Duplicate optical material address ${spatialKey}.`);
    }
    usedProjectionKeys.add(spatialKey);
    if (Math.abs(projection.sampleAreaM2 - sample.areaM2)
      > Math.max(1e-12, projection.sampleAreaM2 * 1e-9)) {
      throw new RangeError(`Optical sample area changed for prebuilt projection ${spatialKey}.`);
    }
    for (const overlap of projection.overlaps) {
      const accumulator = accumulators[overlap.cellIndex];
      if (accumulator === undefined) throw new Error("Sparse projection references an unknown physical cell.");
      accumulator.areaM2 += overlap.areaM2;
      accumulator.poaAreaW += overlap.areaM2 * sample.poaWm2;
      accumulator.temperatureAreaC += overlap.areaM2 * sample.cellTemperatureC;
      accumulator.sources.push({ sample, areaM2: overlap.areaM2 });
      clippedAreaM2 += overlap.areaM2;
    }
  }
  if (usedProjectionKeys.size !== layout.sampleProjectionCount) {
    throw new RangeError("Optical material-address cohort does not match the prebuilt projection.");
  }
  if (Math.abs(clippedAreaM2 - layout.activeAreaM2) > Math.max(1e-10, layout.activeAreaM2 * 1e-8)) {
    throw new Error("Optical-to-cell clipped areas do not close to A_PV.");
  }
  return layout.cells.map((definition, index): AggregatedCellCondition => {
    const accumulator = accumulators[index];
    if (Math.abs(accumulator.areaM2 - definition.areaM2) > Math.max(1e-10, definition.areaM2 * 1e-7)) {
      throw new Error(`Cell ${definition.id} clipped area does not match its physical area.`);
    }
    return {
      id: definition.id,
      areaM2: definition.areaM2,
      poaWm2: accumulator.poaAreaW / accumulator.areaM2,
      cellTemperatureC: accumulator.temperatureAreaC / accumulator.areaM2,
      definition,
      sourceWeights: accumulator.sources.map(({ sample, areaM2 }) => ({
        sampleId: sample.id,
        areaWeight: areaM2 / accumulator.areaM2,
        poaWm2: sample.poaWm2,
        cellTemperatureC: sample.cellTemperatureC,
      })),
    };
  });
}

function scaledCellConfig(reference: ElectricalConfig, areaM2: number): ElectricalConfig {
  if (reference.cellsInSeries !== 1) {
    throw new RangeError("Engineering surface wiring requires a per-cell reference with cellsInSeries=1.");
  }
  const scale = areaM2 / positiveFinite(reference.areaM2, "Reference cell area");
  return {
    ...reference,
    areaM2,
    pmaxW: reference.pmaxW * scale,
    iscA: reference.iscA * scale,
    impA: reference.impA * scale,
    // alphaIscAperC is absolute (A/degC), so it scales with area exactly as
    // iscA does. Leaving it unscaled while iscA scales inflated the relative
    // coefficient alpha/Isc by 1/scale, which for a 9.4%-area cell overstated
    // the Isc temperature response about 10-fold.
    alphaIscAperC: reference.alphaIscAperC * scale,
    seriesResistanceOhm: reference.seriesResistanceOhm / Math.max(scale, 1e-12),
    shuntResistanceOhm: reference.shuntResistanceOhm / Math.max(scale, 1e-12),
  };
}

function piecewiseNameplateCurve(
  condition: AggregatedCellCondition,
  reference: ElectricalConfig,
): IVCurve {
  const config = scaledCellConfig(reference, condition.areaM2);
  const irradianceRatio = condition.poaWm2 / positiveFinite(config.referenceIrradianceWm2, "Reference irradiance");
  const deltaC = condition.cellTemperatureC - config.referenceTemperatureC;
  if (irradianceRatio <= 0) {
    const zero: IVPoint = { voltageV: 0, currentA: 0, powerW: 0 };
    return {
      points: [zero], mpp: zero, iscA: 0, vocV: 0, converged: true,
      parameters: {
        photocurrentA: 0, saturationCurrentA: 0,
        seriesResistanceOhm: config.seriesResistanceOhm,
        shuntResistanceOhm: config.shuntResistanceOhm,
        idealityFactor: config.idealityFactor,
        cellsInSeries: 1,
        cellTemperatureC: condition.cellTemperatureC,
      },
    };
  }
  const currentTemperatureFactor = Math.max(
    0,
    1 + config.alphaIscAperC / Math.max(config.iscA, 1e-12) * deltaC,
  );
  const powerTemperatureFactor = Math.max(0, 1 + config.gammaPmpPerC * deltaC);
  const iscA = Math.max(0, config.iscA * irradianceRatio * currentTemperatureFactor);
  const impA = Math.min(iscA, Math.max(0, config.impA * irradianceRatio * currentTemperatureFactor));
  const targetPowerW = Math.max(0, config.pmaxW * irradianceRatio * powerTemperatureFactor);
  const vmpV = impA > 0 ? targetPowerW / impA : 0;
  const referenceFillVoltage = config.vmpV / Math.max(config.vocV, 1e-12);
  const vocV = vmpV / Math.max(referenceFillVoltage, 1e-6);
  const mpp = { voltageV: vmpV, currentA: impA, powerW: vmpV * impA };
  return {
    points: [
      { voltageV: 0, currentA: iscA, powerW: 0 },
      mpp,
      { voltageV: vocV, currentA: 0, powerW: 0 },
    ],
    mpp,
    iscA,
    vocV,
    converged: true,
    parameters: {
      photocurrentA: iscA,
      saturationCurrentA: 0,
      seriesResistanceOhm: config.seriesResistanceOhm,
      shuntResistanceOhm: config.shuntResistanceOhm,
      idealityFactor: config.idealityFactor,
      cellsInSeries: 1,
      cellTemperatureC: condition.cellTemperatureC,
    },
  };
}

function cellCurve(
  condition: AggregatedCellCondition,
  reference: ElectricalConfig,
  model: EngineeringCellIvModel,
  samples: number,
): IVCurve {
  if (model === "piecewise-nameplate") return piecewiseNameplateCurve(condition, reference);
  return singleDiodeCurve({
    irradianceWm2: condition.poaWm2,
    cellTemperatureC: condition.cellTemperatureC,
    config: scaledCellConfig(reference, condition.areaM2),
    points: samples,
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function partitionContiguous<T>(items: readonly T[], count: number): T[][] {
  const groups: T[][] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const length = Math.floor(items.length / count) + (index < items.length % count ? 1 : 0);
    groups.push(items.slice(offset, offset + length));
    offset += length;
  }
  return groups;
}

export function solveEngineeringSurfaceElectrical(
  samples: readonly EngineeringSurfaceElectricalSample[],
  reference: ElectricalConfig = DEFAULT_ELECTRICAL,
  config: EngineeringSurfaceConnectionConfig = {},
  prebuiltLayout?: EngineeringSurfaceCellLayout,
): EngineeringSurfaceElectricalResult {
  const nominalCellAreaM2 = config.nominalCellAreaM2 ?? reference.areaM2;
  const connection = resolvedConnection({ ...config, nominalCellAreaM2 });
  const layout = prebuiltLayout ?? createEngineeringSurfaceCellLayout(
    samples,
    { ...config, nominalCellAreaM2 },
    nominalCellAreaM2,
  );
  const conditions = aggregateSurfaceSamplesIntoCells(samples, nominalCellAreaM2, layout);
  const requestedStrings = Math.round(connection.parallelStrings);
  const parallelStringCount = integerInRange(
    Math.min(requestedStrings, conditions.length), 1, conditions.length, "Parallel string count",
  );
  const cellsPerBypassSubstring = integerInRange(
    Math.round(connection.cellsPerBypassSubstring), 1, 10_000, "Cells per bypass substring",
  );
  if (layout.parallelStringCount !== parallelStringCount
    || layout.cellsPerBypassSubstring !== cellsPerBypassSubstring) {
    throw new RangeError("Prebuilt layout topology does not match the solver connection.");
  }
  const bypassForwardVoltageV = nonNegativeFinite(
    connection.bypassForwardVoltageV, "Bypass forward voltage",
  );
  const stringWiringResistanceOhm = nonNegativeFinite(
    connection.stringWiringResistanceOhm, "String wiring resistance",
  );
  const arrayWiringResistanceOhm = nonNegativeFinite(
    connection.arrayWiringResistanceOhm, "Array wiring resistance",
  );
  const cellIvModel = connection.cellIvModel;
  const cellCurveSamples = Math.round(clamp(config.cellCurveSamples ?? 48, 16, 512));
  const circuitSamples = Math.round(clamp(config.circuitSamples ?? 128, 32, 1024));
  const cells: CircuitDevice[] = conditions.map((condition) => ({
    id: condition.id,
    curve: cellCurve(condition, reference, cellIvModel, cellCurveSamples),
  }));
  const cellGroups = partitionContiguous(cells, parallelStringCount);
  const definitionGroups = partitionContiguous(layout.cells, parallelStringCount);
  const networks: StringNetwork[] = cellGroups.map((stringCells, stringIndex) => {
    const substringCells = chunk(stringCells, cellsPerBypassSubstring);
    const substrings: CircuitDevice[] = substringCells.map((devices, substringIndex) => ({
      id: `string-${stringIndex + 1}:substring-${substringIndex + 1}`,
      curve: calculateCircuit({
        devices,
        topology: "series",
        bypassEnabled: false,
        samples: circuitSamples,
      }),
    }));
    return {
      id: `string-${stringIndex + 1}`,
      cells: stringCells,
      definitions: definitionGroups[stringIndex],
      substrings,
      result: calculateCircuit({
        devices: substrings,
        topology: "series",
        bypassEnabled: true,
        bypassForwardVoltageV,
        wiringResistanceOhm: stringWiringResistanceOhm,
        samples: circuitSamples,
      }),
    };
  });
  const array = calculateCircuit({
    devices: networks.map((network) => ({ id: network.id, curve: network.result })),
    topology: "parallel",
    bypassEnabled: false,
    wiringResistanceOhm: arrayWiringResistanceOhm,
    samples: circuitSamples,
  });
  const arrayBusVoltageV = array.mpp.voltageV + array.mpp.currentA * arrayWiringResistanceOhm;
  let bypassActiveCount = 0;
  const substringStatesByString: ReturnType<typeof seriesVoltageAtCurrent>["states"][] = [];
  const strings: EngineeringStringResult[] = networks.map((network) => {
    const operatingCurrentA = interpolateCurrentAtVoltage(network.result, arrayBusVoltageV);
    const states = seriesVoltageAtCurrent(network.substrings, operatingCurrentA, {
      bypassEnabled: true,
      bypassForwardVoltageV,
      wiringResistanceOhm: stringWiringResistanceOhm,
    }).states;
    substringStatesByString.push(states);
    const active = states.filter((state) => state.bypassConducting).length;
    bypassActiveCount += active;
    return {
      id: network.id,
      cellCount: network.cells.length,
      bypassSubstringCount: network.substrings.length,
      operatingCurrentA,
      bypassActiveCount: active,
      standaloneMppPowerW: network.result.mpp.powerW,
    };
  });
  const recoveredArrayCurrentA = strings.reduce((sum, string) => sum + string.operatingCurrentA, 0);
  if (Math.abs(recoveredArrayCurrentA - array.mpp.currentA)
    > Math.max(1e-10, array.mpp.currentA * 1e-8)) {
    throw new Error("Parallel string currents do not close to the array MPP current.");
  }
  const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));
  const operatingCellById = new Map<string, EngineeringCellOperatingResult>();
  networks.forEach((network, stringIndex) => {
    const operatingCurrentA = strings[stringIndex].operatingCurrentA;
    const substringStates = substringStatesByString[stringIndex];
    const provisional: Array<{
      definition: EngineeringSurfaceCellDefinition;
      condition: AggregatedCellCondition;
      bypassConducting: boolean;
      cellCurrentA: number;
      directCellVoltageV: number;
      directCellPowerW: number;
    }> = [];
    substringStates.forEach((substringState, substringIndex) => {
      const firstCell = substringIndex * cellsPerBypassSubstring;
      const lastCell = Math.min(network.cells.length, firstCell + cellsPerBypassSubstring);
      for (let cellIndex = firstCell; cellIndex < lastCell; cellIndex += 1) {
        const device = network.cells[cellIndex];
        const definition = network.definitions[cellIndex];
        const condition = conditionById.get(definition.id);
        if (condition === undefined || device.id !== definition.id) {
          throw new Error("Physical cell topology and circuit device ordering diverged.");
        }
        const bypassConducting = substringState.bypassConducting;
        const cellCurrentA = bypassConducting ? 0 : operatingCurrentA;
        const directCellVoltageV = bypassConducting
          ? 0
          : interpolateVoltageAtCurrent(device.curve, cellCurrentA);
        provisional.push({
          definition,
          condition,
          bypassConducting,
          cellCurrentA,
          directCellVoltageV,
          directCellPowerW: Math.max(0, cellCurrentA * directCellVoltageV),
        });
      }
    });
    const directPositiveCellPowerW = provisional.reduce(
      (sum, cell) => sum + cell.directCellPowerW, 0,
    );
    const bypassLossW = substringStates.filter((state) => state.bypassConducting).length
      * operatingCurrentA * bypassForwardVoltageV;
    const stringWiringLossW = operatingCurrentA ** 2 * stringWiringResistanceOhm;
    const modeledPositiveCellPowerW = Math.max(
      0,
      operatingCurrentA * arrayBusVoltageV + bypassLossW + stringWiringLossW,
    );
    if (modeledPositiveCellPowerW > 1e-12 && directPositiveCellPowerW <= 1e-12) {
      throw new Error("Circuit string delivers power without any positive non-bypassed cell support.");
    }
    const reconciliationScale = directPositiveCellPowerW > 0
      ? modeledPositiveCellPowerW / directPositiveCellPowerW
      : 1;
    provisional.forEach((cell) => {
      const cellVoltageV = cell.directCellVoltageV * reconciliationScale;
      const rawElectricalExtractionW = cell.directCellPowerW * reconciliationScale;
      operatingCellById.set(cell.definition.id, {
        id: cell.definition.id,
        zoneId: cell.definition.zoneId,
        zoneIndex: cell.definition.zoneIndex,
        areaM2: cell.definition.areaM2,
        stringId: cell.definition.stringId,
        substringId: cell.definition.substringId,
        poaWm2: cell.condition.poaWm2,
        cellTemperatureC: cell.condition.cellTemperatureC,
        operatingCurrentA: cell.cellCurrentA,
        operatingVoltageV: cellVoltageV,
        rawElectricalExtractionW,
        terminalElectricalExtractionW: 0,
        bypassConducting: cell.bypassConducting,
      });
    });
  });
  if (operatingCellById.size !== layout.cells.length) {
    throw new Error("Circuit operating diagnostics do not cover every physical cell.");
  }
  const rawOperatingCells = layout.cells.map((definition) => {
    const cell = operatingCellById.get(definition.id);
    if (cell === undefined) throw new Error(`Missing operating result for ${definition.id}.`);
    return cell;
  });
  const dcPowerW = Math.max(0, array.mpp.powerW);
  const rawElectricalExtractionW = rawOperatingCells.reduce(
    (sum, cell) => sum + cell.rawElectricalExtractionW, 0,
  );
  if (dcPowerW > rawElectricalExtractionW
    + Math.max(1e-9, rawElectricalExtractionW * 1e-7)) {
    throw new Error("Terminal DC exceeds positive physical-cell operating extraction.");
  }
  const terminalScale = rawElectricalExtractionW > 0 ? dcPowerW / rawElectricalExtractionW : 0;
  const operatingCells = rawOperatingCells.map((cell) => ({
    ...cell,
    terminalElectricalExtractionW: cell.rawElectricalExtractionW * terminalScale,
  }));
  const electricalExtractionWBySampleId: Record<string, number> = Object.create(null);
  const orderedSampleIds = [...new Set(samples.map((sample) => sample.id))].sort(compareText);
  orderedSampleIds.forEach((sampleId) => { electricalExtractionWBySampleId[sampleId] = 0; });
  conditions.forEach((condition, cellIndex) => {
    const cellPowerW = operatingCells[cellIndex].terminalElectricalExtractionW;
    if (!(cellPowerW > 0)) return;
    const proxies = condition.sourceWeights.map((source) => source.areaWeight
      * Math.max(0, source.poaWm2)
      * Math.max(0, 1 + reference.gammaPmpPerC
        * (source.cellTemperatureC - reference.referenceTemperatureC)));
    const proxySum = proxies.reduce((sum, proxy) => sum + proxy, 0);
    const weights = proxySum > 0 ? proxies.map((proxy) => proxy / proxySum)
      : condition.sourceWeights.map((source) => source.areaWeight);
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    let allocatedW = 0;
    condition.sourceWeights.forEach((source, sourceIndex) => {
      const shareW = sourceIndex === condition.sourceWeights.length - 1
        ? cellPowerW - allocatedW
        : cellPowerW * weights[sourceIndex] / Math.max(weightSum, 1e-15);
      electricalExtractionWBySampleId[source.sampleId] += shareW;
      allocatedW += shareW;
    });
  });
  const allocatedExtractionW = orderedSampleIds.reduce(
    (sum, sampleId) => sum + electricalExtractionWBySampleId[sampleId], 0,
  );
  const extractionCorrectionW = dcPowerW - allocatedExtractionW;
  if (Math.abs(extractionCorrectionW) > Math.max(1e-9, dcPowerW * 1e-9)) {
    throw new Error("Sample electrical extraction does not close to terminal DC.");
  }
  if (orderedSampleIds.length > 0 && extractionCorrectionW !== 0) {
    const correctionId = orderedSampleIds.reduce((best, sampleId) =>
      electricalExtractionWBySampleId[sampleId] > electricalExtractionWBySampleId[best]
        ? sampleId : best, orderedSampleIds[0]);
    electricalExtractionWBySampleId[correctionId] += extractionCorrectionW;
  }
  Object.entries(electricalExtractionWBySampleId).forEach(([sampleId, extractionW]) => {
    if (!Number.isFinite(extractionW) || extractionW < -1e-12) {
      throw new Error(`Invalid terminal extraction allocation for ${sampleId}.`);
    }
  });
  const idealLocalMppDcPowerW = cells.reduce((sum, cell) => sum + cell.curve.mpp.powerW, 0);
  const mismatchAndWiringLossW = Math.max(0, idealLocalMppDcPowerW - array.mpp.powerW);
  const activeAreaM2 = conditions.reduce((sum, cell) => sum + cell.areaM2, 0);
  return {
    connectionModel: "explicit-series-parallel-bypass",
    layoutId: layout.layoutId,
    cellIvModel,
    dcPowerW,
    dcVoltageV: Math.max(0, array.mpp.voltageV),
    dcCurrentA: Math.max(0, array.mpp.currentA),
    idealLocalMppDcPowerW,
    mismatchAndWiringLossW,
    mismatchAndWiringLossFraction: idealLocalMppDcPowerW > 0
      ? clamp(mismatchAndWiringLossW / idealLocalMppDcPowerW, 0, 1)
      : 0,
    bypassActiveCount,
    activeAreaM2,
    nominalCellAreaM2,
    nominalCellDensityPerM2: 1 / nominalCellAreaM2,
    cellCount: cells.length,
    trimmedCellAreaM2: layout.trimmedCellAreaM2,
    parallelStringCount,
    seriesCellCountByString: layout.seriesCellCountByString,
    bypassSubstringCount: layout.bypassSubstringCount,
    trimmedCellCount: layout.trimmedCellCount,
    strings,
    cells: operatingCells,
    electricalExtractionWBySampleId,
  };
}
