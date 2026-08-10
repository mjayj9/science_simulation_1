import type {
  CircuitInput,
  InstantSimulationInput,
  InverterConfig,
  InverterResult,
  SolarPositionInput,
  ThermalConfig,
  Vec3,
} from "../lib/physics";
import type { WeatherPoint } from "../lib/weather";

export const SIMULATION_WORKER_PROTOCOL_VERSION = 1 as const;

type InstantPanelInput = NonNullable<InstantSimulationInput["panel"]>;
type InstantElectricalInput = NonNullable<InstantSimulationInput["electrical"]>;
type InstantWeatherInput = NonNullable<InstantSimulationInput["weather"]>;

export type SimulationPanelDefaults = Omit<
  InstantPanelInput,
  "normal" | "areaM2" | "efficiency"
>;

/**
 * A structured-clone-safe panel description. Dynamic visibility arrays are
 * indexed exactly like `SimulationKernelInput.weather`.
 */
export type SimulationPanelWorkItem = SimulationPanelDefaults & {
  panelId: string;
  normal?: Vec3;
  areaM2?: number;
  efficiency?: number;
  electrical?: InstantElectricalInput;
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
  /** Omit panels for a fast aggregate panel with `totalPanelAreaM2`. */
  panels?: readonly SimulationPanelWorkItem[];
  topology?: "series" | "parallel";
  /** Supplying circuit options enables detailed per-panel single-diode solving. */
  circuit?: Omit<CircuitInput, "devices" | "topology"> | false;
  electrical?: InstantElectricalInput;
  inverter?: InverterConfig | false;
  rotation?: InstantSimulationInput["rotation"];
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
  weather: WeatherPoint[];
  physics?: SimulationPhysicsOptions;
  /** `annual` enables conservative gap validation and annual result labelling. */
  mode?: "time-series" | "annual";
  chunkSize?: number;
  /** Maximum allowed weather gap in annual mode. Defaults to six hours. */
  maximumGapHours?: number;
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
  /** Completed weather rows; retained for protocol v1 consumers. */
  completed: number;
  total: number;
  /** Approximate panel-level work, useful when variants have different panel counts. */
  completedWork: number;
  totalWork: number;
  fraction: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
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
  /** UTC calendar month, `YYYY-MM`. */
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
  steps: number;
  durationHours: number;
  elapsedMs: number;
}

export interface SimulationCancelledEvent {
  protocolVersion: typeof SIMULATION_WORKER_PROTOCOL_VERSION;
  type: "simulation/cancelled";
  requestId: string;
  fingerprint: string;
  completed: number;
  total: number;
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
