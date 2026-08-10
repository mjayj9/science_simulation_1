import {
  MAX_PANELS_PER_VARIANT,
  MAX_VARIANTS,
  PANEL_AREA_M2,
} from "../lib/geometry";
import {
  calculateCircuit,
  calculateInverter,
  createPanelFrame,
  cross,
  dot,
  fixedRotation,
  multiplyQuaternion,
  normalize,
  normalizeQuaternion,
  quaternionBetween,
  quaternionFromAxisAngle,
  rotateAroundY,
  rotateVector,
  simulateInstant,
  type CircuitDevice,
  type InstantSimulationInput,
  type InverterResult,
  type Quaternion,
  type Vec3,
} from "../lib/physics";
import type { WeatherPoint } from "../lib/weather";
import {
  SIMULATION_WORKER_PROTOCOL_VERSION,
  type SimulationChunkEvent,
  type SimulationCompleteEvent,
  type SimulationGhiClosureDiagnostic,
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
  ghiClosure: SimulationGhiClosureDiagnostic;
  /** True when power is an angular midpoint average over [t, t + dt]. */
  rotationIntervalAveraged: boolean;
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

function assertVec3(value: Vec3 | undefined, label: string, allowZero = false): void {
  if (value === undefined) return;
  const components = [value.x, value.y, value.z];
  if (
    components.some((component) => !Number.isFinite(component)) ||
    (!allowZero && Math.hypot(...components) < 1e-12)
  ) {
    throw new RangeError(`${label} 벡터가 올바르지 않습니다.`);
  }
}

function assertQuaternion(value: Quaternion | undefined, label: string): void {
  if (value === undefined) return;
  const components = [value.x, value.y, value.z, value.w];
  if (
    components.some((component) => !Number.isFinite(component)) ||
    Math.hypot(...components) < 1e-12
  ) {
    throw new RangeError(`${label} quaternion이 올바르지 않습니다.`);
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
    if (
      variant.rotationPhaseSamples !== undefined &&
      (!Number.isInteger(variant.rotationPhaseSamples) ||
        variant.rotationPhaseSamples < 1 ||
        variant.rotationPhaseSamples > 720)
    ) {
      throw new RangeError(`${variant.variantId}.rotationPhaseSamples는 1~720 정수여야 합니다.`);
    }
    if (
      (variant.rotationPhaseSamples ?? 1) > 1 &&
      variant.rotation?.mode !== "fixed"
    ) {
      throw new RangeError(`${variant.variantId} 위상 평균에는 fixed 회전 설정이 필요합니다.`);
    }
    if (
      variant.rotation?.mode === "static" &&
      variant.rotation.angleRad !== undefined &&
      !Number.isFinite(variant.rotation.angleRad)
    ) {
      throw new RangeError(`${variant.variantId} 정적 회전각은 유한수여야 합니다.`);
    }
    if (variant.rotation?.mode === "fixed") {
      if (
        !Number.isFinite(variant.rotation.rpm) ||
        (variant.rotation.initialAngleRad !== undefined &&
          !Number.isFinite(variant.rotation.initialAngleRad))
      ) {
        throw new RangeError(`${variant.variantId} 고정 회전 입력은 유한수여야 합니다.`);
      }
      if (variant.rotation.referenceTimestamp !== undefined) {
        timestampMilliseconds(variant.rotation.referenceTimestamp);
      }
    }

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
        const panelLabel = `${variant.variantId}.panels[${panelIndex}]`;
        assertVec3(panel.normal, `${panelLabel}.normal`);
        assertVec3(panel.positionM, `${panelLabel}.positionM`, true);
        assertVec3(panel.sampleAxisU, `${panelLabel}.sampleAxisU`);
        assertVec3(panel.sampleAxisV, `${panelLabel}.sampleAxisV`);
        assertQuaternion(panel.quaternion, `${panelLabel}.quaternion`);
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
    resolvedPanels(input, variant).forEach((panel) => {
      canonicalPanelPose(panel);
    });
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
  if (input.mode === "annual") {
    if (input.weather.length < 2) {
      throw new RangeError("연간 입력은 하나 이상의 구간과 closing endpoint가 필요합니다.");
    }
    const firstGapMs = input.weather[1].timeUtcMs - input.weather[0].timeUtcMs;
    const isUniformHourly = firstGapMs === 3_600_000 && input.weather
      .slice(2)
      .every((point, index) =>
        point.timeUtcMs - input.weather[index + 1].timeUtcMs === firstGapMs,
      );
    if (isUniformHourly && (input.weather.length === 8_760 || input.weather.length === 8_784)) {
      throw new RangeError(
        "연간 시간별 입력은 closing endpoint를 포함해 평년 8,761개, 윤년 8,785개 점이 필요합니다.",
      );
    }
  }
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

export interface RotatedPanelPose {
  positionM: Vec3;
  normal: Vec3;
  quaternion: Quaternion;
  sampleAxisU: Vec3;
  sampleAxisV: Vec3;
  angleRad: number;
}

interface CanonicalPanelPose {
  normal: Vec3;
  quaternion: Quaternion;
  sampleAxisU: Vec3;
  sampleAxisV: Vec3;
}

const LOCAL_PANEL_NORMAL: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 1 });
const LOCAL_PANEL_U: Readonly<Vec3> = Object.freeze({ x: 1, y: 0, z: 0 });
const LOCAL_PANEL_V: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });
const POSE_ALIGNMENT_TOLERANCE = 1e-6;

function assertDirectionMatches(actual: Vec3, expected: Vec3, label: string): void {
  const alignment = dot(normalize(actual), normalize(expected));
  if (alignment < 1 - POSE_ALIGNMENT_TOLERANCE) {
    throw new RangeError(`${label} 방향이 권위 pose와 일치하지 않습니다.`);
  }
}

function quaternionFromPanelFrame(frame: {
  normal: Vec3;
  sampleAxisU: Vec3;
}): Quaternion {
  const normalQuaternion = quaternionBetween(LOCAL_PANEL_NORMAL, frame.normal);
  const currentU = rotateVector(normalQuaternion, LOCAL_PANEL_U);
  const rollRad = Math.atan2(
    dot(frame.normal, cross(currentU, frame.sampleAxisU)),
    dot(currentU, frame.sampleAxisU),
  );
  return normalizeQuaternion(multiplyQuaternion(
    quaternionFromAxisAngle(frame.normal, rollRad),
    normalQuaternion,
  ));
}

/**
 * Produces one orthonormal source of truth. If quaternion is present it owns
 * normal/U/V and contradictory redundant vectors are rejected. Without a
 * quaternion, normal plus U (or V-derived U) builds a complete right-handed
 * frame and a matching quaternion.
 */
function canonicalPanelPose(panel: SimulationPanelWorkItem): CanonicalPanelPose {
  if (panel.quaternion) {
    const quaternion = normalizeQuaternion(panel.quaternion);
    const normal = rotateVector(quaternion, LOCAL_PANEL_NORMAL);
    const sampleAxisU = rotateVector(quaternion, LOCAL_PANEL_U);
    const sampleAxisV = rotateVector(quaternion, LOCAL_PANEL_V);
    if (panel.normal) assertDirectionMatches(panel.normal, normal, `${panel.panelId}.normal`);
    if (panel.sampleAxisU) {
      assertDirectionMatches(panel.sampleAxisU, sampleAxisU, `${panel.panelId}.sampleAxisU`);
    }
    if (panel.sampleAxisV) {
      assertDirectionMatches(panel.sampleAxisV, sampleAxisV, `${panel.panelId}.sampleAxisV`);
    }
    return { normal, quaternion, sampleAxisU, sampleAxisV };
  }

  const normal = normalize(panel.normal ?? { x: 0, y: 1, z: 0 });
  const requestedU = panel.sampleAxisU ?? (
    panel.sampleAxisV ? cross(panel.sampleAxisV, normal) : undefined
  );
  const frame = createPanelFrame({ normal, sampleAxisU: requestedU });
  if (panel.sampleAxisU) {
    assertDirectionMatches(panel.sampleAxisU, frame.sampleAxisU, `${panel.panelId}.sampleAxisU`);
  }
  if (panel.sampleAxisV) {
    assertDirectionMatches(panel.sampleAxisV, frame.sampleAxisV, `${panel.panelId}.sampleAxisV`);
  }
  return {
    ...frame,
    quaternion: quaternionFromPanelFrame(frame),
  };
}

/**
 * Applies one world +Y transform to every pose quantity used by rendering,
 * ray sampling and POA. Quaternion multiplication is world-first (qY · q0),
 * matching Three.js object rotation around a world Y axis.
 */
export function rotatePanelPoseAroundY(
  panel: SimulationPanelWorkItem,
  angleRad: number,
): RotatedPanelPose {
  if (!Number.isFinite(angleRad)) throw new RangeError("회전각은 유한수여야 합니다.");
  const base = canonicalPanelPose(panel);
  const yQuaternion = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, angleRad);
  return {
    positionM: rotateAroundY(panel.positionM ?? { x: 0, y: 0, z: 0 }, angleRad),
    normal: rotateAroundY(base.normal, angleRad),
    quaternion: normalizeQuaternion(multiplyQuaternion(yQuaternion, base.quaternion)),
    sampleAxisU: rotateAroundY(base.sampleAxisU, angleRad),
    sampleAxisV: rotateAroundY(base.sampleAxisV, angleRad),
    angleRad,
  };
}

function timestampMilliseconds(value: Date | string | number): number {
  const result = value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError("회전 기준 시각이 올바르지 않습니다.");
  return result;
}

function rotationAngleAt(context: SimulationStepContext): number {
  const { input, variant, weather } = context;
  const rotation = variant.rotation;
  if (!rotation) return 0;
  if (rotation.mode === "static") return rotation.angleRad ?? 0;
  const referenceMs = rotation.referenceTimestamp === undefined
    ? input.weather[0].timeUtcMs
    : timestampMilliseconds(rotation.referenceTimestamp);
  return fixedRotation(
    rotation.initialAngleRad ?? 0,
    rotation.rpm,
    (weather.timeUtcMs - referenceMs) / 1_000,
  ).angleRad;
}

function forwardIntervalSeconds(input: SimulationKernelInput, stepIndex: number): number {
  if (stepIndex + 1 >= input.weather.length) return 0;
  return (input.weather[stepIndex + 1].timeUtcMs - input.weather[stepIndex].timeUtcMs) / 1_000;
}

export interface RotationIntervalSample {
  angleRad: number;
  /** Time share represented by this midpoint; all weights sum to one. */
  weight: number;
  intervalAveraged: boolean;
}

interface RotationIntervalPlan {
  startAngleRad: number;
  direction: -1 | 1;
  totalTurns: number;
  completeTurns: number;
  residualTurns: number;
  completeTurnSamples: number;
  residualSamples: number;
  intervalAveraged: boolean;
}

function rotationIntervalPlan(context: SimulationStepContext): RotationIntervalPlan {
  const startAngleRad = rotationAngleAt(context);
  const rotation = context.variant.rotation;
  const samplesPerTurn = context.variant.rotationPhaseSamples ?? 1;
  const intervalSeconds = forwardIntervalSeconds(context.input, context.stepIndex);
  if (
    rotation?.mode !== "fixed" ||
    samplesPerTurn <= 1 ||
    intervalSeconds <= 0 ||
    Math.abs(rotation.rpm) < 1e-15
  ) {
    return {
      startAngleRad,
      direction: 1,
      totalTurns: 0,
      completeTurns: 0,
      residualTurns: 0,
      completeTurnSamples: 0,
      residualSamples: 0,
      intervalAveraged: false,
    };
  }

  const signedTurns = rotation.rpm * intervalSeconds / 60;
  const rawTurns = Math.abs(signedTurns);
  const nearestInteger = Math.round(rawTurns);
  const totalTurns = Math.abs(rawTurns - nearestInteger) < 1e-12
    ? nearestInteger
    : rawTurns;
  const completeTurns = Math.floor(totalTurns);
  const residualTurns = totalTurns - completeTurns;
  return {
    startAngleRad,
    direction: signedTurns < 0 ? -1 : 1,
    totalTurns,
    completeTurns,
    residualTurns,
    // Repeated complete turns are exactly periodic at fixed weather/solar input,
    // so one quadrature cycle represents all of them without duplicate work.
    completeTurnSamples: completeTurns > 0 ? samplesPerTurn : 0,
    residualSamples: residualTurns > 1e-12
      ? Math.max(1, Math.ceil(samplesPerTurn * residualTurns))
      : 0,
    intervalAveraged: totalTurns > 0,
  };
}

/** Actual unique physics evaluations after exact periodic-turn reduction. */
export function rotationPhaseCount(context: SimulationStepContext): number {
  const plan = rotationIntervalPlan(context);
  if (!plan.intervalAveraged) return 1;
  return plan.completeTurnSamples + plan.residualSamples;
}

/**
 * Weighted midpoint quadrature over the exact angular interval [θ(t), θ(t+dt)].
 * Integer turns and the fractional remainder are both retained; there is no
 * threshold at one revolution and no discarded residual arc.
 */
export function rotationIntervalSamples(context: SimulationStepContext): RotationIntervalSample[] {
  const plan = rotationIntervalPlan(context);
  if (!plan.intervalAveraged) {
    return [{ angleRad: plan.startAngleRad, weight: 1, intervalAveraged: false }];
  }
  const samples: RotationIntervalSample[] = [];
  if (plan.completeTurnSamples > 0) {
    const completeWeight = plan.completeTurns / plan.totalTurns;
    for (let index = 0; index < plan.completeTurnSamples; index += 1) {
      samples.push({
        angleRad: fixedRotation(
          plan.startAngleRad +
            plan.direction * 2 * Math.PI * (index + 0.5) / plan.completeTurnSamples,
          0,
          0,
        ).angleRad,
        weight: completeWeight / plan.completeTurnSamples,
        intervalAveraged: true,
      });
    }
  }
  if (plan.residualSamples > 0) {
    const residualWeight = plan.residualTurns / plan.totalTurns;
    const residualArcRad = plan.direction * 2 * Math.PI * plan.residualTurns;
    for (let index = 0; index < plan.residualSamples; index += 1) {
      samples.push({
        angleRad: fixedRotation(
          plan.startAngleRad + residualArcRad * (index + 0.5) / plan.residualSamples,
          0,
          0,
        ).angleRad,
        weight: residualWeight / plan.residualSamples,
        intervalAveraged: true,
      });
    }
  }
  return samples;
}

/** Backward-friendly diagnostic view; use rotationIntervalSamples for integration. */
export function rotationPhaseAngles(context: SimulationStepContext): number[] {
  return rotationIntervalSamples(context).map((sample) => sample.angleRad);
}

/** Production step: POA → Faiman temperature → PV → circuit → inverter. */
function computePhysicsStepAtAngle(
  { input, variant, weather, stepIndex, isCancelled }: SimulationStepContext,
  angleRad: number,
): SimulationPhysicsStepResult {
  const panels = resolvedPanels(input, variant);
  const detailedCircuit =
    panels.length > 1 && variant.circuit !== undefined && variant.circuit !== false;
  const panelResults: Array<ReturnType<typeof simulateInstant> & { panelId: string; areaM2: number }> = [];

  for (const panel of panels) {
    if (isCancelled?.()) throw new SimulationCancelledError();
    const pose = rotatePanelPoseAroundY(panel, angleRad);
    const electrical: NonNullable<InstantSimulationInput["electrical"]> = {
      ...input.physics?.electrical,
      ...variant.electrical,
      ...panel.electrical,
      ...(detailedCircuit ? { mode: "single-diode" as const } : {}),
    };
    const panelInput: NonNullable<InstantSimulationInput["panel"]> = {
      normal: pose.normal,
      sampleAxisU: pose.sampleAxisU,
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
  const closure = panelResults[0].irradiance.ghiClosure;

  return {
    dcPowerW,
    acPowerW: inverter?.acPowerW ?? dcPowerW,
    poaWm2: weighted((result) => result.poa.totalWm2),
    moduleTemperatureC: weighted((result) => result.moduleTemperatureC),
    mismatchLossFraction,
    bypassActiveCount,
    inverterStatus: inverter?.status ?? "disabled",
    ghiClosure: {
      residualWm2: closure.residualWm2,
      relativeResidual: closure.relativeResidual,
      toleranceWm2: closure.toleranceWm2,
      isClosed: closure.isClosed,
      policy: "preserve-source-and-warn",
    },
    rotationIntervalAveraged: false,
  };
}

function averagePhaseResults(
  results: readonly SimulationPhysicsStepResult[],
  samples: readonly RotationIntervalSample[],
): SimulationPhysicsStepResult {
  const average = (selector: (result: SimulationPhysicsStepResult) => number): number =>
    results.reduce((sum, result, index) => sum + selector(result) * samples[index].weight, 0);
  const statusCounts = new Map<SimulationPhysicsStepResult["inverterStatus"], number>();
  results.forEach((result, index) => {
    statusCounts.set(
      result.inverterStatus,
      (statusCounts.get(result.inverterStatus) ?? 0) + samples[index].weight,
    );
  });
  const inverterStatus = [...statusCounts.entries()]
    .sort(([leftStatus, leftCount], [rightStatus, rightCount]) =>
      rightCount - leftCount || leftStatus.localeCompare(rightStatus),
    )[0][0];
  return {
    dcPowerW: average((result) => result.dcPowerW),
    acPowerW: average((result) => result.acPowerW),
    poaWm2: average((result) => result.poaWm2),
    moduleTemperatureC: average((result) => result.moduleTemperatureC),
    mismatchLossFraction: average((result) => result.mismatchLossFraction),
    bypassActiveCount: average((result) => result.bypassActiveCount),
    inverterStatus,
    ghiClosure: {
      residualWm2: average((result) => result.ghiClosure.residualWm2),
      relativeResidual: average((result) => result.ghiClosure.relativeResidual),
      toleranceWm2: average((result) => result.ghiClosure.toleranceWm2),
      isClosed: results.every((result) => result.ghiClosure.isClosed),
      policy: results.every((result) => result.ghiClosure.policy === "not-evaluated")
        ? "not-evaluated"
        : "preserve-source-and-warn",
    },
    rotationIntervalAveraged: true,
  };
}

/**
 * Production step: exact hourly GHI/DNI/DHI → shared simulateInstant/POA →
 * circuit → inverter. Annual fixed-rotation inputs may request full-cycle
 * midpoint averaging through `rotationPhaseSamples`.
 */
export const computePhysicsStep: SimulationStepFunction = (context) => {
  const samples = rotationIntervalSamples(context);
  if (samples.length === 1) {
    const result = computePhysicsStepAtAngle(context, samples[0].angleRad);
    return {
      ...result,
      rotationIntervalAveraged: samples[0].intervalAveraged,
    };
  }
  const results: SimulationPhysicsStepResult[] = [];
  for (const sample of samples) {
    if (context.isCancelled?.()) throw new SimulationCancelledError();
    results.push(computePhysicsStepAtAngle(context, sample.angleRad));
  }
  return averagePhaseResults(results, samples);
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
        ghiClosure: {
          residualWm2: 0,
          relativeResidual: 0,
          toleranceWm2: 0,
          isClosed: true,
          policy: "not-evaluated" as const,
        },
        rotationIntervalAveraged: false,
      }
    : {
        ...result,
        ghiClosure: result.ghiClosure ?? {
          residualWm2: 0,
          relativeResidual: 0,
          toleranceWm2: 0,
          isClosed: true,
          policy: "not-evaluated" as const,
        },
        rotationIntervalAveraged: result.rotationIntervalAveraged ?? false,
      };
  const numericValues = [
    normalized.dcPowerW,
    normalized.acPowerW,
    normalized.poaWm2,
    normalized.moduleTemperatureC,
    normalized.mismatchLossFraction,
    normalized.bypassActiveCount,
    normalized.ghiClosure.residualWm2,
    normalized.ghiClosure.relativeResidual,
    normalized.ghiClosure.toleranceWm2,
  ];
  if (
    numericValues.some((value) => !Number.isFinite(value)) ||
    normalized.dcPowerW < 0 ||
    normalized.acPowerW < 0 ||
    normalized.poaWm2 < 0 ||
    normalized.mismatchLossFraction < 0 ||
    normalized.mismatchLossFraction > 1 ||
    normalized.bypassActiveCount < 0 ||
    normalized.ghiClosure.relativeResidual < 0 ||
    normalized.ghiClosure.toleranceWm2 < 0
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
      const dcStart = previousStep.rotationIntervalAveraged
        ? previousStep.dcPowerW
        : interpolate(previousStep.dcPowerW, currentStep.dcPowerW, startFraction);
      const dcEnd = previousStep.rotationIntervalAveraged
        ? previousStep.dcPowerW
        : interpolate(previousStep.dcPowerW, currentStep.dcPowerW, endFraction);
      const acStart = previousStep.rotationIntervalAveraged
        ? previousStep.acPowerW
        : interpolate(previousStep.acPowerW, currentStep.acPowerW, startFraction);
      const acEnd = previousStep.rotationIntervalAveraged
        ? previousStep.acPowerW
        : interpolate(previousStep.acPowerW, currentStep.acPowerW, endFraction);
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
  const workByStep = input.weather.map((weather, stepIndex) =>
    input.variants.reduce((sum, variant) => {
      const phaseCount = computeStep === computePhysicsStep
        ? rotationPhaseCount({ input, variant, weather, stepIndex })
        : 1;
      return sum + Math.max(1, variant.panels?.length ?? 1) * phaseCount;
    }, 0),
  );
  const cumulativeWork = workByStep.reduce<number[]>((prefix, work) => {
    prefix.push(prefix[prefix.length - 1] + work);
    return prefix;
  }, [0]);
  const totalWork = cumulativeWork[cumulativeWork.length - 1];
  let previousResults: Record<string, SimulationPhysicsStepResult> | undefined;
  let previousTimeMs: number | undefined;
  let ghiClosureWarningCount = 0;

  const emitProgress = async (completed: number): Promise<void> => {
    const completedWork = cumulativeWork[completed];
    const fraction = totalWork > 0 ? completedWork / totalWork : 1;
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const estimatedRemainingMs = completedWork > 0 && completedWork < totalWork
      ? elapsedMs * (totalWork - completedWork) / completedWork
      : undefined;
    await hooks.onProgress?.({
      protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
      type: "simulation/progress",
      requestId: request.requestId,
      fingerprint: request.fingerprint,
      completed,
      total: input.weather.length,
      completedWork,
      totalWork,
      fraction,
      ghiClosureWarningCount,
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
        if (!stepResults[variant.variantId].ghiClosure.isClosed) {
          ghiClosureWarningCount += 1;
        }
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
        ghiClosureByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].ghiClosure]),
        ),
        rotationIntervalAveragedByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].rotationIntervalAveraged]),
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
    intervals: Math.max(0, input.weather.length - 1),
    durationHours: (lastTime - firstTime) / 3_600_000,
    ghiClosureWarningCount,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
}
