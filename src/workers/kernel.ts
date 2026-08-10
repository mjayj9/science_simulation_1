import {
  MAX_PANELS_PER_VARIANT,
  MAX_VARIANTS,
  PANEL_AREA_M2,
} from "../lib/geometry";
import {
  calculateCircuit,
  calculateInverter,
  simulateInstant,
  type CircuitDevice,
  type InstantSimulationInput,
  type InverterResult,
} from "../lib/physics";
import type { WeatherPoint } from "../lib/weather";
import {
  SIMULATION_WORKER_PROTOCOL_VERSION,
  type SimulationChunkEvent,
  type SimulationCompleteEvent,
  type SimulationKernelInput,
  type SimulationMonthlyEnergy,
  type SimulationPanelWorkItem,
  type SimulationProgressEvent,
  type SimulationResultRow,
  type SimulationRunRequest,
  type SimulationVariantWorkItem,
} from "./protocol";

export class SimulationCancelledError extends Error {
  constructor() {
    super("시뮬레이션이 취소되었습니다.");
    this.name = "SimulationCancelledError";
  }
}

export interface SimulationKernelHooks {
  isCancelled?: () => boolean;
  onProgress?: (event: SimulationProgressEvent) => void | Promise<void>;
  onChunk?: (event: SimulationChunkEvent) => void | Promise<void>;
  /** Must yield to the worker event loop so a cancel message can be received. */
  yieldControl?: () => Promise<void>;
}

export interface SimulationStepContext {
  input: SimulationKernelInput;
  variant: SimulationVariantWorkItem;
  weather: WeatherPoint;
  stepIndex: number;
  isCancelled?: () => boolean;
}

export interface SimulationPhysicsStepResult {
  dcPowerW: number;
  acPowerW: number;
  poaWm2: number;
  moduleTemperatureC: number;
  mismatchLossFraction: number;
  bypassActiveCount: number;
  inverterStatus: InverterResult["status"] | "disabled";
}

/** Returning a number remains supported as a DC=AC test/custom step. */
export type SimulationStepFunction = (
  context: SimulationStepContext,
) => number | SimulationPhysicsStepResult;

/**
 * Legacy gross reference retained for benchmarks. The production kernel now
 * defaults to `computePhysicsStep`, which invokes the real physics pipeline.
 */
export const computeGrossDcStep: SimulationStepFunction = ({ variant, weather }) =>
  Math.max(0, weather.ghiWm2) *
  variant.totalPanelAreaM2 *
  variant.referenceEfficiency *
  (variant.irradianceScale ?? 1);

function assertUnitFraction(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError(`${label}은(는) 0~1 범위여야 합니다.`);
  }
}

function validateDynamicSeries(
  values: readonly number[] | undefined,
  expectedLength: number,
  label: string,
  unitFraction = false,
): void {
  if (values === undefined) return;
  if (values.length !== expectedLength) {
    throw new RangeError(`${label} 길이는 기상 시계열 길이와 같아야 합니다.`);
  }
  values.forEach((value, index) => {
    if (!Number.isFinite(value) || value < 0 || (unitFraction && value > 1)) {
      throw new RangeError(`${label}[${index}] 값이 허용 범위를 벗어났습니다.`);
    }
  });
}

export function validateKernelInput(input: SimulationKernelInput): SimulationKernelInput {
  if (
    !Array.isArray(input.variants) ||
    input.variants.length < 1 ||
    input.variants.length > MAX_VARIANTS
  ) {
    throw new RangeError(`비교 형상은 1~${MAX_VARIANTS}개여야 합니다.`);
  }
  if (!Array.isArray(input.weather) || input.weather.length < 1) {
    throw new RangeError("워커 기상 시계열이 비어 있습니다.");
  }

  const variantIds = new Set<string>();
  let totalPanels = 0;
  input.variants.forEach((variant) => {
    if (!variant.variantId || variantIds.has(variant.variantId)) {
      throw new Error("워커 형상 ID가 비어 있거나 중복되었습니다.");
    }
    variantIds.add(variant.variantId);
    if (
      !Number.isInteger(variant.panelCount) ||
      variant.panelCount < 1 ||
      variant.panelCount > MAX_PANELS_PER_VARIANT
    ) {
      throw new RangeError(`형상별 패널 수는 1~${MAX_PANELS_PER_VARIANT}개여야 합니다.`);
    }
    totalPanels += variant.panelCount;
    const expectedArea = variant.panelCount * PANEL_AREA_M2;
    if (
      !Number.isFinite(variant.totalPanelAreaM2) ||
      Math.abs(variant.totalPanelAreaM2 - expectedArea) > 1e-10
    ) {
      throw new RangeError(
        `${variant.variantId}의 패널 면적은 0.0025 m² × 패널 수와 같아야 합니다.`,
      );
    }
    if (
      !Number.isFinite(variant.referenceEfficiency) ||
      variant.referenceEfficiency < 0 ||
      variant.referenceEfficiency > 1
    ) {
      throw new RangeError("패널 기준 효율은 0~1 범위여야 합니다.");
    }
    if (
      variant.irradianceScale !== undefined &&
      (!Number.isFinite(variant.irradianceScale) || variant.irradianceScale < 0)
    ) {
      throw new RangeError("일사 스케일은 0 이상의 유한수여야 합니다.");
    }
    validateDynamicSeries(
      variant.irradianceScaleByStep,
      input.weather.length,
      `${variant.variantId}.irradianceScaleByStep`,
    );

    if (variant.panels !== undefined) {
      if (variant.panels.length !== variant.panelCount) {
        throw new RangeError(`${variant.variantId}.panels 길이는 panelCount와 같아야 합니다.`);
      }
      const panelIds = new Set<string>();
      let explicitArea = 0;
      variant.panels.forEach((panel, panelIndex) => {
        if (!panel.panelId || panelIds.has(panel.panelId)) {
          throw new Error(`${variant.variantId}의 패널 ID가 비어 있거나 중복되었습니다.`);
        }
        panelIds.add(panel.panelId);
        const area = panel.areaM2 ?? PANEL_AREA_M2;
        if (!Number.isFinite(area) || area <= 0) {
          throw new RangeError(`${variant.variantId}.panels[${panelIndex}] 면적이 잘못되었습니다.`);
        }
        explicitArea += area;
        const efficiency = panel.efficiency ?? variant.referenceEfficiency;
        assertUnitFraction(efficiency, `${variant.variantId}.panels[${panelIndex}].efficiency`);
        if (panel.normal) {
          const components = [panel.normal.x, panel.normal.y, panel.normal.z];
          if (
            components.some((value) => !Number.isFinite(value)) ||
            Math.hypot(...components) < 1e-12
          ) {
            throw new RangeError(`${variant.variantId}.panels[${panelIndex}].normal이 잘못되었습니다.`);
          }
        }
        assertUnitFraction(panel.visibility, `${panel.panelId}.visibility`);
        assertUnitFraction(panel.diffuseVisibility, `${panel.panelId}.diffuseVisibility`);
        assertUnitFraction(panel.groundVisibility, `${panel.panelId}.groundVisibility`);
        assertUnitFraction(panel.soilingLossFraction, `${panel.panelId}.soilingLossFraction`);
        validateDynamicSeries(
          panel.visibilityByStep,
          input.weather.length,
          `${panel.panelId}.visibilityByStep`,
          true,
        );
        validateDynamicSeries(
          panel.diffuseVisibilityByStep,
          input.weather.length,
          `${panel.panelId}.diffuseVisibilityByStep`,
          true,
        );
        validateDynamicSeries(
          panel.groundVisibilityByStep,
          input.weather.length,
          `${panel.panelId}.groundVisibilityByStep`,
          true,
        );
      });
      if (Math.abs(explicitArea - variant.totalPanelAreaM2) > 1e-10) {
        throw new RangeError(`${variant.variantId}의 명시적 패널 면적 합계가 totalPanelAreaM2와 다릅니다.`);
      }
    }
  });
  if (totalPanels > 100) {
    throw new RangeError("워커 입력의 전체 패널 수는 최대 100개입니다.");
  }

  let previous = -Infinity;
  const maximumGapHours = input.maximumGapHours ?? (input.mode === "annual" ? 6 : undefined);
  if (
    maximumGapHours !== undefined &&
    (!Number.isFinite(maximumGapHours) || maximumGapHours <= 0 || maximumGapHours > 8_784)
  ) {
    throw new RangeError("maximumGapHours는 0보다 크고 8,784 이하여야 합니다.");
  }
  input.weather.forEach((point, index) => {
    const values = Object.entries(point).filter(([, value]) => typeof value === "number");
    if (values.some(([, value]) => !Number.isFinite(value))) {
      throw new Error(`워커 기상 ${index}번째 행에 유한하지 않은 값이 있습니다.`);
    }
    if (point.timeUtcMs <= previous) {
      throw new Error("워커 기상 시각은 중복 없이 오름차순이어야 합니다.");
    }
    if (
      previous > -Infinity &&
      maximumGapHours !== undefined &&
      point.timeUtcMs - previous > maximumGapHours * 3_600_000
    ) {
      throw new RangeError(`워커 기상 시계열 간격이 ${maximumGapHours}시간을 초과했습니다.`);
    }
    if (
      point.ghiWm2 < 0 ||
      point.dniWm2 < 0 ||
      point.dhiWm2 < 0 ||
      point.windSpeedMs < 0 ||
      point.gustMs < 0
    ) {
      throw new RangeError(`워커 기상 ${index}번째 행에 음수 물리량이 있습니다.`);
    }
    previous = point.timeUtcMs;
  });
  if (
    input.chunkSize !== undefined &&
    (!Number.isInteger(input.chunkSize) || input.chunkSize < 1 || input.chunkSize > 1024)
  ) {
    throw new RangeError("워커 chunkSize는 1~1024 정수여야 합니다.");
  }
  return input;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resolvedPanels(
  input: SimulationKernelInput,
  variant: SimulationVariantWorkItem,
): SimulationPanelWorkItem[] {
  const defaults = input.physics?.panelDefaults ?? {};
  if (!variant.panels) {
    return [
      {
        ...defaults,
        panelId: `${variant.variantId}:aggregate`,
        normal: { x: 0, y: 1, z: 0 },
        areaM2: variant.totalPanelAreaM2,
        efficiency: variant.referenceEfficiency,
      },
    ];
  }
  return variant.panels.map((panel) => ({ ...defaults, ...panel }));
}

function scaledIrradiance(
  variant: SimulationVariantWorkItem,
  weather: WeatherPoint,
  stepIndex: number,
): InstantSimulationInput["irradiance"] {
  const scale = variant.irradianceScaleByStep?.[stepIndex] ?? variant.irradianceScale ?? 1;
  return {
    ghiWm2: Math.max(0, weather.ghiWm2 * scale),
    dniWm2: Math.max(0, weather.dniWm2 * scale),
    dhiWm2: Math.max(0, weather.dhiWm2 * scale),
  };
}

/** Production step: POA → Faiman temperature → PV → circuit → inverter. */
export const computePhysicsStep: SimulationStepFunction = ({
  input,
  variant,
  weather,
  stepIndex,
  isCancelled,
}) => {
  const panels = resolvedPanels(input, variant);
  const detailedCircuit =
    panels.length > 1 && variant.circuit !== undefined && variant.circuit !== false;
  const panelResults: Array<ReturnType<typeof simulateInstant> & { panelId: string; areaM2: number }> = [];

  for (const panel of panels) {
    if (isCancelled?.()) throw new SimulationCancelledError();
    const electrical: NonNullable<InstantSimulationInput["electrical"]> = {
      ...input.physics?.electrical,
      ...variant.electrical,
      ...panel.electrical,
      ...(detailedCircuit ? { mode: "single-diode" as const } : {}),
    };
    const panelInput: NonNullable<InstantSimulationInput["panel"]> = {
      normal: panel.normal ?? { x: 0, y: 1, z: 0 },
      areaM2: panel.areaM2 ?? PANEL_AREA_M2,
      efficiency: panel.efficiency ?? variant.referenceEfficiency,
      visibility: panel.visibilityByStep?.[stepIndex] ?? panel.visibility,
      diffuseVisibility:
        panel.diffuseVisibilityByStep?.[stepIndex] ?? panel.diffuseVisibility,
      groundVisibility:
        panel.groundVisibilityByStep?.[stepIndex] ?? panel.groundVisibility,
      albedo: panel.albedo,
      iam: panel.iam,
      diffuseModel: panel.diffuseModel,
      soilingLossFraction: panel.soilingLossFraction,
      heightM: panel.heightM,
    };
    const result = simulateInstant({
      timestamp: weather.timeUtcMs,
      location: input.physics?.location,
      solarOverride: input.physics?.solarOverride,
      irradiance: scaledIrradiance(variant, weather, stepIndex),
      panel: panelInput,
      weather: {
        ...input.physics?.weather,
        ambientTemperatureC: weather.ambientC,
        referenceWindSpeedMS: weather.windSpeedMs,
      },
      electrical,
      inverter: false,
      thermal: input.physics?.thermal,
      rotation: variant.rotation,
    });
    panelResults.push({
      ...result,
      panelId: panel.panelId,
      areaM2: panelInput.areaM2 ?? PANEL_AREA_M2,
    });
  }

  const topology = variant.topology ?? "series";
  let dcPowerW: number;
  let dcVoltageV: number;
  let dcCurrentA: number;
  let mismatchLossFraction = 0;
  let bypassActiveCount = 0;

  if (detailedCircuit) {
    const devices: CircuitDevice[] = panelResults.map((result) => {
      if (!result.ivCurve) {
        throw new Error(`${variant.variantId}/${result.panelId}의 상세 I-V 곡선이 없습니다.`);
      }
      return { id: result.panelId, curve: result.ivCurve };
    });
    const options = variant.circuit === false || variant.circuit === undefined
      ? {}
      : variant.circuit;
    const circuit = calculateCircuit({ ...options, devices, topology });
    dcPowerW = circuit.mpp.powerW;
    dcVoltageV = circuit.mpp.voltageV;
    dcCurrentA = circuit.mpp.currentA;
    mismatchLossFraction = circuit.mismatchLossFraction;
    bypassActiveCount = circuit.deviceStates.filter((state) => state.bypassConducting).length;
  } else {
    dcPowerW = panelResults.reduce((sum, result) => sum + result.dcPowerW, 0);
    if (panels.length === 1 && !variant.panels) {
      const representative = panelResults[0];
      dcVoltageV = topology === "series"
        ? representative.dcVoltageV * variant.panelCount
        : representative.dcVoltageV;
    } else {
      dcVoltageV = topology === "series"
        ? panelResults.reduce((sum, result) => sum + result.dcVoltageV, 0)
        : Math.max(0, ...panelResults.map((result) => result.dcVoltageV));
    }
    dcCurrentA = dcVoltageV > 0 ? dcPowerW / dcVoltageV : 0;
  }

  const inverterSelection = variant.inverter !== undefined
    ? variant.inverter
    : input.physics?.inverter;
  const inverter = inverterSelection === false
    ? undefined
    : calculateInverter({
        dcPowerW,
        dcVoltageV,
        dcCurrentA,
        ...(inverterSelection ? { config: inverterSelection } : {}),
      });
  const totalArea = panelResults.reduce((sum, result) => sum + result.areaM2, 0);
  const weighted = (selector: (result: (typeof panelResults)[number]) => number) =>
    totalArea > 0
      ? panelResults.reduce((sum, result) => sum + selector(result) * result.areaM2, 0) / totalArea
      : 0;

  return {
    dcPowerW,
    acPowerW: inverter?.acPowerW ?? dcPowerW,
    poaWm2: weighted((result) => result.poa.totalWm2),
    moduleTemperatureC: weighted((result) => result.moduleTemperatureC),
    mismatchLossFraction,
    bypassActiveCount,
    inverterStatus: inverter?.status ?? "disabled",
  };
};

function normalizedStepResult(
  result: number | SimulationPhysicsStepResult,
  weather: WeatherPoint,
): SimulationPhysicsStepResult {
  const normalized = typeof result === "number"
    ? {
        dcPowerW: result,
        acPowerW: result,
        poaWm2: 0,
        moduleTemperatureC: weather.ambientC,
        mismatchLossFraction: 0,
        bypassActiveCount: 0,
        inverterStatus: "disabled" as const,
      }
    : result;
  const numericValues = [
    normalized.dcPowerW,
    normalized.acPowerW,
    normalized.poaWm2,
    normalized.moduleTemperatureC,
    normalized.mismatchLossFraction,
    normalized.bypassActiveCount,
  ];
  if (
    numericValues.some((value) => !Number.isFinite(value)) ||
    normalized.dcPowerW < 0 ||
    normalized.acPowerW < 0 ||
    normalized.poaWm2 < 0 ||
    normalized.mismatchLossFraction < 0 ||
    normalized.mismatchLossFraction > 1 ||
    normalized.bypassActiveCount < 0
  ) {
    throw new Error("워커 물리 단계가 유효하지 않은 값을 반환했습니다.");
  }
  return normalized;
}

interface MonthlyAccumulator {
  dcEnergyWhByVariant: Record<string, number>;
  acEnergyWhByVariant: Record<string, number>;
}

function monthKey(timeUtcMs: number): string {
  return new Date(timeUtcMs).toISOString().slice(0, 7);
}

function nextMonthUtc(timeUtcMs: number): number {
  const date = new Date(timeUtcMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function addEnergySegment(
  monthly: Map<string, MonthlyAccumulator>,
  variantIds: readonly string[],
  startMs: number,
  endMs: number,
  previous: Record<string, SimulationPhysicsStepResult>,
  current: Record<string, SimulationPhysicsStepResult>,
  totalDc: Record<string, number>,
  totalAc: Record<string, number>,
): void {
  const durationMs = endMs - startMs;
  if (!(durationMs > 0)) return;
  let segmentStart = startMs;
  while (segmentStart < endMs) {
    const segmentEnd = Math.min(endMs, nextMonthUtc(segmentStart));
    const startFraction = (segmentStart - startMs) / durationMs;
    const endFraction = (segmentEnd - startMs) / durationMs;
    const hours = (segmentEnd - segmentStart) / 3_600_000;
    const key = monthKey(segmentStart);
    let bucket = monthly.get(key);
    if (!bucket) {
      bucket = {
        dcEnergyWhByVariant: Object.fromEntries(variantIds.map((id) => [id, 0])),
        acEnergyWhByVariant: Object.fromEntries(variantIds.map((id) => [id, 0])),
      };
      monthly.set(key, bucket);
    }
    for (const variantId of variantIds) {
      const previousStep = previous[variantId];
      const currentStep = current[variantId];
      const interpolate = (left: number, right: number, fraction: number) =>
        left + (right - left) * fraction;
      const dcStart = interpolate(previousStep.dcPowerW, currentStep.dcPowerW, startFraction);
      const dcEnd = interpolate(previousStep.dcPowerW, currentStep.dcPowerW, endFraction);
      const acStart = interpolate(previousStep.acPowerW, currentStep.acPowerW, startFraction);
      const acEnd = interpolate(previousStep.acPowerW, currentStep.acPowerW, endFraction);
      const dcEnergy = 0.5 * (dcStart + dcEnd) * hours;
      const acEnergy = 0.5 * (acStart + acEnd) * hours;
      bucket.dcEnergyWhByVariant[variantId] += dcEnergy;
      bucket.acEnergyWhByVariant[variantId] += acEnergy;
      totalDc[variantId] += dcEnergy;
      totalAc[variantId] += acEnergy;
    }
    segmentStart = segmentEnd;
  }
}

export async function runSimulationKernel(
  request: SimulationRunRequest,
  hooks: SimulationKernelHooks = {},
  computeStep: SimulationStepFunction = computePhysicsStep,
): Promise<SimulationCompleteEvent> {
  if (request.protocolVersion !== SIMULATION_WORKER_PROTOCOL_VERSION) {
    throw new Error(`지원하지 않는 워커 protocol v${request.protocolVersion}`);
  }
  if (!request.requestId.trim() || !request.fingerprint.trim()) {
    throw new TypeError("requestId와 fingerprint는 비어 있을 수 없습니다.");
  }
  const input = validateKernelInput(request.input);
  const chunkSize = input.chunkSize ?? 24;
  const mode = input.mode ?? "time-series";
  const variantIds = input.variants.map((variant) => variant.variantId);
  const dcEnergyWhByVariant = Object.fromEntries(variantIds.map((id) => [id, 0]));
  const acEnergyWhByVariant = Object.fromEntries(variantIds.map((id) => [id, 0]));
  const monthly = new Map<string, MonthlyAccumulator>();
  const startedAt = Date.now();
  const workPerStep = input.variants.reduce(
    (sum, variant) => sum + Math.max(1, variant.panels?.length ?? 1),
    0,
  );
  const totalWork = input.weather.length * workPerStep;
  let previousResults: Record<string, SimulationPhysicsStepResult> | undefined;
  let previousTimeMs: number | undefined;

  const emitProgress = async (completed: number): Promise<void> => {
    const fraction = completed / input.weather.length;
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const estimatedRemainingMs = completed > 0 && completed < input.weather.length
      ? elapsedMs * (input.weather.length - completed) / completed
      : undefined;
    await hooks.onProgress?.({
      protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
      type: "simulation/progress",
      requestId: request.requestId,
      fingerprint: request.fingerprint,
      completed,
      total: input.weather.length,
      completedWork: completed * workPerStep,
      totalWork,
      fraction,
      elapsedMs,
      ...(estimatedRemainingMs === undefined ? {} : { estimatedRemainingMs }),
    });
  };

  await emitProgress(0);
  for (let offset = 0; offset < input.weather.length; offset += chunkSize) {
    if (hooks.isCancelled?.()) throw new SimulationCancelledError();
    const end = Math.min(input.weather.length, offset + chunkSize);
    const rows: SimulationResultRow[] = [];
    for (let stepIndex = offset; stepIndex < end; stepIndex += 1) {
      if (hooks.isCancelled?.()) throw new SimulationCancelledError();
      const weather = input.weather[stepIndex];
      const stepResults: Record<string, SimulationPhysicsStepResult> = {};
      for (const variant of input.variants) {
        if (hooks.isCancelled?.()) throw new SimulationCancelledError();
        const rawResult = computeStep({
          input,
          variant,
          weather,
          stepIndex,
          isCancelled: hooks.isCancelled,
        });
        stepResults[variant.variantId] = normalizedStepResult(rawResult, weather);
      }

      if (previousResults && previousTimeMs !== undefined) {
        addEnergySegment(
          monthly,
          variantIds,
          previousTimeMs,
          weather.timeUtcMs,
          previousResults,
          stepResults,
          dcEnergyWhByVariant,
          acEnergyWhByVariant,
        );
      }
      previousResults = stepResults;
      previousTimeMs = weather.timeUtcMs;
      rows.push({
        timeUtcMs: weather.timeUtcMs,
        dcPowerWByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].dcPowerW]),
        ),
        acPowerWByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].acPowerW]),
        ),
        poaWm2ByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].poaWm2]),
        ),
        moduleTemperatureCByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].moduleTemperatureC]),
        ),
        mismatchLossFractionByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].mismatchLossFraction]),
        ),
        bypassActiveCountByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].bypassActiveCount]),
        ),
        inverterStatusByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].inverterStatus]),
        ),
      });
    }
    await hooks.onChunk?.({
      protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
      type: "simulation/chunk",
      requestId: request.requestId,
      fingerprint: request.fingerprint,
      offset,
      rows,
    });
    await emitProgress(end);
    await (hooks.yieldControl ?? defaultYield)();
  }

  if (hooks.isCancelled?.()) throw new SimulationCancelledError();
  const monthlyEnergy: SimulationMonthlyEnergy[] = [...monthly.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthUtc, value]) => ({ monthUtc, ...value }));
  const firstTime = input.weather[0].timeUtcMs;
  const lastTime = input.weather.at(-1)?.timeUtcMs ?? firstTime;
  return {
    protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
    type: "simulation/complete",
    requestId: request.requestId,
    fingerprint: request.fingerprint,
    mode,
    energyWhByVariant: { ...dcEnergyWhByVariant },
    dcEnergyWhByVariant,
    acEnergyWhByVariant,
    monthlyEnergy,
    steps: input.weather.length,
    durationHours: (lastTime - firstTime) / 3_600_000,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
}
