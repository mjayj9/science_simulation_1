import type {
  CircuitInput,
  InstantSimulationInput,
  InverterConfig,
  InverterResult,
  Quaternion,
  SolarPositionInput,
  ThermalConfig,
  Vec3,
} from "../lib/physics";
import type { WeatherPoint } from "../lib/weather";

/**
 * v2 adds interval-aware rotation quadrature, closure diagnostics, work-based
 * progress and an explicit point-boundary annual integration contract.
 */
export const SIMULATION_WORKER_PROTOCOL_VERSION = 2 as const;

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
  /** World-space position before the variant's +Y rotation is applied. */
  positionM: Vec3;
  /** World-space outward normal before the variant's +Y rotation is applied. */
  normal: Vec3;
  areaWeight: number;
}

/** Static world-space axis-aligned shadow caster. */
export interface SimulationObstacleBounds {
  min: Vec3;
  max: Vec3;
}

/**
 * A structured-clone-safe panel description. Dynamic visibility arrays are
 * indexed exactly like `SimulationKernelInput.weather`.
 */
export type SimulationPanelWorkItem = SimulationPanelDefaults & {
  panelId: string;
  /** World-space pose before the variant's +Y rotation is applied. */
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
  panelCount: number;
  totalPanelAreaM2: number;
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
  topology?: "series" | "parallel";
  /** Supplying circuit options enables detailed per-panel single-diode solving. */
  circuit?: Omit<CircuitInput, "devices" | "topology"> | false;
  electrical?: InstantElectricalInput;
  inverter?: InverterConfig | false;
  rotation?: InstantSimulationInput["rotation"];
  /**
   * Midpoint quadrature density per revolution for fixed-rotation intervals.
   * Complete turns are reduced by periodicity and a fractional turn receives
   * samples in proportion to its angular span. Omit (or use 1) for exact
   * timestamp evaluation. When referenceTimestamp is omitted, weather[0] is
   * the deterministic rotation epoch.
   */
  rotationPhaseSamples?: number;
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
  poaWm2ByVariant: Record<string, number>;
  moduleTemperatureCByVariant: Record<string, number>;
  mismatchLossFractionByVariant: Record<string, number>;
  bypassActiveCountByVariant: Record<string, number>;
  inverterStatusByVariant: Record<string, InverterResult["status"] | "disabled">;
  ghiClosureByVariant: Record<string, SimulationGhiClosureDiagnostic>;
  rotationIntervalAveragedByVariant: Record<string, boolean>;
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
  return `sim-v${SIMULATION_WORKER_PROTOCOL_VERSION}-${first}${second}`;
}

export function createSimulationRunRequest(
  requestId: string,
  input: SimulationKernelInput,
  fingerprint = simulationInputFingerprint(input),
): SimulationRunRequest {
  if (!requestId.trim()) throw new TypeError("requestId가 비어 있습니다.");
  if (!fingerprint.trim()) throw new TypeError("fingerprint가 비어 있습니다.");
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
