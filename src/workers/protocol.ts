import { MAX_VARIANTS as MAX_PROJECT_VARIANTS } from "../lib/geometry";
import type { IdealSurfaceModel } from "../lib/geometry";
import type {
  CircuitInput,
  EngineeringSurfaceConnectionConfig,
  ElectricalFairnessMode,
  InstantSimulationInput,
  InverterConfig,
  InverterResult,
  Quaternion,
  SolarPositionInput,
  ThermalConfig,
  Vec3,
} from "../lib/physics";
import type { AnnualRotationDecompositionResult, ThermalModelMetadata } from "../lib/physics/annual-transient";
import type { WeatherPoint } from "../lib/weather";

/**
 * v6 couples the immutable engineering cell layout to actual-clock transient
 * material temperatures. The version is part of every fingerprint, so old
 * quasi-steady/engineering cohorts cannot be published as combined results.
 */
export const SIMULATION_WORKER_PROTOCOL_VERSION = 6 as const;
export const SIMULATION_CACHE_VERSION = 7 as const;
export const CONTINUOUS_SURFACE_MODEL_VERSION = "continuous-pv-electrical-v3" as const;
export const CONTINUOUS_SURFACE_MESH_VERSION = "comparison-surface-mesh-v2" as const;

/** Capacity for six ideal comparison shapes plus optional legacy diagnostics. */
export const MAX_SIMULATION_VARIANTS = 2 * MAX_PROJECT_VARIANTS;

type InstantPanelInput = NonNullable<InstantSimulationInput["panel"]>;
type InstantElectricalInput = NonNullable<InstantSimulationInput["electrical"]>;
type InstantWeatherInput = NonNullable<InstantSimulationInput["weather"]>;

export type SimulationPanelDefaults = Omit<
  InstantPanelInput,
  "normal" | "areaM2" | "efficiency"
>;

/**
 * One quadrature point on a curved electrical zone. `areaWeight` is a
 * positive relative area and is normalized across the zone by the kernel.
 */
export interface SimulationSurfaceSample {
  /** World-space position before the variant's rotation or plane tracking. */
  positionM: Vec3;
  /** World-space outward normal before the variant's rotation or plane tracking. */
  normal: Vec3;
  areaWeight: number;
}

export type SimulationContinuousShape =
  | "plane"
  | "cube"
  | "sphere"
  | "hemisphere"
  | "cylinder"
  | "cone";

export type SimulationSurfaceRegionId = "surface" | "top" | "lateral" | string;

export type SimulationContinuousSurfaceElectricalModel =
  | "local-mpp-area-integral"
  | "explicit-series-parallel-bypass";

/**
 * Required manufacturing/topology inputs for the engineering connection.
 * Optional solver controls retain the defaults documented by the electrical
 * solver, while cell density and the actual connection are never inferred.
 */
export type SimulationEngineeringSurfaceConnectionConfig =
  EngineeringSurfaceConnectionConfig & {
    nominalCellAreaM2: number;
    parallelStrings: number;
    cellsPerBypassSubstring: number;
  };

/**
 * Absolute-area quadrature point for the default comparison engine. Unlike
 * `SimulationSurfaceSample.areaWeight`, this is never normalized per panel or
 * electrical zone: the sum must equal `activeAreaM2` exactly within tolerance.
 */
export interface SimulationContinuousSurfaceSample {
  positionM: Vec3;
  normal: Vec3;
  areaM2: number;
  /** Stable material chart address; never recomputed from transformed world coordinates. */
  zoneId: string;
  zoneIndex: number;
  u: number;
  v: number;
  regionId?: SimulationSurfaceRegionId;
}

/**
 * One gap-free PV skin. Geometry regions are reporting groups only; they are
 * not panels, series strings, bypass sections, or independent normalizers.
 */
interface SimulationContinuousSurfaceWorkItemBase {
  modelVersion: typeof CONTINUOUS_SURFACE_MODEL_VERSION;
  /** Producer-owned render/analytic mesh revision, included in the fingerprint. */
  meshVersion: string;
  shape: SimulationContinuousShape;
  landAreaM2: number;
  activeAreaM2: number;
  heightM: number;
  tiltDeg?: number;
  azimuthSamples: number;
  integrationSampleCount: number;
  samples: readonly SimulationContinuousSurfaceSample[];
  /** Shared optical/material inputs; per-sample geometry remains authoritative. */
  surfaceOptions?: SimulationPanelDefaults;
}

export type SimulationContinuousSurfaceWorkItem =
  SimulationContinuousSurfaceWorkItemBase & (
    | {
        /** Ideal independent-MPP integral: an explicit theoretical upper bound. */
        electricalModel: "local-mpp-area-integral";
        engineeringConnection?: never;
      }
    | {
        /** Explicit cell strings, parallel branches and bypass substrings. */
        electricalModel: "explicit-series-parallel-bypass";
        engineeringConnection: SimulationEngineeringSurfaceConnectionConfig;
      }
  );

type ContinuousSurfaceWorkItemOptions = {
  landAreaM2: number;
  meshVersion?: string;
  tiltDeg?: number;
  surfaceOptions?: SimulationPanelDefaults;
} & (
  | {
      electricalModel?: "local-mpp-area-integral";
      engineeringConnection?: never;
    }
  | {
      electricalModel: "explicit-series-parallel-bypass";
      engineeringConnection: SimulationEngineeringSurfaceConnectionConfig;
    }
);

/**
 * Converts authoritative geometry quadrature into the worker's panel-free
 * contract without inventing zones, relative weights, or legacy cell areas.
 */
export function createContinuousSurfaceWorkItem(
  surface: IdealSurfaceModel,
  input: ContinuousSurfaceWorkItemOptions,
): SimulationContinuousSurfaceWorkItem {
  const samples = surface.zones.flatMap((zone) => zone.samples.map((sample) => ({
    positionM: { x: sample.position[0], y: sample.position[1], z: sample.position[2] },
    normal: { x: sample.normal[0], y: sample.normal[1], z: sample.normal[2] },
    areaM2: sample.areaM2,
    zoneId: sample.zoneId,
    zoneIndex: sample.zoneIndex,
    u: sample.u,
    v: sample.v,
    regionId: surface.kind === "cylinder"
      ? (zone.id.includes("top") || sample.normal[1] > 0.5 ? "top" : "lateral")
      : "surface",
  })));
  const base = {
    modelVersion: CONTINUOUS_SURFACE_MODEL_VERSION,
    meshVersion: input.meshVersion ?? CONTINUOUS_SURFACE_MESH_VERSION,
    shape: surface.kind,
    landAreaM2: input.landAreaM2,
    activeAreaM2: surface.dimensions.activeAreaM2,
    heightM: surface.dimensions.heightM,
    ...(input.tiltDeg === undefined ? {} : { tiltDeg: input.tiltDeg }),
    azimuthSamples: surface.azimuthSamples,
    integrationSampleCount: samples.length,
    samples,
    ...(input.surfaceOptions === undefined ? {} : { surfaceOptions: input.surfaceOptions }),
  };
  return input.electricalModel === "explicit-series-parallel-bypass"
    ? {
        ...base,
        electricalModel: input.electricalModel,
        engineeringConnection: input.engineeringConnection,
      }
    : {
        ...base,
        electricalModel: "local-mpp-area-integral",
      };
}

/** Static world-space axis-aligned shadow caster. */
export interface SimulationObstacleBounds {
  min: Vec3;
  max: Vec3;
}

export type SimulationPlaneTrackingMode =
  | "single-axis-north-south"
  | "dual-axis";

/**
 * Timestamp-resolved tracking for a baseline horizontal plane. The centre is
 * a world-space pivot shared by the panel pose and all surface samples.
 */
export interface SimulationPlaneTracking {
  mode: SimulationPlaneTrackingMode;
  centreM: Vec3;
}

/**
 * A structured-clone-safe panel description. Dynamic visibility arrays are
 * indexed exactly like `SimulationKernelInput.weather`.
 */
export type SimulationPanelWorkItem = SimulationPanelDefaults & {
  panelId: string;
  /** World-space pose before the variant's rotation or plane tracking. */
  positionM?: Vec3;
  normal?: Vec3;
  /** Three.js-compatible local +Z-front orientation before +Y rotation. */
  quaternion?: Quaternion;
  /** Optional second in-plane ray-sampling axis; sampleAxisU is inherited above. */
  sampleAxisV?: Vec3;
  areaM2?: number;
  efficiency?: number;
  electrical?: InstantElectricalInput;
  /**
   * Optional curved-surface quadrature. Samples are integrated optically and
   * thermally before one zone-level I-V curve is supplied to the circuit.
   */
  surfaceSamples?: readonly SimulationSurfaceSample[];
  visibilityByStep?: readonly number[];
  diffuseVisibilityByStep?: readonly number[];
  groundVisibilityByStep?: readonly number[];
};

export interface SimulationVariantWorkItem {
  variantId: string;
  /** Legacy discrete-panel fields. Omit all three for `continuousSurface`. */
  panelCount?: number;
  totalPanelAreaM2?: number;
  referenceEfficiency: number;
  /** Optional multiplier applied once to GHI, DNI and DHI. */
  irradianceScale?: number;
  irradianceScaleByStep?: readonly number[];
  /**
   * Static world-space AABBs used for direct-beam shadow rays. Terrain and
   * water surfaces must be excluded by the producer.
   */
  obstacleBounds?: readonly SimulationObstacleBounds[];
  /** Omit panels for a fast aggregate panel with `totalPanelAreaM2`. */
  panels?: readonly SimulationPanelWorkItem[];
  /** Default comparison path: one continuous skin with absolute-area samples. */
  continuousSurface?: SimulationContinuousSurfaceWorkItem;
  topology?: "series" | "parallel";
  /** Circuit options configure the shared-circuit solver when it is selected. */
  circuit?: Omit<CircuitInput, "devices" | "topology"> | false;
  /**
   * Explicit electrical comparison contract. `shared-circuit` operates all
   * zone curves on one circuit MPP; `independent-mppt` sums zone MPPs and feeds
   * that DC through one optimizer/shared inverter. Omit for legacy behaviour.
   */
  electricalFairnessMode?: ElectricalFairnessMode;
  electrical?: InstantElectricalInput;
  inverter?: InverterConfig | false;
  /** Optional sun tracking; mutually exclusive with the legacy +Y rotation. */
  planeTracking?: SimulationPlaneTracking;
  rotation?: InstantSimulationInput["rotation"];
  /**
   * Natural/environmental RPM resolved outside the worker for every weather
   * boundary. Entry i is held constant over [weather[i], weather[i + 1]); the
   * closing entry is retained for audit/fingerprinting but is not integrated.
   *
   * This schedule requires fixed rotation, starts at rotation.initialAngleRad
   * at weather[0], and advances phase cumulatively across RPM changes. It is
   * mutually exclusive with rotation.referenceTimestamp and motorDrive. Omit
   * it to preserve the legacy static or single fixed-RPM contract exactly.
   */
  rotationRpmByWeatherStep?: readonly number[];
  /**
   * External motor duty. The kernel subtracts tau*|omega|/eta from post-
   * inverter AC at every timestamp. Natural-wind rotation must omit this.
   */
  motorDrive?: {
    requiredTorqueNm: number;
    motorEfficiency: number;
  };
  /**
   * Midpoint quadrature density per revolution for fixed-rotation intervals.
   * Complete turns are reduced by periodicity and a fractional turn receives
   * samples in proportion to its angular span. Omit (or use 1) for exact
   * timestamp evaluation of a single fixed RPM. A weather-step RPM schedule is
   * an interval contract, so 1 means one midpoint per nonzero interval and a
   * larger value improves its angular quadrature. When referenceTimestamp is
   * omitted, weather[0] is the deterministic rotation epoch.
   */
  rotationPhaseSamples?: number;
  /**
   * Opt-in actual-clock thermal history. Omit to retain the legacy Faiman
   * path, which must be reported with thermalModelMetadata as quasi-steady.
   * The annual run is evaluated once over all weather intervals and is not a
   * representative-day scaling shortcut.
   *
   * Known operational limit: progress events cover the streamed quasi-steady
   * row pass. A synchronous E00/E10/E01/E11 calculation is cancellable and
   * yields only between transient variants, not within one variant's history.
   */
  annualTransientThermal?: {
    surface: IdealSurfaceModel;
    referenceEfficiency?: number;
    gammaPerC: number;
    referenceTemperatureC?: number;
    absorptivity?: number;
    initialTemperatureC?: number;
    effectiveSkyTemperatureOffsetC?: number;
    thermalNodeCount?: number;
    maximumThermalSubstepSeconds?: number;
    /**
     * Engineering I-V/circuit state refresh cadence. It is independent of the
     * finer thermal stability step and cannot exceed one actual clock hour.
     */
    maximumElectricalCouplingStepSeconds?: number;
    warmupPeriodHours?: number;
    warmupConvergenceToleranceC?: number;
  };
}

export interface SimulationPhysicsOptions {
  location?: Omit<SolarPositionInput, "timestamp">;
  solarOverride?: InstantSimulationInput["solarOverride"];
  panelDefaults?: SimulationPanelDefaults;
  weather?: Omit<InstantWeatherInput, "ambientTemperatureC" | "referenceWindSpeedMS">;
  electrical?: InstantElectricalInput;
  thermal?: ThermalConfig;
  inverter?: InverterConfig | false;
}

/**
 * Per-weather rows are quasi-steady diagnostics. For an opt-in transient
 * variant, authoritative period energy and thermal history are carried only
 * by the complete event's annualTransientRotationByVariant entry.
 */
export interface SimulationKernelInput {
  variants: SimulationVariantWorkItem[];
  /**
   * Ordered point boundaries. Energy is integrated over N-1 intervals. Annual
   * hourly input therefore needs 8,761 points (8,785 in a leap year), including
   * the closing endpoint.
   */
  weather: WeatherPoint[];
  physics?: SimulationPhysicsOptions;
  /** `annual` enables conservative gap validation and annual result labelling. */
  mode?: "time-series" | "annual";
  chunkSize?: number;
  /** Maximum allowed weather gap in annual mode. Defaults to six hours. */
  maximumGapHours?: number;
  /**
   * Fixed offset used only for calendar-month energy buckets. UTC remains the
   * internal timestamp authority; omit this field for UTC reporting.
   */
  reportingOffsetMinutes?: number;
}

export interface SimulationRunRequest {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/run";
  requestId: string;
  /** Scenario/input identity echoed by every event and required for cancellation. */
  fingerprint: string;
  input: SimulationKernelInput;
}

export interface SimulationCancelRequest {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/cancel";
  requestId: string;
  fingerprint: string;
  reason?: string;
}

export type SimulationWorkerRequest = SimulationRunRequest | SimulationCancelRequest;

export interface SimulationAcceptedEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/accepted";
  requestId: string;
  fingerprint: string;
  mode: "time-series" | "annual";
}

export interface SimulationProgressEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/progress";
  requestId: string;
  fingerprint: string;
  /** Completed weather points; retained as a user-facing row counter. */
  completed: number;
  total: number;
  /** Panel-phase work used as the authoritative progress denominator. */
  completedWork: number;
  totalWork: number;
  /** Exactly completedWork / totalWork. */
  fraction: number;
  /** Number of completed variant-points whose source components failed closure. */
  ghiClosureWarningCount: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

export interface SimulationGhiClosureDiagnostic {
  residualWm2: number;
  relativeResidual: number;
  toleranceWm2: number;
  isClosed: boolean;
  /** Worker never silently rewrites supplied GHI/DNI/DHI. */
  policy: "preserve-source-and-warn" | "not-evaluated";
}

export interface SimulationResultRow {
  timeUtcMs: number;
  dcPowerWByVariant: Record<string, number>;
  acPowerWByVariant: Record<string, number>;
  motorPowerWByVariant?: Record<string, number>;
  poaWm2ByVariant: Record<string, number>;
  moduleTemperatureCByVariant: Record<string, number>;
  mismatchLossFractionByVariant: Record<string, number>;
  bypassActiveCountByVariant: Record<string, number>;
  /** Static for a variant/run; repeated on rows so streamed CSV is self-describing. */
  electricalLayoutIdByVariant: Record<string, string>;
  inverterStatusByVariant: Record<string, InverterResult["status"] | "disabled">;
  ghiClosureByVariant: Record<string, SimulationGhiClosureDiagnostic>;
  rotationIntervalAveragedByVariant: Record<string, boolean>;
  surfaceRegionsByVariant: Record<string, Record<string, SimulationSurfaceRegionResult>>;
}

export interface SimulationSurfaceRegionResult {
  areaM2: number;
  directOpticalW: number;
  diffuseOpticalW: number;
  groundOpticalW: number;
  dcPowerW: number;
  acPowerW: number;
}

export interface SimulationSurfaceRegionEnergy {
  dcEnergyWh: number;
  acEnergyWh: number;
}

export interface SimulationChunkEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/chunk";
  requestId: string;
  fingerprint: string;
  offset: number;
  rows: SimulationResultRow[];
}

export interface SimulationMonthlyEnergy {
  /** Calendar month at `SimulationCompleteEvent.reportingOffsetMinutes`, `YYYY-MM`. */
  monthUtc: string;
  dcEnergyWhByVariant: Record<string, number>;
  acEnergyWhByVariant: Record<string, number>;
  motorEnergyWhByVariant?: Record<string, number>;
}

export interface AnnualEngineeringElectricalAudit {
  status: "authoritative-annual-transient-engineering";
  electricalModel: "explicit-series-parallel-bypass";
  thermalModel: "annual-transient-material-state";
  periodIntegration: "actual-weather-clock";
  electricalLayoutId: string;
  annual: {
    idealLocalMppDcEnergyWh: number;
    engineeringDcEnergyWh: number;
    mismatchAndWiringLossEnergyWh: number;
    grossAcEnergyWh: number;
    netAcEnergyWh: number;
    motorEnergyWh: number;
    inverterLossWh: number;
    bypassActivationDeviceHours: number;
  };
  monthly: readonly {
    monthUtc: string;
    idealLocalMppDcEnergyWh: number;
    engineeringDcEnergyWh: number;
    mismatchAndWiringLossEnergyWh: number;
    grossAcEnergyWh: number;
    netAcEnergyWh: number;
    motorEnergyWh: number;
    bypassActivationDeviceHours: number;
  }[];
  topology: {
    activeAreaM2: number;
    cellCount: number;
    parallelStringCount: number;
    seriesCellCountByString: readonly number[];
    bypassSubstringCount: number;
  };
  coupling: {
    maximumStepSeconds: number;
    circuitSolveCount: number;
    maximumElectricalExtractionClosureErrorW: number;
  };
}

export interface SimulationCompleteEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/complete";
  requestId: string;
  fingerprint: string;
  mode: "time-series" | "annual";
  /** Backward-compatible alias of `dcEnergyWhByVariant`. */
  energyWhByVariant: Record<string, number>;
  dcEnergyWhByVariant: Record<string, number>;
  acEnergyWhByVariant: Record<string, number>;
  /** Deterministic electrical/material layout contract used by each variant. */
  electricalLayoutIdByVariant: Record<string, string>;
  motorEnergyWhByVariant?: Record<string, number>;
  /** Complete-event energy source. Opt-in transient variants use E11. */
  authoritativeEnergyPathByVariant: Record<
    string,
    "worker-quasi-steady" | "annual-transient-e11"
      | "annual-transient-engineering-e11"
  >;
  /**
   * Quasi-steady region energies close to their parent variant. An opt-in
   * authoritative transient variant returns `{}` because its streamed rows
   * use the separately labelled quasi-steady diagnostic path.
   */
  surfaceRegionEnergyWhByVariant: Record<
    string,
    Record<string, SimulationSurfaceRegionEnergy>
  >;
  /** Every variant states whether annual thermal history was actually used. */
  thermalModelMetadataByVariant: Record<string, ThermalModelMetadata>;
  /** Present only for opt-in actual-clock annual transient runs. */
  annualTransientRotationByVariant?: Record<
    string,
    AnnualRotationDecompositionResult
  >;
  /** Present only for a fully coupled transient + explicit-circuit E11 path. */
  annualEngineeringElectricalAuditByVariant?: Record<
    string,
    AnnualEngineeringElectricalAudit
  >;
  monthlyEnergy: SimulationMonthlyEnergy[];
  /** Fixed offset used for `monthlyEnergy`; zero preserves the legacy UTC contract. */
  reportingOffsetMinutes: number;
  /** Weather point count. There are `intervals = steps - 1` integration intervals. */
  steps: number;
  intervals: number;
  durationHours: number;
  ghiClosureWarningCount: number;
  elapsedMs: number;
}

export interface SimulationCancelledEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/cancelled";
  requestId: string;
  fingerprint: string;
  completed: number;
  total: number;
  completedWork: number;
  totalWork: number;
  fraction: number;
  reason?: string;
}

export interface SimulationStaleEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/stale";
  requestId: string;
  /** Fingerprint of the ignored/superseded message or run. */
  fingerprint: string;
  currentFingerprint?: string;
  reason: "cancel-fingerprint-mismatch" | "request-not-active" | "superseded";
}

export interface SerializedWorkerError {
  name: string;
  message: string;
  stack?: string;
}

export interface SimulationErrorEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/error";
  requestId: string;
  fingerprint: string;
  error: SerializedWorkerError;
}

export type SimulationWorkerEvent =
  | SimulationAcceptedEvent
  | SimulationProgressEvent
  | SimulationChunkEvent
  | SimulationCompleteEvent
  | SimulationCancelledEvent
  | SimulationStaleEvent
  | SimulationErrorEvent;

function stableSerialize(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new RangeError("fingerprint 입력은 유한수여야 합니다.");
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "undefined":
      return "null";
    case "object": {
      const object = value as object;
      if (ancestors.has(object)) throw new TypeError("fingerprint 입력에 순환 참조가 있습니다.");
      ancestors.add(object);
      let result: string;
      if (Array.isArray(value)) {
        result = `[${value.map((entry) => stableSerialize(entry, ancestors)).join(",")}]`;
      } else {
        const record = value as Record<string, unknown>;
        result = `{${Object.keys(record)
          .filter((key) => record[key] !== undefined)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], ancestors)}`)
          .join(",")}}`;
      }
      ancestors.delete(object);
      return result;
    }
    default:
      throw new TypeError(`fingerprint에 ${typeof value} 값을 사용할 수 없습니다.`);
  }
}

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Stable, non-cryptographic identity for stale-result filtering. It is not a
 * security hash and must not be used to authenticate data.
 */
export function simulationInputFingerprint(input: SimulationKernelInput): string {
  const serialized = stableSerialize(input);
  const first = fnv1a(serialized, 2_166_136_261).toString(16).padStart(8, "0");
  const second = fnv1a(serialized, 2_654_435_761).toString(16).padStart(8, "0");
  return `sim-v${SIMULATION_WORKER_PROTOCOL_VERSION}-cache-v${SIMULATION_CACHE_VERSION}-${first}${second}`;
}

export function createSimulationRunRequest(
  requestId: string,
  input: SimulationKernelInput,
): SimulationRunRequest {
  if (!requestId.trim()) throw new TypeError("requestId가 비어 있습니다.");
  const fingerprint = simulationInputFingerprint(input);
  return {
    protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
    type: "simulation/run",
    requestId,
    fingerprint,
    input,
  };
}

export function createSimulationCancelRequest(
  run: Pick<SimulationRunRequest, "requestId" | "fingerprint">,
  reason?: string,
): SimulationCancelRequest {
  return {
    protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
    type: "simulation/cancel",
    requestId: run.requestId,
    fingerprint: run.fingerprint,
    ...(reason ? { reason } : {}),
  };
}

export function isSimulationEventStale(
  event: SimulationWorkerEvent,
  current: Pick<SimulationRunRequest, "requestId" | "fingerprint">,
): boolean {
  return event.requestId !== current.requestId || event.fingerprint !== current.fingerprint;
}

export function serializeWorkerError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: "Error", message: String(error) };
}
