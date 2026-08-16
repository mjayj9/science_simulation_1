import type { IdealSurfaceModel } from "../geometry";
import type { WeatherPoint } from "../weather";
import {
  createEngineeringSurfaceCellLayout,
  engineeringSurfaceSpatialKey,
  solveEngineeringSurfaceElectrical,
  type EngineeringSurfaceCellLayout,
  type EngineeringSurfaceConnectionConfig,
  type EngineeringSurfaceElectricalSample,
} from "./engineering-surface-electrical";
import type { ElectricalConfig } from "./electrical";
import { calculatePOA, type IAMConfig } from "./irradiance";
import { calculateInverter, type InverterConfig } from "./inverter";
import { motorDrivePowerW, type MotorDrivePowerInput } from "./rotation";
import { solarPosition, sunVector } from "./solar";
import {
  DEFAULT_TRANSIENT_THERMAL_CONFIG,
  externalConvectionCoefficient,
  materialPoseAtWorldYPhase,
  relativeSurfaceWindSpeedMS,
  temperatureAdjustedEfficiency,
  type AirProperties,
  type MaterialThermalConfig,
  type MaterialThermalEdge,
  type MaterialThermalNode,
} from "./transient-thermal";
import { clamp, type Vec3 } from "./types";

const STEFAN_BOLTZMANN_W_M2_K4 = 5.670_374_419e-8;
const TWO_PI = 2 * Math.PI;

export const QUASI_STEADY_ROTATION_THERMAL_LABEL_KO =
  "준정상 광학 회전·열이력 미포함" as const;
export const ANNUAL_TRANSIENT_ROTATION_THERMAL_LABEL_KO =
  "전년 시간 적분·과도 열이력 포함" as const;

export interface QuasiSteadyThermalModelMetadata {
  model: "quasi-steady-faiman";
  labelKo: typeof QUASI_STEADY_ROTATION_THERMAL_LABEL_KO;
  includesThermalHistory: false;
  periodIntegration: "pointwise-quasi-steady";
}

export interface AnnualTransientThermalModelMetadata {
  model: "annual-transient-material-state";
  labelKo: typeof ANNUAL_TRANSIENT_ROTATION_THERMAL_LABEL_KO;
  includesThermalHistory: true;
  periodIntegration: "actual-weather-clock";
}

export type ThermalModelMetadata =
  | QuasiSteadyThermalModelMetadata
  | AnnualTransientThermalModelMetadata;

export function thermalModelMetadata(
  model: "annual-transient-material-state",
): AnnualTransientThermalModelMetadata;
export function thermalModelMetadata(
  model: "quasi-steady-faiman",
): QuasiSteadyThermalModelMetadata;
export function thermalModelMetadata(
  model: ThermalModelMetadata["model"],
): ThermalModelMetadata;
export function thermalModelMetadata(
  model: ThermalModelMetadata["model"],
): ThermalModelMetadata {
  return model === "annual-transient-material-state"
    ? {
        model,
        labelKo: ANNUAL_TRANSIENT_ROTATION_THERMAL_LABEL_KO,
        includesThermalHistory: true,
        periodIntegration: "actual-weather-clock",
      }
    : {
        model,
        labelKo: QUASI_STEADY_ROTATION_THERMAL_LABEL_KO,
        includesThermalHistory: false,
        periodIntegration: "pointwise-quasi-steady",
      };
}

export interface AnnualThermalOpticalSample {
  id: string;
  areaM2: number;
  bodyPositionM: Vec3;
  bodyNormal: Vec3;
  zoneId: string;
  zoneIndex: number;
  u: number;
  v: number;
}

export interface AnnualThermalMeshConfig {
  /** Independent of the optical integration sample count. */
  targetNodeCount: number;
  inPlaneThermalConductivityWmK: number;
  laminateThicknessM: number;
  neighboursPerNode: number;
}

export const DEFAULT_ANNUAL_THERMAL_MESH_CONFIG: Readonly<AnnualThermalMeshConfig> =
  Object.freeze({
    targetNodeCount: 12,
    inPlaneThermalConductivityWmK: 5,
    laminateThicknessM: 0.004,
    neighboursPerNode: 2,
  });

export interface AnnualReducedThermalMesh {
  nodes: MaterialThermalNode[];
  edges: MaterialThermalEdge[];
  opticalSamplesByNodeId: Record<string, AnnualThermalOpticalSample[]>;
  opticalSampleCount: number;
  requestedThermalNodeCount: number;
  thermalNodeCount: number;
  conductionModel: "nearest-neighbour-laminate-network";
  inPlaneThermalConductivityWmK: number;
  laminateThicknessM: number;
  neighboursPerNode: number;
}

type AnnualSurfaceSample = IdealSurfaceModel["zones"][number]["samples"][number];

interface AnnualSurfaceZoneSamples {
  id: string;
  index: number;
  areaM2: number;
  samples: AnnualSurfaceSample[];
}

function compareSurfaceSamples(
  left: AnnualSurfaceSample,
  right: AnnualSurfaceSample,
): number {
  return left.zoneIndex - right.zoneIndex
    || left.zoneId.localeCompare(right.zoneId)
    || left.u - right.u
    || left.v - right.v
    || left.position[0] - right.position[0]
    || left.position[1] - right.position[1]
    || left.position[2] - right.position[2];
}

/**
 * Allocates at least one reduced node to every separate surface chart. A
 * requested count smaller than the chart count is therefore treated as a
 * target, not a licence to join thermally unrelated faces into one centroid.
 */
function allocateThermalNodeCountsByZone(
  zones: readonly AnnualSurfaceZoneSamples[],
  targetNodeCount: number,
): number[] {
  const totalSampleCount = zones.reduce((sum, zone) => sum + zone.samples.length, 0);
  const totalNodeCount = Math.min(
    totalSampleCount,
    Math.max(targetNodeCount, zones.length),
  );
  const counts = zones.map(() => 1);
  for (let allocated = zones.length; allocated < totalNodeCount; allocated += 1) {
    let selected = -1;
    let selectedAreaPerNode = -Infinity;
    zones.forEach((zone, index) => {
      if (counts[index] >= zone.samples.length) return;
      const areaPerNode = zone.areaM2 / counts[index];
      if (areaPerNode > selectedAreaPerNode + 1e-15) {
        selected = index;
        selectedAreaPerNode = areaPerNode;
      }
    });
    if (selected < 0) throw new RangeError("Unable to allocate the requested thermal nodes.");
    counts[selected] += 1;
  }
  return counts;
}

/**
 * Deterministic two-dimensional chart partition. Recursive u/v splits keep
 * every group local on its source chart instead of concatenating azimuthal
 * rings whose area centroid can collapse onto the rotation axis.
 */
function partitionZoneSamplesLocally(
  samples: readonly AnnualSurfaceSample[],
  groupCount: number,
): AnnualSurfaceSample[][] {
  if (groupCount === 1) return [samples.slice().sort(compareSurfaceSamples)];
  if (groupCount > samples.length) {
    throw new RangeError("A thermal sample group cannot be empty.");
  }
  const uValues = samples.map((sample) => sample.u);
  const vValues = samples.map((sample) => sample.v);
  const uRange = Math.max(...uValues) - Math.min(...uValues);
  const vRange = Math.max(...vValues) - Math.min(...vValues);
  const primary: "u" | "v" = vRange > uRange ? "v" : "u";
  const secondary: "u" | "v" = primary === "u" ? "v" : "u";
  const ordered = samples.slice().sort((left, right) =>
    left[primary] - right[primary]
    || left[secondary] - right[secondary]
    || compareSurfaceSamples(left, right));
  const leftGroupCount = Math.floor(groupCount / 2);
  const rightGroupCount = groupCount - leftGroupCount;
  const proportionalIndex = Math.round(ordered.length * leftGroupCount / groupCount);
  const splitIndex = Math.max(
    leftGroupCount,
    Math.min(ordered.length - rightGroupCount, proportionalIndex),
  );
  return [
    ...partitionZoneSamplesLocally(ordered.slice(0, splitIndex), leftGroupCount),
    ...partitionZoneSamplesLocally(ordered.slice(splitIndex), rightGroupCount),
  ];
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function normalizedMeshConfig(
  patch: Partial<AnnualThermalMeshConfig> | undefined,
): AnnualThermalMeshConfig {
  const config = { ...DEFAULT_ANNUAL_THERMAL_MESH_CONFIG, ...patch };
  if (!Number.isInteger(config.targetNodeCount) || config.targetNodeCount < 1) {
    throw new RangeError("Thermal target node count must be a positive integer.");
  }
  positiveFinite(config.inPlaneThermalConductivityWmK, "In-plane thermal conductivity");
  positiveFinite(config.laminateThicknessM, "Laminate thickness");
  if (!Number.isInteger(config.neighboursPerNode) || config.neighboursPerNode < 1) {
    throw new RangeError("Thermal neighbours per node must be a positive integer.");
  }
  return config;
}

/**
 * Aggregates the optical quadrature into a separate low-order thermal mesh.
 * Every optical sample remains attached to exactly one thermal node, so the
 * optical area integral is unchanged while heat capacity and conduction are
 * evaluated on a tractable graph.
 */
export function createAnnualReducedThermalMesh(
  surface: IdealSurfaceModel,
  initialTemperatureC: number,
  patch?: Partial<AnnualThermalMeshConfig>,
): AnnualReducedThermalMesh {
  if (!Number.isFinite(initialTemperatureC)) {
    throw new RangeError("Initial material temperature must be finite.");
  }
  const config = normalizedMeshConfig(patch);
  const zones = surface.zones
    .filter((zone) => zone.samples.length > 0)
    .map((zone): AnnualSurfaceZoneSamples => ({
      id: zone.id,
      index: zone.index,
      areaM2: zone.samples.reduce((sum, sample) => sum + sample.areaM2, 0),
      samples: zone.samples.slice().sort(compareSurfaceSamples),
    }))
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  const opticalSampleCount = zones.reduce((sum, zone) => sum + zone.samples.length, 0);
  if (opticalSampleCount === 0) throw new RangeError("At least one optical sample is required.");
  const nodeCountsByZone = allocateThermalNodeCountsByZone(zones, config.targetNodeCount);
  const groups = zones.flatMap((zone, index) =>
    partitionZoneSamplesLocally(zone.samples, nodeCountsByZone[index]));
  // Comparison plane/cube models retain radiusM=0 for a stable serialized
  // schema. Nullish coalescing would accept that sentinel and collapse the
  // convection length to the numerical 1e-4 m floor. Select only a physical,
  // positive shape dimension instead.
  const fallbackLengthM = [
    surface.dimensions.radiusM,
    surface.dimensions.widthM,
    surface.dimensions.depthM,
    Math.sqrt(surface.dimensions.activeAreaM2),
  ].find((candidate): candidate is number =>
    candidate !== undefined && Number.isFinite(candidate) && candidate > 0);
  if (fallbackLengthM === undefined) {
    throw new RangeError("A positive surface length scale is required for convection.");
  }
  const opticalSamplesByNodeId: Record<string, AnnualThermalOpticalSample[]> = {};
  const nodes = groups.map((samples, index): MaterialThermalNode => {
    const id = `thermal:${index}`;
    const areaM2 = samples.reduce((sum, sample) => sum + sample.areaM2, 0);
    const weighted = (select: (sample: (typeof samples)[number]) => number) =>
      samples.reduce((sum, sample) => sum + select(sample) * sample.areaM2, 0) / areaM2;
    const rawNormal = {
      x: weighted((sample) => sample.normal[0]),
      y: weighted((sample) => sample.normal[1]),
      z: weighted((sample) => sample.normal[2]),
    };
    const normalMagnitude = Math.hypot(rawNormal.x, rawNormal.y, rawNormal.z);
    const bodyNormal: Vec3 = normalMagnitude > 1e-12
      ? {
          x: rawNormal.x / normalMagnitude,
          y: rawNormal.y / normalMagnitude,
          z: rawNormal.z / normalMagnitude,
        }
      : { x: 0, y: 1, z: 0 };
    opticalSamplesByNodeId[id] = samples.map((sample) => {
      const bodyPositionM = {
        x: sample.position[0],
        y: sample.position[1],
        z: sample.position[2],
      };
      return {
        id: engineeringSurfaceSpatialKey({
          zoneId: sample.zoneId,
          zoneIndex: sample.zoneIndex,
          u: sample.u,
          v: sample.v,
          positionM: bodyPositionM,
        }),
        areaM2: sample.areaM2,
        bodyPositionM,
        bodyNormal: { x: sample.normal[0], y: sample.normal[1], z: sample.normal[2] },
        zoneId: sample.zoneId,
        zoneIndex: sample.zoneIndex,
        u: sample.u,
        v: sample.v,
      };
    });
    return {
      id,
      areaM2,
      bodyPositionM: {
        x: weighted((sample) => sample.position[0]),
        y: weighted((sample) => sample.position[1]),
        z: weighted((sample) => sample.position[2]),
      },
      bodyNormal,
      characteristicLengthM: fallbackLengthM,
      shape: surface.kind,
      temperatureC: initialTemperatureC,
    };
  });
  const edgeByPair = new Map<string, MaterialThermalEdge>();
  nodes.forEach((first, firstIndex) => {
    nodes
      .map((second, secondIndex) => ({
        second,
        secondIndex,
        distanceM: Math.hypot(
          second.bodyPositionM.x - first.bodyPositionM.x,
          second.bodyPositionM.y - first.bodyPositionM.y,
          second.bodyPositionM.z - first.bodyPositionM.z,
        ),
      }))
      .filter(({ secondIndex }) => secondIndex !== firstIndex)
      .sort((left, right) => left.distanceM - right.distanceM || left.secondIndex - right.secondIndex)
      .slice(0, Math.min(config.neighboursPerNode, nodes.length - 1))
      .forEach(({ second, secondIndex, distanceM }) => {
        const low = Math.min(firstIndex, secondIndex);
        const high = Math.max(firstIndex, secondIndex);
        const key = `${low}:${high}`;
        if (edgeByPair.has(key)) return;
        const interfaceLengthM = Math.sqrt(Math.min(first.areaM2, second.areaM2));
        edgeByPair.set(key, {
          firstNodeId: nodes[low].id,
          secondNodeId: nodes[high].id,
          conductanceWPerK: config.inPlaneThermalConductivityWmK
            * config.laminateThicknessM * interfaceLengthM / Math.max(1e-4, distanceM),
        });
      });
  });
  const areaM2 = nodes.reduce((sum, node) => sum + node.areaM2, 0);
  if (Math.abs(areaM2 - surface.dimensions.activeAreaM2) > Math.max(1e-10, areaM2 * 1e-8)) {
    throw new RangeError("Reduced thermal-node area does not close to the analytic PV skin area.");
  }
  return {
    nodes,
    edges: [...edgeByPair.values()],
    opticalSamplesByNodeId,
    opticalSampleCount,
    requestedThermalNodeCount: config.targetNodeCount,
    thermalNodeCount: nodes.length,
    conductionModel: "nearest-neighbour-laminate-network",
    inPlaneThermalConductivityWmK: config.inPlaneThermalConductivityWmK,
    laminateThicknessM: config.laminateThicknessM,
    neighboursPerNode: config.neighboursPerNode,
  };
}

export interface AnnualNodeConvectionAverage {
  coefficientWm2K: number;
  relativeWindSpeedMS: number;
  sampleCount: number;
  areaM2: number;
}

/**
 * Resolves |u_wind - omega x r| and the external-convection correlation at
 * every original optical sample. The thermal-node centroid is intentionally
 * absent: it is retained only for conduction topology and temperature
 * reporting, and cannot cancel the rotational surface velocity here.
 */
export function calculateAreaWeightedNodeConvection(
  node: Pick<MaterialThermalNode, "id" | "areaM2" | "shape" | "characteristicLengthM">,
  samples: readonly AnnualThermalOpticalSample[],
  phaseRad: number,
  angularVelocityRadS: number,
  windVelocityMS: Vec3,
  minimumConvectionWm2K: number,
  air: AirProperties,
): AnnualNodeConvectionAverage {
  if (samples.length === 0) throw new RangeError(`${node.id} has no optical samples.`);
  if (!Number.isFinite(minimumConvectionWm2K) || minimumConvectionWm2K < 0) {
    throw new RangeError("Minimum convection must be a finite nonnegative number.");
  }
  let areaM2 = 0;
  let coefficientAreaWPerK = 0;
  let relativeSpeedAreaM3S = 0;
  samples.forEach((sample) => {
    positiveFinite(sample.areaM2, `${node.id} optical sample area`);
    const pose = materialPoseAtWorldYPhase(sample, phaseRad);
    const relativeSpeedMS = relativeSurfaceWindSpeedMS(
      windVelocityMS,
      angularVelocityRadS,
      pose.positionM,
    );
    const coefficientWm2K = Math.max(
      minimumConvectionWm2K,
      externalConvectionCoefficient(
        node.shape,
        relativeSpeedMS,
        node.characteristicLengthM,
        air,
      ).coefficientWm2K,
    );
    areaM2 += sample.areaM2;
    coefficientAreaWPerK += coefficientWm2K * sample.areaM2;
    relativeSpeedAreaM3S += relativeSpeedMS * sample.areaM2;
  });
  if (Math.abs(areaM2 - node.areaM2) > Math.max(1e-10, node.areaM2 * 1e-8)) {
    throw new RangeError(`${node.id} optical sample area does not close to its thermal-node area.`);
  }
  return {
    coefficientWm2K: coefficientAreaWPerK / areaM2,
    relativeWindSpeedMS: relativeSpeedAreaM3S / areaM2,
    sampleCount: samples.length,
    areaM2,
  };
}

export interface AnnualTransientWarmupConfig {
  periodHours: number;
  minimumCycles: number;
  maximumCycles: number;
  convergenceToleranceC: number;
}

export const DEFAULT_ANNUAL_TRANSIENT_WARMUP: Readonly<AnnualTransientWarmupConfig> =
  Object.freeze({
    periodHours: 24,
    minimumCycles: 2,
    maximumCycles: 12,
    convergenceToleranceC: 0.02,
  });

export interface AnnualTransientLocation {
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM?: number;
}

export const MAX_ENGINEERING_CIRCUIT_COUPLING_SECONDS = 3_600 as const;
export const DEFAULT_ENGINEERING_CIRCUIT_COUPLING_SECONDS = 900 as const;

export interface AnnualTransientEngineeringElectricalConfig {
  /** Per-cell nameplate/IV reference. `cellsInSeries` must be one. */
  referenceCell: ElectricalConfig;
  /** Immutable manufactured topology shared with the quasi-steady worker path. */
  connection: EngineeringSurfaceConnectionConfig;
  /**
   * Maximum operator-split interval between circuit solves. Thermal state is
   * still advanced on its independent, usually finer, stability clock.
   */
  maximumCouplingStepSeconds?: number;
}

export interface AnnualTransientSurfaceInput {
  surface: IdealSurfaceModel;
  /** Ordered weather boundaries, including the final closing endpoint. */
  weather: readonly WeatherPoint[];
  location: AnnualTransientLocation;
  rpm: number;
  /** Entry i is held over [weather[i], weather[i+1]). */
  rpmByWeatherStep?: readonly number[];
  opticalRpm?: number;
  convectionRpm?: number;
  opticalRpmByWeatherStep?: readonly number[];
  convectionRpmByWeatherStep?: readonly number[];
  /**
   * Active-drive demand deducted after the inverter at every thermal substep.
   * Requested motor energy remains separately auditable when net AC clips to
   * zero. Factorial E00 resolves the motor RPM to zero.
   */
  motorDrive?: Omit<MotorDrivePowerInput, "rpm">;
  motorRpm?: number;
  /** Entry i is held over [weather[i], weather[i+1]). */
  motorRpmByWeatherStep?: readonly number[];
  initialPhaseRad?: number;
  /** Optional channel-specific checkpoint phases; fall back to initialPhaseRad. */
  initialOpticalPhaseRad?: number;
  initialConvectionPhaseRad?: number;
  referenceEfficiency: number;
  gammaPerC: number;
  referenceTemperatureC?: number;
  absorptivity?: number;
  /** Post-optical availability applied before either electrical model. */
  electricalAvailabilityFactor?: number;
  /** Omit only for the ideal local-MPP upper-bound path. */
  engineeringElectrical?: AnnualTransientEngineeringElectricalConfig;
  soilingLossFraction?: number;
  albedo?: number;
  iam?: IAMConfig;
  diffuseModel?: "hay-davies" | "isotropic";
  initialTemperatureC?: number;
  /**
   * Exact checkpoint/restart state. Keys must match the deterministic reduced
   * thermal-node IDs produced by this input's surface and mesh configuration.
   */
  initialTemperatureCByNode?: Readonly<Record<string, number>>;
  effectiveSkyTemperatureOffsetC?: number;
  /** Both front and back radiate by default. */
  radiativeSurfaceFactor?: number;
  inverter?: InverterConfig | false;
  thermalConfig?: Partial<Omit<MaterialThermalConfig, "air">> & {
    air?: Partial<MaterialThermalConfig["air"]>;
  };
  thermalMesh?: Partial<AnnualThermalMeshConfig>;
  warmup?: false | Partial<AnnualTransientWarmupConfig>;
  opticalPhaseSamples?: number;
  convectionPhaseSamples?: number;
  reportingOffsetMinutes?: number;
}

export interface AnnualTransientMonthEnergy {
  month: string;
  dcEnergyWh: number;
  idealLocalMppDcEnergyWh: number;
  mismatchAndWiringLossEnergyWh: number;
  grossAcEnergyWh: number;
  acEnergyWh: number;
  motorEnergyWh: number;
  absorbedSolarEnergyWh: number;
  bypassActivationDeviceHours: number;
}

export interface AnnualTransientCoverageAudit {
  startTimeUtcMs: number;
  endTimeUtcMs: number;
  steps: number;
  intervals: number;
  durationHours: number;
  expectedCalendarHours?: 8760 | 8784;
  isFullCalendarYear: boolean;
  closingEndpointPresent: boolean;
}

export interface AnnualTransientEnergyAudit {
  storedEnergyChangeJ: number;
  netBoundaryEnergyJ: number;
  conductionCancellationJ: number;
  energyResidualJ: number;
  relativeEnergyResidual: number;
}

export interface AnnualTransientSurfaceResult {
  thermalModel: AnnualTransientThermalModelMetadata;
  electricalModel: "local-mpp-area-integral" | "explicit-series-parallel-bypass";
  electricalLayoutId: string;
  dcEnergyWh: number;
  idealLocalMppDcEnergyWh: number;
  mismatchAndWiringLossEnergyWh: number;
  grossAcEnergyWh: number;
  acEnergyWh: number;
  motorEnergyWh: number;
  absorbedSolarEnergyWh: number;
  bypassActivationDeviceHours: number;
  inverterLossWh: number;
  engineeringCircuit?: {
    cellCount: number;
    parallelStringCount: number;
    seriesCellCountByString: readonly number[];
    bypassSubstringCount: number;
    maximumCouplingStepSeconds: number;
    circuitSolveCount: number;
    maximumElectricalExtractionClosureErrorW: number;
  };
  monthly: AnnualTransientMonthEnergy[];
  averageTemperatureC: number;
  maximumTemperatureC: number;
  minimumTemperatureC: number;
  initialTemperatureCByNode: Record<string, number>;
  initialOpticalPhaseRad: number;
  initialConvectionPhaseRad: number;
  finalTemperatureCByNode: Record<string, number>;
  /** Exact terminal phases support deterministic segmented/checkpoint execution. */
  terminalOpticalPhaseRad: number;
  terminalConvectionPhaseRad: number;
  coverage: AnnualTransientCoverageAudit;
  warmup: {
    enabled: boolean;
    cycles: number;
    converged: boolean;
    terminalMaximumDeltaC: number;
    toleranceC: number;
    periodHours: number;
  };
  mesh: Omit<AnnualReducedThermalMesh, "nodes" | "edges" | "opticalSamplesByNodeId"> & {
    edgeCount: number;
  };
  energyAudit: AnnualTransientEnergyAudit;
}

interface PhaseSample {
  angleRad: number;
  weight: number;
}

function phaseSamples(
  initialAngleRad: number,
  angularVelocityRadS: number,
  durationSeconds: number,
  samplesPerTurn: number,
): PhaseSample[] {
  if (Math.abs(angularVelocityRadS * durationSeconds) <= 1e-12) {
    return [{ angleRad: initialAngleRad, weight: 1 }];
  }
  const signedAngle = angularVelocityRadS * durationSeconds;
  const direction = Math.sign(signedAngle);
  const totalTurns = Math.abs(signedAngle) / TWO_PI;
  if (totalTurns < 1) {
    const count = Math.max(1, Math.ceil(samplesPerTurn * totalTurns));
    return Array.from({ length: count }, (_, index) => ({
      angleRad: initialAngleRad + signedAngle * (index + 0.5) / count,
      weight: 1 / count,
    }));
  }
  const completeTurns = Math.floor(totalTurns);
  const residualTurns = totalTurns - completeTurns;
  const result = Array.from({ length: samplesPerTurn }, (_, index) => ({
    angleRad: initialAngleRad + direction * TWO_PI * (index + 0.5) / samplesPerTurn,
    weight: completeTurns / totalTurns / samplesPerTurn,
  }));
  if (residualTurns > 1e-12) {
    const residualCount = Math.max(1, Math.ceil(samplesPerTurn * residualTurns));
    for (let index = 0; index < residualCount; index += 1) {
      result.push({
        angleRad: initialAngleRad + direction * TWO_PI
          * (completeTurns + residualTurns * (index + 0.5) / residualCount),
        weight: residualTurns / totalTurns / residualCount,
      });
    }
  }
  return result;
}

function windVelocity(point: WeatherPoint): Vec3 {
  const directionRad = point.windDirectionDeg * Math.PI / 180;
  return {
    x: -point.windSpeedMs * Math.sin(directionRad),
    y: 0,
    z: -point.windSpeedMs * Math.cos(directionRad),
  };
}

function calendarCoverage(
  weather: readonly WeatherPoint[],
  reportingOffsetMinutes: number,
): AnnualTransientCoverageAudit {
  const firstTimeMs = weather[0].timeUtcMs;
  const lastTimeMs = weather.at(-1)?.timeUtcMs ?? firstTimeMs;
  const durationHours = (lastTimeMs - firstTimeMs) / 3_600_000;
  const shiftedFirst = new Date(firstTimeMs + reportingOffsetMinutes * 60_000);
  const shiftedLast = new Date(lastTimeMs + reportingOffsetMinutes * 60_000);
  const startsYear = shiftedFirst.getUTCMonth() === 0 && shiftedFirst.getUTCDate() === 1
    && shiftedFirst.getUTCHours() === 0 && shiftedFirst.getUTCMinutes() === 0
    && shiftedFirst.getUTCSeconds() === 0 && shiftedFirst.getUTCMilliseconds() === 0;
  const endsNextYear = shiftedLast.getUTCFullYear() === shiftedFirst.getUTCFullYear() + 1
    && shiftedLast.getUTCMonth() === 0 && shiftedLast.getUTCDate() === 1
    && shiftedLast.getUTCHours() === 0 && shiftedLast.getUTCMinutes() === 0
    && shiftedLast.getUTCSeconds() === 0 && shiftedLast.getUTCMilliseconds() === 0;
  const expected = durationHours === 8760 || durationHours === 8784
    ? durationHours as 8760 | 8784
    : undefined;
  return {
    startTimeUtcMs: firstTimeMs,
    endTimeUtcMs: lastTimeMs,
    steps: weather.length,
    intervals: weather.length - 1,
    durationHours,
    ...(expected === undefined ? {} : { expectedCalendarHours: expected }),
    isFullCalendarYear: startsYear && endsNextYear && expected !== undefined,
    closingEndpointPresent: startsYear && endsNextYear,
  };
}

function validateAnnualInput(input: AnnualTransientSurfaceInput): void {
  if (input.weather.length < 2) throw new RangeError("Transient history requires two weather boundaries.");
  for (let index = 1; index < input.weather.length; index += 1) {
    if (!(input.weather[index].timeUtcMs > input.weather[index - 1].timeUtcMs)) {
      throw new RangeError("Transient weather timestamps must be strictly increasing.");
    }
  }
  [input.rpm, input.opticalRpm ?? input.rpm, input.convectionRpm ?? input.rpm,
    input.initialPhaseRad ?? 0, input.initialOpticalPhaseRad ?? input.initialPhaseRad ?? 0,
    input.initialConvectionPhaseRad ?? input.initialPhaseRad ?? 0,
    input.referenceEfficiency, input.gammaPerC].forEach((value) => {
    if (!Number.isFinite(value)) throw new RangeError("Transient rotation and PV inputs must be finite.");
  });
  [input.rpmByWeatherStep, input.opticalRpmByWeatherStep, input.convectionRpmByWeatherStep,
    input.motorRpmByWeatherStep]
    .forEach((schedule) => {
      if (schedule === undefined) return;
      if (schedule.length !== input.weather.length || schedule.some((rpm) => !Number.isFinite(rpm))) {
        throw new RangeError("Every RPM schedule must have one finite value per weather boundary.");
      }
    });
  [input.opticalPhaseSamples ?? 12, input.convectionPhaseSamples ?? 12].forEach((count) => {
    if (!Number.isInteger(count) || count < 1 || count > 256) {
      throw new RangeError("Phase sample counts must be integers from 1 to 256.");
    }
  });
  const electricalAvailabilityFactor = input.electricalAvailabilityFactor ?? 1;
  if (!Number.isFinite(electricalAvailabilityFactor)
    || electricalAvailabilityFactor < 0 || electricalAvailabilityFactor > 1) {
    throw new RangeError("Electrical availability factor must be finite and in [0, 1].");
  }
  if (input.engineeringElectrical !== undefined) {
    if (input.engineeringElectrical.referenceCell.cellsInSeries !== 1) {
      throw new RangeError("Annual engineering wiring requires a per-cell reference with cellsInSeries=1.");
    }
    const maximumCouplingStepSeconds = input.engineeringElectrical.maximumCouplingStepSeconds
      ?? DEFAULT_ENGINEERING_CIRCUIT_COUPLING_SECONDS;
    if (!Number.isFinite(maximumCouplingStepSeconds)
      || maximumCouplingStepSeconds <= 0
      || maximumCouplingStepSeconds > MAX_ENGINEERING_CIRCUIT_COUPLING_SECONDS) {
      throw new RangeError(
        `Engineering circuit coupling step must be in (0, ${MAX_ENGINEERING_CIRCUIT_COUPLING_SECONDS}] seconds.`,
      );
    }
  }
  if (input.motorDrive !== undefined) {
    motorDrivePowerW({
      ...input.motorDrive,
      rpm: input.motorRpm ?? input.rpm,
    });
  }
}

function scheduleValue(
  schedule: readonly number[] | undefined,
  fallback: number,
  index: number,
): number {
  return schedule?.[index] ?? fallback;
}

export type AnnualTransientRotationChannel = "optical" | "convection";

/**
 * Reconstructs the exact phase at an original weather-boundary index. This is
 * intentionally a sequential sum: checkpointed segments therefore start from
 * the same floating-point phase that a monolithic run reaches, including an
 * arbitrary per-weather-interval RPM schedule.
 */
export function annualTransientPhaseAtInterval(
  input: AnnualTransientSurfaceInput,
  intervalIndex: number,
  channel: AnnualTransientRotationChannel,
): number {
  if (!Number.isInteger(intervalIndex)
    || intervalIndex < 0 || intervalIndex >= input.weather.length) {
    throw new RangeError("Phase checkpoint index must identify a weather boundary.");
  }
  const optical = channel === "optical";
  let phaseRad = optical
    ? (input.initialOpticalPhaseRad ?? input.initialPhaseRad ?? 0)
    : (input.initialConvectionPhaseRad ?? input.initialPhaseRad ?? 0);
  const schedule = optical
    ? (input.opticalRpmByWeatherStep ?? input.rpmByWeatherStep)
    : (input.convectionRpmByWeatherStep ?? input.rpmByWeatherStep);
  const fallback = optical ? (input.opticalRpm ?? input.rpm) : (input.convectionRpm ?? input.rpm);
  for (let index = 0; index < intervalIndex; index += 1) {
    const durationSeconds = (input.weather[index + 1].timeUtcMs
      - input.weather[index].timeUtcMs) / 1_000;
    phaseRad += scheduleValue(schedule, fallback, index) * TWO_PI / 60 * durationSeconds;
  }
  return phaseRad;
}

function monthKey(timeMs: number, offsetMinutes: number): string {
  const date = new Date(timeMs + offsetMinutes * 60_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonthlyInterval(
  monthly: Map<string, Omit<AnnualTransientMonthEnergy, "month">>,
  startTimeMs: number,
  endTimeMs: number,
  offsetMinutes: number,
  energy: Omit<AnnualTransientMonthEnergy, "month">,
): void {
  const totalMs = endTimeMs - startTimeMs;
  let segmentStart = startTimeMs;
  while (segmentStart < endTimeMs) {
    const shifted = new Date(segmentStart + offsetMinutes * 60_000);
    const nextShiftedMonthMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1);
    const segmentEnd = Math.min(endTimeMs, nextShiftedMonthMs - offsetMinutes * 60_000);
    const fraction = (segmentEnd - segmentStart) / totalMs;
    const key = monthKey(segmentStart, offsetMinutes);
    const accumulator = monthly.get(key) ?? {
      dcEnergyWh: 0,
      idealLocalMppDcEnergyWh: 0,
      mismatchAndWiringLossEnergyWh: 0,
      grossAcEnergyWh: 0,
      acEnergyWh: 0,
      motorEnergyWh: 0,
      absorbedSolarEnergyWh: 0,
      bypassActivationDeviceHours: 0,
    };
    accumulator.dcEnergyWh += energy.dcEnergyWh * fraction;
    accumulator.idealLocalMppDcEnergyWh += energy.idealLocalMppDcEnergyWh * fraction;
    accumulator.mismatchAndWiringLossEnergyWh += energy.mismatchAndWiringLossEnergyWh * fraction;
    accumulator.grossAcEnergyWh += energy.grossAcEnergyWh * fraction;
    accumulator.acEnergyWh += energy.acEnergyWh * fraction;
    accumulator.motorEnergyWh += energy.motorEnergyWh * fraction;
    accumulator.absorbedSolarEnergyWh += energy.absorbedSolarEnergyWh * fraction;
    accumulator.bypassActivationDeviceHours += energy.bypassActivationDeviceHours * fraction;
    monthly.set(key, accumulator);
    segmentStart = segmentEnd;
  }
}

interface ResolvedThermalConfig extends MaterialThermalConfig {
  radiativeSurfaceFactor: number;
}

function resolvedThermalConfig(input: AnnualTransientSurfaceInput): ResolvedThermalConfig {
  const config = {
    ...DEFAULT_TRANSIENT_THERMAL_CONFIG,
    ...input.thermalConfig,
    air: { ...DEFAULT_TRANSIENT_THERMAL_CONFIG.air, ...input.thermalConfig?.air },
    // A laminate exchanges longwave radiation from both exposed faces.
    radiativeSurfaceFactor: input.radiativeSurfaceFactor ?? 2,
  };
  positiveFinite(config.arealHeatCapacityJm2K, "Areal heat capacity");
  positiveFinite(config.maximumSubstepSeconds, "Maximum thermal substep");
  if (!Number.isFinite(config.radiativeSurfaceFactor) || config.radiativeSurfaceFactor < 0) {
    throw new RangeError("Radiative surface factor must be nonnegative.");
  }
  return config;
}

interface RunAccumulators {
  dcEnergyWh: number;
  idealLocalMppDcEnergyWh: number;
  mismatchAndWiringLossEnergyWh: number;
  grossAcEnergyWh: number;
  acEnergyWh: number;
  motorEnergyWh: number;
  absorbedSolarEnergyWh: number;
  bypassActivationDeviceHours: number;
  circuitSolveCount: number;
  maximumElectricalExtractionClosureErrorW: number;
  temperatureIntegralCSeconds: number;
  durationSeconds: number;
  maximumTemperatureC: number;
  minimumTemperatureC: number;
  storedEnergyChangeJ: number;
  netBoundaryEnergyJ: number;
  conductionCancellationJ: number;
}

function emptyAccumulators(nodes: readonly MaterialThermalNode[]): RunAccumulators {
  return {
    dcEnergyWh: 0,
    idealLocalMppDcEnergyWh: 0,
    mismatchAndWiringLossEnergyWh: 0,
    grossAcEnergyWh: 0,
    acEnergyWh: 0,
    motorEnergyWh: 0,
    absorbedSolarEnergyWh: 0,
    bypassActivationDeviceHours: 0,
    circuitSolveCount: 0,
    maximumElectricalExtractionClosureErrorW: 0,
    temperatureIntegralCSeconds: 0,
    durationSeconds: 0,
    maximumTemperatureC: Math.max(...nodes.map((node) => node.temperatureC)),
    minimumTemperatureC: Math.min(...nodes.map((node) => node.temperatureC)),
    storedEnergyChangeJ: 0,
    netBoundaryEnergyJ: 0,
    conductionCancellationJ: 0,
  };
}

interface AnnualEngineeringLayoutContext {
  layout: EngineeringSurfaceCellLayout;
  maximumCouplingStepSeconds: number;
}

function createAnnualEngineeringLayoutContext(
  input: AnnualTransientSurfaceInput,
  mesh: AnnualReducedThermalMesh,
): AnnualEngineeringLayoutContext | undefined {
  const engineering = input.engineeringElectrical;
  if (engineering === undefined) return undefined;
  const layoutSamples = Object.values(mesh.opticalSamplesByNodeId).flat().map((sample) => ({
    id: sample.id,
    areaM2: sample.areaM2,
    zoneId: sample.zoneId,
    zoneIndex: sample.zoneIndex,
    u: sample.u,
    v: sample.v,
    positionM: sample.bodyPositionM,
  }));
  const layout = createEngineeringSurfaceCellLayout(
    layoutSamples,
    engineering.connection,
    engineering.referenceCell.areaM2,
  );
  if (Math.abs(layout.activeAreaM2 - input.surface.dimensions.activeAreaM2)
    > Math.max(1e-10, input.surface.dimensions.activeAreaM2 * 1e-8)) {
    throw new RangeError("Engineering cell layout area does not close to the PV skin area.");
  }
  return {
    layout,
    maximumCouplingStepSeconds: engineering.maximumCouplingStepSeconds
      ?? DEFAULT_ENGINEERING_CIRCUIT_COUPLING_SECONDS,
  };
}

interface IntervalContext {
  left: WeatherPoint;
  right: WeatherPoint;
  opticalRpm: number;
  convectionRpm: number;
  motorRpm: number;
  opticalPhaseRad: number;
  convectionPhaseRad: number;
}

interface ActiveEngineeringCircuitState {
  dcPowerW: number;
  idealLocalMppDcPowerW: number;
  mismatchAndWiringLossW: number;
  grossAcPowerW: number;
  bypassActiveCount: number;
  electricalExtractionWByNode: readonly number[];
  phaseSolveCount: number;
  maximumExtractionClosureErrorW: number;
}

interface EffectivePoaPhase {
  weight: number;
  poaBySampleId: Readonly<Record<string, number>>;
}

function integrateThermalInterval(
  input: AnnualTransientSurfaceInput,
  mesh: AnnualReducedThermalMesh,
  engineeringLayout: AnnualEngineeringLayoutContext | undefined,
  nodes: MaterialThermalNode[],
  context: IntervalContext,
  config: ResolvedThermalConfig,
  accumulators: RunAccumulators,
  monthly?: Map<string, Omit<AnnualTransientMonthEnergy, "month">>,
  reportingOffsetMinutes = 0,
): void {
  const durationSeconds = (context.right.timeUtcMs - context.left.timeUtcMs) / 1_000;
  const midpointTimeMs = (context.left.timeUtcMs + context.right.timeUtcMs) / 2;
  const mean = (left: number, right: number) => (left + right) / 2;
  const ambientC = mean(context.left.ambientC, context.right.ambientC);
  const skyC = ambientC + (input.effectiveSkyTemperatureOffsetC ?? -6);
  const skyK = skyC + 273.15;
  if (!(skyK > 0)) throw new RangeError("Effective sky temperature must exceed absolute zero.");
  const weather = {
    ghiWm2: mean(context.left.ghiWm2, context.right.ghiWm2),
    dniWm2: mean(context.left.dniWm2, context.right.dniWm2),
    dhiWm2: mean(context.left.dhiWm2, context.right.dhiWm2),
  };
  const solar = solarPosition({ timestamp: midpointTimeMs, ...input.location, temperatureC: ambientC });
  const solarVector = sunVector(solar);
  const leftWind = windVelocity(context.left);
  const rightWind = windVelocity(context.right);
  const wind: Vec3 = {
    x: mean(leftWind.x, rightWind.x),
    y: 0,
    z: mean(leftWind.z, rightWind.z),
  };
  const opticalOmega = context.opticalRpm * TWO_PI / 60;
  const convectionOmega = context.convectionRpm * TWO_PI / 60;
  const opticalPhases = phaseSamples(
    context.opticalPhaseRad,
    opticalOmega,
    durationSeconds,
    input.opticalPhaseSamples ?? 12,
  );
  const convectionPhases = phaseSamples(
    context.convectionPhaseRad,
    convectionOmega,
    durationSeconds,
    input.convectionPhaseSamples ?? 12,
  );
  const albedo = clamp(input.albedo ?? 0.2, 0, 1);
  const soilingFactor = 1 - clamp(input.soilingLossFraction ?? 0, 0, 1);
  const absorptivity = clamp(input.absorptivity ?? 0.9, 0, 1);
  const electricalAvailabilityFactor = input.electricalAvailabilityFactor ?? 1;
  const opticalSamples = nodes.flatMap((node, nodeIndex) =>
    mesh.opticalSamplesByNodeId[node.id].map((sample) => ({ sample, nodeIndex })));
  const thermalNodeIndexBySampleId = new Map(
    opticalSamples.map(({ sample, nodeIndex }) => [sample.id, nodeIndex]),
  );
  if (thermalNodeIndexBySampleId.size !== mesh.opticalSampleCount) {
    throw new RangeError("Annual optical sample IDs must be unique and complete.");
  }
  // Preserve the optical phase distribution through the nonlinear circuit.
  // Only the thermal absorption path uses a phase-weighted POA average.
  const effectivePoaByPhase: EffectivePoaPhase[] = opticalPhases.map((phase) => {
    const poaBySampleId: Record<string, number> = {};
    opticalSamples.forEach(({ sample }) => {
      const normal = materialPoseAtWorldYPhase({
        bodyPositionM: sample.bodyPositionM,
        bodyNormal: sample.bodyNormal,
      }, phase.angleRad).normal;
      poaBySampleId[sample.id] = solar.elevationDeg <= 0
        ? 0
        : calculatePOA({
            ghiWm2: weather.ghiWm2,
            dniWm2: weather.dniWm2,
            dhiWm2: weather.dhiWm2,
            solarZenithDeg: 90 - solar.elevationDeg,
            sunDirection: solarVector,
            panelNormal: normal,
            albedo,
            iam: input.iam ?? { model: "ashrae", b0: 0.05 },
            diffuseModel: input.diffuseModel ?? "hay-davies",
          }).totalWm2 * soilingFactor;
    });
    return { weight: phase.weight, poaBySampleId };
  });
  const phaseWeightSum = effectivePoaByPhase.reduce((sum, phase) => sum + phase.weight, 0);
  if (Math.abs(phaseWeightSum - 1) > 1e-10) {
    throw new RangeError("Optical phase quadrature weights must close to one.");
  }
  const effectivePoaBySampleId: Record<string, number> = {};
  opticalSamples.forEach(({ sample }) => {
    effectivePoaBySampleId[sample.id] = effectivePoaByPhase.reduce(
      (sum, phase) => sum + phase.weight * phase.poaBySampleId[sample.id],
      0,
    );
  });
  const effectivePoaByNode = nodes.map((node) => mesh.opticalSamplesByNodeId[node.id].reduce(
    (sum, sample) => sum + effectivePoaBySampleId[sample.id] * sample.areaM2,
    0,
  ) / node.areaM2);
  const frontHByNode = nodes.map((node) => {
    const samples = mesh.opticalSamplesByNodeId[node.id];
    return convectionPhases.reduce((sum, phase) => sum + phase.weight
      * calculateAreaWeightedNodeConvection(
        node,
        samples,
        phase.angleRad,
        convectionOmega,
        wind,
        config.minimumConvectionWm2K,
        config.air,
      ).coefficientWm2K, 0);
  });
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const conductanceByNode = Array(nodes.length).fill(0) as number[];
  mesh.edges.forEach((edge) => {
    conductanceByNode[indexById.get(edge.firstNodeId)!] += edge.conductanceWPerK;
    conductanceByNode[indexById.get(edge.secondNodeId)!] += edge.conductanceWPerK;
  });
  let stableSeconds = config.maximumSubstepSeconds;
  nodes.forEach((node, index) => {
    const hAreaWPerK = frontHByNode[index] * (1 + config.backConvectionFactor) * node.areaM2;
    const capacityJPerK = config.arealHeatCapacityJm2K * node.areaM2;
    stableSeconds = Math.min(
      stableSeconds,
      0.2 * capacityJPerK / Math.max(1e-12, hAreaWPerK + conductanceByNode[index]),
    );
  });
  stableSeconds = Math.max(1e-3, stableSeconds);
  const initialTemperatures = nodes.map((node) => node.temperatureC);
  let intervalDcWh = 0;
  let intervalIdealLocalMppDcWh = 0;
  let intervalMismatchAndWiringLossWh = 0;
  let intervalGrossAcWh = 0;
  let intervalAcWh = 0;
  let intervalMotorWh = 0;
  let intervalAbsorbedWh = 0;
  let intervalBypassActivationDeviceHours = 0;
  let intervalBoundaryJ = 0;
  let intervalConductionCancellationJ = 0;
  let elapsedSeconds = 0;
  let nextCircuitSolveSeconds = 0;
  let activeEngineeringState: ActiveEngineeringCircuitState | undefined;
  const motorPowerW = input.motorDrive === undefined
    ? 0
    : motorDrivePowerW({ ...input.motorDrive, rpm: context.motorRpm });
  while (elapsedSeconds < durationSeconds - 1e-12) {
    if (engineeringLayout !== undefined
      && (activeEngineeringState === undefined
        || elapsedSeconds >= nextCircuitSolveSeconds - 1e-12)) {
      const extractionWByNode = Array(nodes.length).fill(0) as number[];
      let dcPowerW = 0;
      let idealLocalMppDcPowerW = 0;
      let mismatchAndWiringLossW = 0;
      let grossAcPowerW = 0;
      let bypassActiveCount = 0;
      let phaseSolveCount = 0;
      let maximumExtractionClosureErrorW = 0;
      effectivePoaByPhase.forEach((phase) => {
        const phaseHasElectricalInput = opticalSamples.some(({ sample }) =>
          phase.poaBySampleId[sample.id] * electricalAvailabilityFactor > 1e-12);
        if (!phaseHasElectricalInput) return;
        const electricalSamples: EngineeringSurfaceElectricalSample[] = opticalSamples.map(
          ({ sample, nodeIndex }) => ({
            id: sample.id,
            areaM2: sample.areaM2,
            zoneId: sample.zoneId,
            zoneIndex: sample.zoneIndex,
            u: sample.u,
            v: sample.v,
            positionM: sample.bodyPositionM,
            poaWm2: phase.poaBySampleId[sample.id] * electricalAvailabilityFactor,
            cellTemperatureC: nodes[nodeIndex].temperatureC,
          }),
        );
        const result = solveEngineeringSurfaceElectrical(
          electricalSamples,
          input.engineeringElectrical!.referenceCell,
          input.engineeringElectrical!.connection,
          engineeringLayout.layout,
        );
        phaseSolveCount += 1;
        if (result.layoutId !== engineeringLayout.layout.layoutId) {
          throw new RangeError("Engineering circuit changed its immutable layout between optical phases.");
        }
        const extractionSumW = Object.values(result.electricalExtractionWBySampleId)
          .reduce((sum, value) => sum + value, 0);
        maximumExtractionClosureErrorW = Math.max(
          maximumExtractionClosureErrorW,
          Math.abs(extractionSumW - result.dcPowerW),
        );
        Object.entries(result.electricalExtractionWBySampleId).forEach(([sampleId, powerW]) => {
          const nodeIndex = thermalNodeIndexBySampleId.get(sampleId);
          if (nodeIndex === undefined) {
            throw new RangeError(`Engineering extraction references unknown sample ${sampleId}.`);
          }
          extractionWByNode[nodeIndex] += phase.weight * powerW;
        });
        dcPowerW += phase.weight * result.dcPowerW;
        idealLocalMppDcPowerW += phase.weight * result.idealLocalMppDcPowerW;
        mismatchAndWiringLossW += phase.weight * result.mismatchAndWiringLossW;
        bypassActiveCount += phase.weight * result.bypassActiveCount;
        grossAcPowerW += phase.weight * (input.inverter === false
          ? result.dcPowerW
          : calculateInverter({
              dcPowerW: result.dcPowerW,
              dcVoltageV: result.dcVoltageV,
              dcCurrentA: result.dcCurrentA,
              ...(input.inverter === undefined ? {} : { config: input.inverter }),
            }).acPowerW);
      });
      const weightedExtractionSumW = extractionWByNode.reduce((sum, value) => sum + value, 0);
      maximumExtractionClosureErrorW = Math.max(
        maximumExtractionClosureErrorW,
        Math.abs(weightedExtractionSumW - dcPowerW),
      );
      activeEngineeringState = {
        dcPowerW,
        idealLocalMppDcPowerW,
        mismatchAndWiringLossW,
        grossAcPowerW,
        bypassActiveCount,
        electricalExtractionWByNode: extractionWByNode,
        phaseSolveCount,
        maximumExtractionClosureErrorW,
      };
      accumulators.circuitSolveCount += phaseSolveCount;
      accumulators.maximumElectricalExtractionClosureErrorW = Math.max(
        accumulators.maximumElectricalExtractionClosureErrorW,
        maximumExtractionClosureErrorW,
      );
      nextCircuitSolveSeconds = Math.min(
        durationSeconds,
        elapsedSeconds + engineeringLayout.maximumCouplingStepSeconds,
      );
    }
    let dt = Math.min(stableSeconds, durationSeconds - elapsedSeconds);
    if (engineeringLayout !== undefined
      && nextCircuitSolveSeconds > elapsedSeconds + 1e-12) {
      dt = Math.min(dt, nextCircuitSolveSeconds - elapsedSeconds);
    }
    const conductionW = Array(nodes.length).fill(0) as number[];
    mesh.edges.forEach((edge) => {
      const first = indexById.get(edge.firstNodeId)!;
      const second = indexById.get(edge.secondNodeId)!;
      const intoFirstW = edge.conductanceWPerK
        * (nodes[second].temperatureC - nodes[first].temperatureC);
      conductionW[first] += intoFirstW;
      conductionW[second] -= intoFirstW;
    });
    intervalConductionCancellationJ += conductionW.reduce((sum, value) => sum + value, 0) * dt;
    const localExtractionWByNode = nodes.map((node, index) => {
      const effectivePoaWm2 = effectivePoaByNode[index];
      return Math.min(
        absorptivity * effectivePoaWm2,
        effectivePoaWm2 * electricalAvailabilityFactor * temperatureAdjustedEfficiency(
          input.referenceEfficiency,
          input.gammaPerC,
          node.temperatureC,
          input.referenceTemperatureC ?? 25,
        ),
      ) * node.areaM2;
    });
    const electricalExtractionWByNode = engineeringLayout === undefined
      ? localExtractionWByNode
      : activeEngineeringState!.electricalExtractionWByNode;
    const dcPowerW = engineeringLayout === undefined
      ? localExtractionWByNode.reduce((sum, value) => sum + value, 0)
      : activeEngineeringState!.dcPowerW;
    const idealLocalMppDcPowerW = engineeringLayout === undefined
      ? dcPowerW
      : activeEngineeringState!.idealLocalMppDcPowerW;
    const mismatchAndWiringLossW = engineeringLayout === undefined
      ? 0
      : activeEngineeringState!.mismatchAndWiringLossW;
    const grossAcPowerW = engineeringLayout === undefined
      ? (input.inverter === false
          ? dcPowerW
          : calculateInverter({
              dcPowerW,
              ...(input.inverter === undefined ? {} : { config: input.inverter }),
            }).acPowerW)
      : activeEngineeringState!.grossAcPowerW;
    const bypassActiveCount = engineeringLayout === undefined
      ? 0
      : activeEngineeringState!.bypassActiveCount;
    let absorbedPowerW = 0;
    let boundaryPowerW = 0;
    const nextTemperatures = nodes.map((node, index) => {
      const effectivePoaWm2 = effectivePoaByNode[index];
      const absorbedWm2 = absorptivity * effectivePoaWm2;
      const frontConvectionWm2 = frontHByNode[index] * (node.temperatureC - ambientC);
      const backConvectionWm2 = frontHByNode[index] * config.backConvectionFactor
        * (node.temperatureC - ambientC);
      const temperatureK = node.temperatureC + 273.15;
      if (!(temperatureK > 0)) throw new RangeError("Material temperature must exceed absolute zero.");
      const longwaveWm2 = config.radiativeSurfaceFactor * config.emissivity
        * STEFAN_BOLTZMANN_W_M2_K4 * (temperatureK ** 4 - skyK ** 4);
      const boundaryW = absorbedWm2 * node.areaM2 - electricalExtractionWByNode[index]
        - (frontConvectionWm2 + backConvectionWm2 + longwaveWm2) * node.areaM2;
      const netW = boundaryW + conductionW[index];
      const nextTemperatureC = node.temperatureC
        + netW * dt / (config.arealHeatCapacityJm2K * node.areaM2);
      if (!Number.isFinite(nextTemperatureC)
        || nextTemperatureC < config.minimumTemperatureC
        || nextTemperatureC > config.maximumTemperatureC) {
        throw new RangeError(`${node.id} temperature left the configured physical range.`);
      }
      absorbedPowerW += absorbedWm2 * node.areaM2;
      boundaryPowerW += boundaryW;
      return nextTemperatureC;
    });
    const acPowerW = Math.max(0, grossAcPowerW - motorPowerW);
    intervalDcWh += dcPowerW * dt / 3_600;
    intervalIdealLocalMppDcWh += idealLocalMppDcPowerW * dt / 3_600;
    intervalMismatchAndWiringLossWh += mismatchAndWiringLossW * dt / 3_600;
    intervalGrossAcWh += grossAcPowerW * dt / 3_600;
    intervalAcWh += acPowerW * dt / 3_600;
    intervalMotorWh += motorPowerW * dt / 3_600;
    intervalAbsorbedWh += absorbedPowerW * dt / 3_600;
    intervalBypassActivationDeviceHours += bypassActiveCount * dt / 3_600;
    intervalBoundaryJ += boundaryPowerW * dt;
    if (monthly !== undefined) {
      addMonthlyInterval(
        monthly,
        context.left.timeUtcMs + elapsedSeconds * 1_000,
        context.left.timeUtcMs + (elapsedSeconds + dt) * 1_000,
        reportingOffsetMinutes,
        {
          dcEnergyWh: dcPowerW * dt / 3_600,
          idealLocalMppDcEnergyWh: idealLocalMppDcPowerW * dt / 3_600,
          mismatchAndWiringLossEnergyWh: mismatchAndWiringLossW * dt / 3_600,
          grossAcEnergyWh: grossAcPowerW * dt / 3_600,
          acEnergyWh: acPowerW * dt / 3_600,
          motorEnergyWh: motorPowerW * dt / 3_600,
          absorbedSolarEnergyWh: absorbedPowerW * dt / 3_600,
          bypassActivationDeviceHours: bypassActiveCount * dt / 3_600,
        },
      );
    }
    nextTemperatures.forEach((temperatureC, index) => {
      nodes[index].temperatureC = temperatureC;
      accumulators.maximumTemperatureC = Math.max(accumulators.maximumTemperatureC, temperatureC);
      accumulators.minimumTemperatureC = Math.min(accumulators.minimumTemperatureC, temperatureC);
    });
    const areaM2 = nodes.reduce((sum, node) => sum + node.areaM2, 0);
    const averageTemperatureC = nodes.reduce(
      (sum, node) => sum + node.temperatureC * node.areaM2,
      0,
    ) / areaM2;
    accumulators.temperatureIntegralCSeconds += averageTemperatureC * dt;
    accumulators.durationSeconds += dt;
    elapsedSeconds += dt;
  }
  const storedJ = nodes.reduce((sum, node, index) => sum
    + (node.temperatureC - initialTemperatures[index])
      * config.arealHeatCapacityJm2K * node.areaM2, 0);
  accumulators.dcEnergyWh += intervalDcWh;
  accumulators.idealLocalMppDcEnergyWh += intervalIdealLocalMppDcWh;
  accumulators.mismatchAndWiringLossEnergyWh += intervalMismatchAndWiringLossWh;
  accumulators.grossAcEnergyWh += intervalGrossAcWh;
  accumulators.acEnergyWh += intervalAcWh;
  accumulators.motorEnergyWh += intervalMotorWh;
  accumulators.absorbedSolarEnergyWh += intervalAbsorbedWh;
  accumulators.bypassActivationDeviceHours += intervalBypassActivationDeviceHours;
  accumulators.storedEnergyChangeJ += storedJ;
  accumulators.netBoundaryEnergyJ += intervalBoundaryJ;
  accumulators.conductionCancellationJ += intervalConductionCancellationJ;
}

interface PeriodRunResult {
  opticalPhaseRad: number;
  convectionPhaseRad: number;
}

function runIntervals(
  input: AnnualTransientSurfaceInput,
  mesh: AnnualReducedThermalMesh,
  engineeringLayout: AnnualEngineeringLayoutContext | undefined,
  nodes: MaterialThermalNode[],
  firstInterval: number,
  lastIntervalExclusive: number,
  initialOpticalPhaseRad: number,
  initialConvectionPhaseRad: number,
  config: ResolvedThermalConfig,
  accumulators: RunAccumulators,
  monthly?: Map<string, Omit<AnnualTransientMonthEnergy, "month">>,
): PeriodRunResult {
  let opticalPhaseRad = initialOpticalPhaseRad;
  let convectionPhaseRad = initialConvectionPhaseRad;
  const offsetMinutes = input.reportingOffsetMinutes ?? 0;
  for (let index = firstInterval; index < lastIntervalExclusive; index += 1) {
    const opticalRpm = scheduleValue(
      input.opticalRpmByWeatherStep ?? input.rpmByWeatherStep,
      input.opticalRpm ?? input.rpm,
      index,
    );
    const convectionRpm = scheduleValue(
      input.convectionRpmByWeatherStep ?? input.rpmByWeatherStep,
      input.convectionRpm ?? input.rpm,
      index,
    );
    const motorRpm = scheduleValue(
      input.motorRpmByWeatherStep ?? input.rpmByWeatherStep,
      input.motorRpm ?? input.rpm,
      index,
    );
    const left = input.weather[index];
    const right = input.weather[index + 1];
    integrateThermalInterval(
      input,
      mesh,
      engineeringLayout,
      nodes,
      {
        left,
        right,
        opticalRpm,
        convectionRpm,
        motorRpm,
        opticalPhaseRad,
        convectionPhaseRad,
      },
      config,
      accumulators,
      monthly,
      offsetMinutes,
    );
    const durationSeconds = (right.timeUtcMs - left.timeUtcMs) / 1_000;
    opticalPhaseRad += opticalRpm * TWO_PI / 60 * durationSeconds;
    convectionPhaseRad += convectionRpm * TWO_PI / 60 * durationSeconds;
  }
  return { opticalPhaseRad, convectionPhaseRad };
}

export function simulateAnnualTransientSurface(
  input: AnnualTransientSurfaceInput,
): AnnualTransientSurfaceResult {
  validateAnnualInput(input);
  const initialTemperatureC = input.initialTemperatureC ?? input.weather[0].ambientC;
  const mesh = createAnnualReducedThermalMesh(input.surface, initialTemperatureC, input.thermalMesh);
  const engineeringLayout = createAnnualEngineeringLayoutContext(input, mesh);
  const checkpointTemperatures = input.initialTemperatureCByNode;
  if (checkpointTemperatures !== undefined) {
    const nodeIds = new Set(mesh.nodes.map((node) => node.id));
    const checkpointIds = Object.keys(checkpointTemperatures);
    if (checkpointIds.length !== nodeIds.size
      || checkpointIds.some((nodeId) => !nodeIds.has(nodeId))
      || mesh.nodes.some((node) => checkpointTemperatures[node.id] === undefined)) {
      throw new RangeError(
        "Initial thermal checkpoint keys must exactly match the deterministic reduced-node mesh.",
      );
    }
    if (Object.values(checkpointTemperatures).some((temperatureC) => !Number.isFinite(temperatureC))) {
      throw new RangeError("Initial thermal checkpoint temperatures must be finite.");
    }
  }
  const nodes = mesh.nodes.map((node) => ({
    ...node,
    temperatureC: checkpointTemperatures?.[node.id] ?? node.temperatureC,
  }));
  const config = resolvedThermalConfig(input);
  const warmupConfig = input.warmup === false
    ? undefined
    : { ...DEFAULT_ANNUAL_TRANSIENT_WARMUP, ...input.warmup };
  let warmupCycles = 0;
  let warmupConverged = warmupConfig === undefined;
  let terminalMaximumDeltaC = 0;
  if (warmupConfig) {
    positiveFinite(warmupConfig.periodHours, "Warm-up period");
    positiveFinite(warmupConfig.convergenceToleranceC, "Warm-up convergence tolerance");
    if (!Number.isInteger(warmupConfig.minimumCycles) || warmupConfig.minimumCycles < 1
      || !Number.isInteger(warmupConfig.maximumCycles)
      || warmupConfig.maximumCycles < warmupConfig.minimumCycles) {
      throw new RangeError("Warm-up cycle limits are invalid.");
    }
    const warmupEndMs = input.weather[0].timeUtcMs + warmupConfig.periodHours * 3_600_000;
    let warmupIntervals = 0;
    while (warmupIntervals < input.weather.length - 1
      && input.weather[warmupIntervals + 1].timeUtcMs <= warmupEndMs) {
      warmupIntervals += 1;
    }
    if (warmupIntervals < 1) throw new RangeError("Warm-up period contains no complete weather interval.");
    for (let cycle = 1; cycle <= warmupConfig.maximumCycles; cycle += 1) {
      const before = nodes.map((node) => node.temperatureC);
      const warmupAccumulators = emptyAccumulators(nodes);
      // Repeat exactly the same first-period forcing and phase each cycle;
      // only T is carried. Otherwise a non-integer turn per period changes
      // the boundary condition and terminal dT is not a periodic criterion.
      runIntervals(
        input,
        mesh,
        engineeringLayout,
        nodes,
        0,
        warmupIntervals,
        input.initialOpticalPhaseRad ?? input.initialPhaseRad ?? 0,
        input.initialConvectionPhaseRad ?? input.initialPhaseRad ?? 0,
        config,
        warmupAccumulators,
      );
      terminalMaximumDeltaC = Math.max(...nodes.map(
        (node, index) => Math.abs(node.temperatureC - before[index]),
      ));
      warmupCycles = cycle;
      if (cycle >= warmupConfig.minimumCycles
        && terminalMaximumDeltaC <= warmupConfig.convergenceToleranceC) {
        warmupConverged = true;
        break;
      }
    }
  }
  const integrationInitialTemperatureCByNode = Object.fromEntries(
    nodes.map((node) => [node.id, node.temperatureC]),
  );
  const accumulators = emptyAccumulators(nodes);
  const monthly = new Map<string, Omit<AnnualTransientMonthEnergy, "month">>();
  const terminalPhases = runIntervals(
    input,
    mesh,
    engineeringLayout,
    nodes,
    0,
    input.weather.length - 1,
    input.initialOpticalPhaseRad ?? input.initialPhaseRad ?? 0,
    input.initialConvectionPhaseRad ?? input.initialPhaseRad ?? 0,
    config,
    accumulators,
    monthly,
  );
  const energyResidualJ = accumulators.storedEnergyChangeJ
    - accumulators.netBoundaryEnergyJ - accumulators.conductionCancellationJ;
  return {
    thermalModel: thermalModelMetadata("annual-transient-material-state"),
    electricalModel: engineeringLayout === undefined
      ? "local-mpp-area-integral"
      : "explicit-series-parallel-bypass",
    electricalLayoutId: engineeringLayout?.layout.layoutId ?? "local-mpp-no-cell-layout",
    dcEnergyWh: accumulators.dcEnergyWh,
    idealLocalMppDcEnergyWh: accumulators.idealLocalMppDcEnergyWh,
    mismatchAndWiringLossEnergyWh: accumulators.mismatchAndWiringLossEnergyWh,
    grossAcEnergyWh: accumulators.grossAcEnergyWh,
    acEnergyWh: accumulators.acEnergyWh,
    motorEnergyWh: accumulators.motorEnergyWh,
    absorbedSolarEnergyWh: accumulators.absorbedSolarEnergyWh,
    bypassActivationDeviceHours: accumulators.bypassActivationDeviceHours,
    inverterLossWh: Math.max(0, accumulators.dcEnergyWh - accumulators.grossAcEnergyWh),
    ...(engineeringLayout === undefined ? {} : {
      engineeringCircuit: {
        cellCount: engineeringLayout.layout.cells.length,
        parallelStringCount: engineeringLayout.layout.parallelStringCount,
        seriesCellCountByString: engineeringLayout.layout.seriesCellCountByString,
        bypassSubstringCount: engineeringLayout.layout.bypassSubstringCount,
        maximumCouplingStepSeconds: engineeringLayout.maximumCouplingStepSeconds,
        circuitSolveCount: accumulators.circuitSolveCount,
        maximumElectricalExtractionClosureErrorW:
          accumulators.maximumElectricalExtractionClosureErrorW,
      },
    }),
    monthly: [...monthly.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, energy]) => ({ month, ...energy })),
    averageTemperatureC: accumulators.temperatureIntegralCSeconds
      / Math.max(1e-12, accumulators.durationSeconds),
    maximumTemperatureC: accumulators.maximumTemperatureC,
    minimumTemperatureC: accumulators.minimumTemperatureC,
    initialTemperatureCByNode: integrationInitialTemperatureCByNode,
    initialOpticalPhaseRad: input.initialOpticalPhaseRad ?? input.initialPhaseRad ?? 0,
    initialConvectionPhaseRad: input.initialConvectionPhaseRad ?? input.initialPhaseRad ?? 0,
    finalTemperatureCByNode: Object.fromEntries(nodes.map((node) => [node.id, node.temperatureC])),
    terminalOpticalPhaseRad: terminalPhases.opticalPhaseRad,
    terminalConvectionPhaseRad: terminalPhases.convectionPhaseRad,
    coverage: calendarCoverage(input.weather, input.reportingOffsetMinutes ?? 0),
    warmup: {
      enabled: warmupConfig !== undefined,
      cycles: warmupCycles,
      converged: warmupConverged,
      terminalMaximumDeltaC,
      toleranceC: warmupConfig?.convergenceToleranceC ?? 0,
      periodHours: warmupConfig?.periodHours ?? 0,
    },
    mesh: {
      opticalSampleCount: mesh.opticalSampleCount,
      requestedThermalNodeCount: mesh.requestedThermalNodeCount,
      thermalNodeCount: mesh.thermalNodeCount,
      conductionModel: mesh.conductionModel,
      inPlaneThermalConductivityWmK: mesh.inPlaneThermalConductivityWmK,
      laminateThicknessM: mesh.laminateThicknessM,
      neighboursPerNode: mesh.neighboursPerNode,
      edgeCount: mesh.edges.length,
    },
    energyAudit: {
      storedEnergyChangeJ: accumulators.storedEnergyChangeJ,
      netBoundaryEnergyJ: accumulators.netBoundaryEnergyJ,
      conductionCancellationJ: accumulators.conductionCancellationJ,
      energyResidualJ,
      relativeEnergyResidual: Math.abs(energyResidualJ)
        / Math.max(1, Math.abs(accumulators.netBoundaryEnergyJ)),
    },
  };
}

const MONTH_ENERGY_FIELDS = Object.freeze([
  "dcEnergyWh",
  "idealLocalMppDcEnergyWh",
  "mismatchAndWiringLossEnergyWh",
  "grossAcEnergyWh",
  "acEnergyWh",
  "motorEnergyWh",
  "absorbedSolarEnergyWh",
  "bypassActivationDeviceHours",
] as const satisfies readonly (Exclude<keyof AnnualTransientMonthEnergy, "month">)[]);

/**
 * Conservatively merges contiguous checkpoint segments. Energy and circuit
 * counts are additive, temperature means are duration-weighted, extrema are
 * enveloped, stored/boundary/conduction terms are summed, and the residual is
 * recomputed from the merged balance. Only the first segment may warm up.
 */
export function mergeAnnualTransientSurfaceSegments(
  segments: readonly AnnualTransientSurfaceResult[],
  completeWeather: readonly WeatherPoint[],
  reportingOffsetMinutes = 0,
): AnnualTransientSurfaceResult {
  if (segments.length < 1) throw new RangeError("At least one transient segment is required.");
  if (completeWeather.length < 2) throw new RangeError("Complete weather requires a closing endpoint.");
  const first = segments[0];
  const last = segments.at(-1)!;
  const invariant = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  for (const [index, segment] of segments.entries()) {
    if (segment.electricalModel !== first.electricalModel
      || segment.electricalLayoutId !== first.electricalLayoutId
      || !invariant(segment.thermalModel, first.thermalModel)
      || !invariant(segment.mesh, first.mesh)
      || !invariant(segment.engineeringCircuit === undefined ? undefined : {
        ...segment.engineeringCircuit,
        circuitSolveCount: 0,
        maximumElectricalExtractionClosureErrorW: 0,
      }, first.engineeringCircuit === undefined ? undefined : {
        ...first.engineeringCircuit,
        circuitSolveCount: 0,
        maximumElectricalExtractionClosureErrorW: 0,
      })) {
      throw new RangeError("Transient segments must share one thermal mesh and electrical topology.");
    }
    if (index > 0 && (segment.warmup.enabled || !segment.warmup.converged)) {
      throw new RangeError("Only the first transient segment may perform warm-up.");
    }
    if (index === 0) continue;
    const previous = segments[index - 1];
    if (previous.coverage.endTimeUtcMs !== segment.coverage.startTimeUtcMs) {
      throw new RangeError("Transient segment clocks must be exactly adjacent without gaps or overlap.");
    }
    if (!invariant(previous.finalTemperatureCByNode, segment.initialTemperatureCByNode)) {
      throw new RangeError("Transient segment thermal checkpoint handoff is not exact.");
    }
    if (previous.terminalOpticalPhaseRad !== segment.initialOpticalPhaseRad
      || previous.terminalConvectionPhaseRad !== segment.initialConvectionPhaseRad) {
      throw new RangeError("Transient segment rotation phase handoff is not exact.");
    }
  }
  const expectedCoverage = calendarCoverage(completeWeather, reportingOffsetMinutes);
  if (first.coverage.startTimeUtcMs !== expectedCoverage.startTimeUtcMs
    || last.coverage.endTimeUtcMs !== expectedCoverage.endTimeUtcMs) {
    throw new RangeError("Transient segments do not span the supplied weather endpoints.");
  }
  const intervalCount = segments.reduce((total, segment) => total + segment.coverage.intervals, 0);
  const durationHours = segments.reduce((total, segment) => total + segment.coverage.durationHours, 0);
  if (intervalCount !== expectedCoverage.intervals
    || Math.abs(durationHours - expectedCoverage.durationHours) > 1e-9) {
    throw new RangeError("Transient segment coverage does not close the supplied weather clock.");
  }
  const sumField = (field: keyof Pick<AnnualTransientSurfaceResult,
    "dcEnergyWh" | "idealLocalMppDcEnergyWh" | "mismatchAndWiringLossEnergyWh"
    | "grossAcEnergyWh" | "acEnergyWh" | "motorEnergyWh" | "absorbedSolarEnergyWh"
    | "bypassActivationDeviceHours" | "inverterLossWh">) =>
    segments.reduce((total, segment) => total + segment[field], 0);
  const monthly = new Map<string, Omit<AnnualTransientMonthEnergy, "month">>();
  for (const segment of segments) {
    for (const entry of segment.monthly) {
      const target = monthly.get(entry.month) ?? Object.fromEntries(
        MONTH_ENERGY_FIELDS.map((field) => [field, 0]),
      ) as Omit<AnnualTransientMonthEnergy, "month">;
      MONTH_ENERGY_FIELDS.forEach((field) => { target[field] += entry[field]; });
      monthly.set(entry.month, target);
    }
  }
  const storedEnergyChangeJ = segments.reduce(
    (total, segment) => total + segment.energyAudit.storedEnergyChangeJ, 0,
  );
  const netBoundaryEnergyJ = segments.reduce(
    (total, segment) => total + segment.energyAudit.netBoundaryEnergyJ, 0,
  );
  const conductionCancellationJ = segments.reduce(
    (total, segment) => total + segment.energyAudit.conductionCancellationJ, 0,
  );
  const energyResidualJ = storedEnergyChangeJ - netBoundaryEnergyJ - conductionCancellationJ;
  const engineeringCircuit = first.engineeringCircuit === undefined ? undefined : {
    ...first.engineeringCircuit,
    circuitSolveCount: segments.reduce(
      (total, segment) => total + (segment.engineeringCircuit?.circuitSolveCount ?? 0), 0,
    ),
    maximumElectricalExtractionClosureErrorW: Math.max(...segments.map(
      (segment) => segment.engineeringCircuit?.maximumElectricalExtractionClosureErrorW ?? 0,
    )),
  };
  return {
    thermalModel: first.thermalModel,
    electricalModel: first.electricalModel,
    electricalLayoutId: first.electricalLayoutId,
    dcEnergyWh: sumField("dcEnergyWh"),
    idealLocalMppDcEnergyWh: sumField("idealLocalMppDcEnergyWh"),
    mismatchAndWiringLossEnergyWh: sumField("mismatchAndWiringLossEnergyWh"),
    grossAcEnergyWh: sumField("grossAcEnergyWh"),
    acEnergyWh: sumField("acEnergyWh"),
    motorEnergyWh: sumField("motorEnergyWh"),
    absorbedSolarEnergyWh: sumField("absorbedSolarEnergyWh"),
    bypassActivationDeviceHours: sumField("bypassActivationDeviceHours"),
    inverterLossWh: sumField("inverterLossWh"),
    ...(engineeringCircuit === undefined ? {} : { engineeringCircuit }),
    monthly: [...monthly.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([month, energy]) => ({ month, ...energy })),
    averageTemperatureC: segments.reduce(
      (total, segment) => total + segment.averageTemperatureC * segment.coverage.durationHours, 0,
    ) / Math.max(1e-12, durationHours),
    maximumTemperatureC: Math.max(...segments.map((segment) => segment.maximumTemperatureC)),
    minimumTemperatureC: Math.min(...segments.map((segment) => segment.minimumTemperatureC)),
    initialTemperatureCByNode: first.initialTemperatureCByNode,
    initialOpticalPhaseRad: first.initialOpticalPhaseRad,
    initialConvectionPhaseRad: first.initialConvectionPhaseRad,
    finalTemperatureCByNode: last.finalTemperatureCByNode,
    terminalOpticalPhaseRad: last.terminalOpticalPhaseRad,
    terminalConvectionPhaseRad: last.terminalConvectionPhaseRad,
    coverage: expectedCoverage,
    warmup: first.warmup,
    mesh: first.mesh,
    energyAudit: {
      storedEnergyChangeJ,
      netBoundaryEnergyJ,
      conductionCancellationJ,
      energyResidualJ,
      relativeEnergyResidual: Math.abs(energyResidualJ) / Math.max(1, Math.abs(netBoundaryEnergyJ)),
    },
  };
}

export interface AnnualRotationDecompositionEnergy {
  e00Wh: number;
  e10Wh: number;
  e01Wh: number;
  e11Wh: number;
  opticalWh: number;
  thermalWh: number;
  interactionWh: number;
  netWh: number;
  closureResidualWh: number;
}

export interface AnnualRotationDecompositionMonth extends AnnualRotationDecompositionEnergy {
  month: string;
}

export interface AnnualRotationDecompositionResult {
  thermalModel: AnnualTransientThermalModelMetadata;
  e00: AnnualTransientSurfaceResult;
  e10: AnnualTransientSurfaceResult;
  e01: AnnualTransientSurfaceResult;
  e11: AnnualTransientSurfaceResult;
  annual: AnnualRotationDecompositionEnergy;
  monthly: AnnualRotationDecompositionMonth[];
}

function decompositionEnergy(
  e00Wh: number,
  e10Wh: number,
  e01Wh: number,
  e11Wh: number,
): AnnualRotationDecompositionEnergy {
  const opticalWh = e10Wh - e00Wh;
  const thermalWh = e01Wh - e00Wh;
  const interactionWh = e11Wh - e10Wh - e01Wh + e00Wh;
  const netWh = e11Wh - e00Wh;
  return {
    e00Wh,
    e10Wh,
    e01Wh,
    e11Wh,
    opticalWh,
    thermalWh,
    interactionWh,
    netWh,
    closureResidualWh: opticalWh + thermalWh + interactionWh - netWh,
  };
}

/** Runs E00/E10/E01/E11 over the complete supplied weather clock. */
export function simulateAnnualRotationDecomposition(
  input: AnnualTransientSurfaceInput,
): AnnualRotationDecompositionResult {
  const baseSchedule = input.rpmByWeatherStep;
  const zeroSchedule = baseSchedule?.map(() => 0);
  const baseMotorRpm = input.motorRpm ?? input.rpm;
  const baseMotorSchedule = input.motorRpmByWeatherStep ?? baseSchedule;
  const zeroMotorSchedule = baseMotorSchedule?.map(() => 0);
  const run = (optical: boolean, thermal: boolean) => {
    const rotatedRun = optical || thermal;
    return simulateAnnualTransientSurface({
      ...input,
      opticalRpm: optical ? input.rpm : 0,
      convectionRpm: thermal ? input.rpm : 0,
      opticalRpmByWeatherStep: optical ? baseSchedule : zeroSchedule,
      convectionRpmByWeatherStep: thermal ? baseSchedule : zeroSchedule,
      motorRpm: rotatedRun ? baseMotorRpm : 0,
      motorRpmByWeatherStep: rotatedRun ? baseMotorSchedule : zeroMotorSchedule,
    });
  };
  const e00 = run(false, false);
  const baseRotationIsExactlyZero = input.rpm === 0
    && (baseSchedule === undefined || baseSchedule.every((rpm) => rpm === 0))
    && baseMotorRpm === 0
    && (baseMotorSchedule === undefined || baseMotorSchedule.every((rpm) => rpm === 0));
  // At an exactly zero kinematic/convection/motor schedule, all four factorial
  // inputs are identical. Reuse the same actual-clock history rather than
  // spending four circuit solves and risking false cohort distinctions.
  const e10 = baseRotationIsExactlyZero ? e00 : run(true, false);
  const e01 = baseRotationIsExactlyZero ? e00 : run(false, true);
  const e11 = baseRotationIsExactlyZero ? e00 : run(true, true);
  if (input.engineeringElectrical !== undefined) {
    const layoutIds = [e00, e10, e01, e11].map((result) => result.electricalLayoutId);
    if (new Set(layoutIds).size !== 1) {
      throw new RangeError(
        "E00/E10/E01/E11 engineering cases must reuse the identical manufactured topology.",
      );
    }
  }
  const monthMaps = [e00, e10, e01, e11].map((result) => new Map(
    result.monthly.map((entry) => [entry.month, entry.acEnergyWh]),
  ));
  const months = [...new Set(monthMaps.flatMap((map) => [...map.keys()]))].sort();
  return {
    thermalModel: thermalModelMetadata("annual-transient-material-state"),
    e00,
    e10,
    e01,
    e11,
    annual: decompositionEnergy(e00.acEnergyWh, e10.acEnergyWh, e01.acEnergyWh, e11.acEnergyWh),
    monthly: months.map((month) => ({
      month,
      ...decompositionEnergy(
        monthMaps[0].get(month) ?? 0,
        monthMaps[1].get(month) ?? 0,
        monthMaps[2].get(month) ?? 0,
        monthMaps[3].get(month) ?? 0,
      ),
    })),
  };
}

export interface AnnualThermalMeshConvergencePoint {
  requestedNodeCount: number;
  actualNodeCount: number;
  acEnergyWh: number;
  averageTemperatureC: number;
  relativeAcDifferenceFromPrevious?: number;
  averageTemperatureDifferenceFromPreviousC?: number;
  relativeEnergyResidual: number;
}

export interface AnnualThermalMeshConvergenceAudit {
  points: AnnualThermalMeshConvergencePoint[];
  energyToleranceFraction: number;
  temperatureToleranceC: number;
  converged: boolean;
}

export function auditAnnualThermalMeshConvergence(
  input: AnnualTransientSurfaceInput,
  nodeCounts: readonly number[] = [6, 12, 24],
  energyToleranceFraction = 0.01,
  temperatureToleranceC = 0.2,
): AnnualThermalMeshConvergenceAudit {
  if (nodeCounts.length < 2 || nodeCounts.some((count) => !Number.isInteger(count) || count < 1)) {
    throw new RangeError("Thermal mesh convergence requires at least two positive integer counts.");
  }
  const points = nodeCounts.map((requestedNodeCount): AnnualThermalMeshConvergencePoint => {
    const result = simulateAnnualTransientSurface({
      ...input,
      thermalMesh: { ...input.thermalMesh, targetNodeCount: requestedNodeCount },
    });
    return {
      requestedNodeCount,
      actualNodeCount: result.mesh.thermalNodeCount,
      acEnergyWh: result.acEnergyWh,
      averageTemperatureC: result.averageTemperatureC,
      relativeEnergyResidual: result.energyAudit.relativeEnergyResidual,
    };
  });
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    current.relativeAcDifferenceFromPrevious = Math.abs(current.acEnergyWh - previous.acEnergyWh)
      / Math.max(1e-12, Math.abs(current.acEnergyWh));
    current.averageTemperatureDifferenceFromPreviousC = Math.abs(
      current.averageTemperatureC - previous.averageTemperatureC,
    );
  }
  const last = points.at(-1)!;
  return {
    points,
    energyToleranceFraction,
    temperatureToleranceC,
    converged: (last.relativeAcDifferenceFromPrevious ?? Number.POSITIVE_INFINITY)
        <= energyToleranceFraction
      && (last.averageTemperatureDifferenceFromPreviousC ?? Number.POSITIVE_INFINITY)
        <= temperatureToleranceC,
  };
}
