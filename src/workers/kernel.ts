import {
  MAX_PANELS_PER_VARIANT,
  PANEL_AREA_M2,
} from "../lib/geometry";
import { simulateAnnualRotationDecomposition } from "../lib/physics/annual-transient";
import { thermalModelMetadata } from "../lib/physics/annual-transient";
import {
  DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER,
  calculateCircuit,
  calculateInverter,
  createPanelFrame,
  cross,
  dot,
  fixedRotation,
  multiplyQuaternion,
  motorDrivePowerW,
  normalize,
  normalizeQuaternion,
  quaternionBetween,
  quaternionFromAxisAngle,
  rotateAroundY,
  rotateVector,
  scaleElectricalConfigForArea,
  singleDiodeCurve,
  solveEngineeringSurfaceElectrical,
  simulateInstant,
  solarPosition,
  sunVector,
  type CircuitDevice,
  type ElectricalConfig,
  type InstantSimulationInput,
  type InverterConfig,
  type InverterResult,
  type IVCurve,
  type Quaternion,
  type Vec3,
} from "../lib/physics";
import type { WeatherPoint } from "../lib/weather";
import {
  CONTINUOUS_SURFACE_MODEL_VERSION,
  MAX_SIMULATION_VARIANTS,
  SIMULATION_WORKER_PROTOCOL_VERSION,
  type SimulationChunkEvent,
  type SimulationCompleteEvent,
  type SimulationContinuousSurfaceSample,
  type SimulationGhiClosureDiagnostic,
  type SimulationKernelInput,
  type SimulationMonthlyEnergy,
  type SimulationPanelWorkItem,
  type SimulationPlaneTracking,
  type SimulationProgressEvent,
  type SimulationResultRow,
  type SimulationRunRequest,
  type SimulationObstacleBounds,
  type SimulationSurfaceSample,
  type SimulationSurfaceRegionResult,
  type SimulationVariantWorkItem,
} from "./protocol";

const MAX_SURFACE_SAMPLES_PER_ZONE = 256;
const MAX_CONTINUOUS_SURFACE_SAMPLES = 32_768;
const MAX_ENGINEERING_SURFACE_CELLS = 4_096;
const MAX_OBSTACLE_BOUNDS_PER_VARIANT = 256;
const WORLD_UP: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });

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
  /** Electrical motor demand already deducted from acPowerW. */
  motorPowerW?: number;
  poaWm2: number;
  moduleTemperatureC: number;
  mismatchLossFraction: number;
  bypassActiveCount: number;
  inverterStatus: InverterResult["status"] | "disabled";
  ghiClosure: SimulationGhiClosureDiagnostic;
  /** True when power is an angular midpoint average over [t, t + dt]. */
  rotationIntervalAveraged: boolean;
  /** Reporting regions only; never electrical strings or normalization units. */
  surfaceRegions?: Record<string, SimulationSurfaceRegionResult>;
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
  (variant.continuousSurface?.activeAreaM2 ?? variant.totalPanelAreaM2 ?? 0) *
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

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and greater than zero.`);
  }
}

function validateEngineeringSurfaceConnection(
  surface: NonNullable<SimulationVariantWorkItem["continuousSurface"]>,
  variantId: string,
): void {
  const label = `${variantId}.continuousSurface`;
  if (
    surface.electricalModel !== "local-mpp-area-integral" &&
    surface.electricalModel !== "explicit-series-parallel-bypass"
  ) {
    throw new RangeError(`${label}.electricalModel is not supported.`);
  }
  if (surface.electricalModel === "local-mpp-area-integral") {
    if (surface.engineeringConnection !== undefined) {
      throw new RangeError(`${label}.engineeringConnection is only valid for the explicit electrical model.`);
    }
    return;
  }
  const connection = surface.engineeringConnection;
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
    throw new RangeError(`${label}.engineeringConnection is required.`);
  }
  assertPositiveFinite(connection.nominalCellAreaM2, `${label}.engineeringConnection.nominalCellAreaM2`);
  if (!Number.isInteger(connection.parallelStrings) || connection.parallelStrings < 1) {
    throw new RangeError(`${label}.engineeringConnection.parallelStrings must be a positive integer.`);
  }
  if (!Number.isInteger(connection.cellsPerBypassSubstring) || connection.cellsPerBypassSubstring < 1) {
    throw new RangeError(`${label}.engineeringConnection.cellsPerBypassSubstring must be a positive integer.`);
  }
  const cellCount = Math.max(
    1,
    Math.ceil(surface.activeAreaM2 / connection.nominalCellAreaM2 - 1e-10),
  );
  if (cellCount > MAX_ENGINEERING_SURFACE_CELLS) {
    throw new RangeError(
      `${label}.engineeringConnection creates ${cellCount} cells; maximum is ${MAX_ENGINEERING_SURFACE_CELLS}.`,
    );
  }
  if (connection.parallelStrings > cellCount) {
    throw new RangeError(`${label}.engineeringConnection.parallelStrings cannot exceed cell count.`);
  }
  if (connection.cellsPerBypassSubstring > 10_000) {
    throw new RangeError(`${label}.engineeringConnection.cellsPerBypassSubstring cannot exceed 10000.`);
  }
  const nonNegativeFields = [
    ["bypassForwardVoltageV", connection.bypassForwardVoltageV],
    ["stringWiringResistanceOhm", connection.stringWiringResistanceOhm],
    ["arrayWiringResistanceOhm", connection.arrayWiringResistanceOhm],
  ] as const;
  nonNegativeFields.forEach(([field, value]) => {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`${label}.engineeringConnection.${field} must be finite and non-negative.`);
    }
  });
  if (
    connection.cellIvModel !== undefined &&
    connection.cellIvModel !== "piecewise-nameplate" &&
    connection.cellIvModel !== "single-diode"
  ) {
    throw new RangeError(`${label}.engineeringConnection.cellIvModel is not supported.`);
  }
  const integerFields = [
    ["cellCurveSamples", connection.cellCurveSamples, 16, 512],
    ["circuitSamples", connection.circuitSamples, 32, 1_024],
  ] as const;
  integerFields.forEach(([field, value, lower, upper]) => {
    if (value !== undefined && (!Number.isInteger(value) || value < lower || value > upper)) {
      throw new RangeError(
        `${label}.engineeringConnection.${field} must be an integer in [${lower}, ${upper}].`,
      );
    }
  });
}

function validateContinuousSurfaceVariant(
  variant: SimulationVariantWorkItem,
): void {
  const surface = variant.continuousSurface;
  if (!surface) return;
  if (
    variant.panelCount !== undefined ||
    variant.totalPanelAreaM2 !== undefined ||
    variant.panels !== undefined ||
    variant.topology !== undefined ||
    variant.circuit !== undefined ||
    variant.electricalFairnessMode !== undefined
  ) {
    throw new RangeError(
      `${variant.variantId}.continuousSurface cannot include discrete panel/count/circuit fields.`,
    );
  }
  if (surface.modelVersion !== CONTINUOUS_SURFACE_MODEL_VERSION) {
    throw new RangeError(`${variant.variantId}.continuousSurface.modelVersion is not supported.`);
  }
  if (!surface.meshVersion.trim() || surface.meshVersion.length > 200) {
    throw new RangeError(`${variant.variantId}.continuousSurface.meshVersion is invalid.`);
  }
  assertPositiveFinite(surface.landAreaM2, `${variant.variantId}.continuousSurface.landAreaM2`);
  assertPositiveFinite(surface.activeAreaM2, `${variant.variantId}.continuousSurface.activeAreaM2`);
  validateEngineeringSurfaceConnection(surface, variant.variantId);
  if (!Number.isFinite(surface.heightM) || surface.heightM < 0) {
    throw new RangeError(`${variant.variantId}.continuousSurface.heightM is invalid.`);
  }
  if (
    surface.tiltDeg !== undefined &&
    (!Number.isFinite(surface.tiltDeg) || surface.tiltDeg < 0 || surface.tiltDeg > 75)
  ) {
    throw new RangeError(`${variant.variantId}.continuousSurface.tiltDeg must be in 0-75 degrees.`);
  }
  if (!Number.isInteger(surface.azimuthSamples) || surface.azimuthSamples < 1) {
    throw new RangeError(`${variant.variantId}.continuousSurface.azimuthSamples is invalid.`);
  }
  if (
    !Array.isArray(surface.samples) ||
    surface.samples.length < 1 ||
    surface.samples.length > MAX_CONTINUOUS_SURFACE_SAMPLES ||
    surface.integrationSampleCount !== surface.samples.length
  ) {
    throw new RangeError(
      `${variant.variantId}.continuousSurface samples must match integrationSampleCount and contain 1-${MAX_CONTINUOUS_SURFACE_SAMPLES} points.`,
    );
  }
  let integratedAreaM2 = 0;
  surface.samples.forEach((sample, sampleIndex) => {
    const label = `${variant.variantId}.continuousSurface.samples[${sampleIndex}]`;
    assertVec3(sample.positionM, `${label}.positionM`, true);
    assertVec3(sample.normal, `${label}.normal`);
    assertPositiveFinite(sample.areaM2, `${label}.areaM2`);
    if (sample.regionId !== undefined && (!sample.regionId.trim() || sample.regionId.length > 100)) {
      throw new RangeError(`${label}.regionId is invalid.`);
    }
    integratedAreaM2 += sample.areaM2;
  });
  const areaTolerance = Math.max(1e-10, surface.activeAreaM2 * 1e-8);
  if (Math.abs(integratedAreaM2 - surface.activeAreaM2) > areaTolerance) {
    throw new RangeError(
      `${variant.variantId}.continuousSurface sample area sum must equal activeAreaM2.`,
    );
  }
  const options = surface.surfaceOptions;
  assertUnitFraction(options?.visibility, `${variant.variantId}.continuousSurface.visibility`);
  assertUnitFraction(options?.diffuseVisibility, `${variant.variantId}.continuousSurface.diffuseVisibility`);
  assertUnitFraction(options?.groundVisibility, `${variant.variantId}.continuousSurface.groundVisibility`);
  assertUnitFraction(options?.albedo, `${variant.variantId}.continuousSurface.albedo`);
  assertUnitFraction(options?.soilingLossFraction, `${variant.variantId}.continuousSurface.soilingLossFraction`);
  assertVec3(options?.sampleAxisU, `${variant.variantId}.continuousSurface.sampleAxisU`);
}

export function validateKernelInput(input: SimulationKernelInput): SimulationKernelInput {
  if (
    !Array.isArray(input.variants) ||
    input.variants.length < 1 ||
    input.variants.length > MAX_SIMULATION_VARIANTS
  ) {
    throw new RangeError(`워커 계산 variant는 1~${MAX_SIMULATION_VARIANTS}개여야 합니다.`);
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
    validateContinuousSurfaceVariant(variant);
    if (!variant.continuousSurface) {
      if (
        !Number.isInteger(variant.panelCount) ||
        (variant.panelCount ?? 0) < 1 ||
        (variant.panelCount ?? 0) > MAX_PANELS_PER_VARIANT
      ) {
        throw new RangeError(`형상별 패널 수는 1~${MAX_PANELS_PER_VARIANT}개여야 합니다.`);
      }
      totalPanels += variant.panelCount ?? 0;
      const expectedArea = (variant.panelCount ?? 0) * PANEL_AREA_M2;
      if (
        !Number.isFinite(variant.totalPanelAreaM2) ||
        Math.abs((variant.totalPanelAreaM2 ?? 0) - expectedArea) > 1e-10
      ) {
        throw new RangeError(
          `${variant.variantId}의 패널 면적은 0.0025 m² × 패널 수와 같아야 합니다.`,
        );
      }
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
    if (variant.obstacleBounds !== undefined) {
      if (
        !Array.isArray(variant.obstacleBounds) ||
        variant.obstacleBounds.length > MAX_OBSTACLE_BOUNDS_PER_VARIANT
      ) {
        throw new RangeError(
          `${variant.variantId}.obstacleBounds must contain at most ${MAX_OBSTACLE_BOUNDS_PER_VARIANT} bounds.`,
        );
      }
      variant.obstacleBounds.forEach((bounds, obstacleIndex) => {
        const obstacleLabel = `${variant.variantId}.obstacleBounds[${obstacleIndex}]`;
        assertVec3(bounds.min, `${obstacleLabel}.min`, true);
        assertVec3(bounds.max, `${obstacleLabel}.max`, true);
        for (const axis of ["x", "y", "z"] as const) {
          if (bounds.min[axis] > bounds.max[axis]) {
            throw new RangeError(`${obstacleLabel}.min.${axis} must not exceed max.${axis}.`);
          }
        }
      });
    }
    if (variant.planeTracking !== undefined) {
      if (
        variant.planeTracking.mode !== "single-axis-north-south" &&
        variant.planeTracking.mode !== "dual-axis"
      ) {
        throw new RangeError(`${variant.variantId}.planeTracking.mode is not supported.`);
      }
      if (!variant.planeTracking.centreM) {
        throw new RangeError(`${variant.variantId}.planeTracking.centreM is required.`);
      }
      assertVec3(variant.planeTracking.centreM, `${variant.variantId}.planeTracking.centreM`, true);
      if (variant.rotation !== undefined) {
        throw new RangeError(
          `${variant.variantId}.planeTracking and rotation are mutually exclusive.`,
        );
      }
    }
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
    if (variant.rotationRpmByWeatherStep !== undefined) {
      if (!Array.isArray(variant.rotationRpmByWeatherStep)) {
        throw new RangeError(`${variant.variantId}.rotationRpmByWeatherStep must be an array.`);
      }
      validateDynamicSeries(
        variant.rotationRpmByWeatherStep,
        input.weather.length,
        `${variant.variantId}.rotationRpmByWeatherStep`,
      );
      if (variant.rotation?.mode !== "fixed") {
        throw new RangeError(
          `${variant.variantId}.rotationRpmByWeatherStep requires fixed rotation.`,
        );
      }
      if (variant.rotation.referenceTimestamp !== undefined) {
        throw new RangeError(
          `${variant.variantId}.rotationRpmByWeatherStep starts at weather[0] and cannot use referenceTimestamp.`,
        );
      }
      if (variant.motorDrive !== undefined) {
        throw new RangeError(
          `${variant.variantId}.rotationRpmByWeatherStep is natural rotation and cannot use motorDrive.`,
        );
      }
    }
    if (variant.motorDrive !== undefined) {
      if (variant.rotation?.mode !== "fixed") {
        throw new RangeError(`${variant.variantId}.motorDrive requires fixed RPM rotation.`);
      }
      if (
        !Number.isFinite(variant.motorDrive.requiredTorqueNm)
        || variant.motorDrive.requiredTorqueNm < 0
        || !Number.isFinite(variant.motorDrive.motorEfficiency)
        || variant.motorDrive.motorEfficiency <= 0
        || variant.motorDrive.motorEfficiency > 1
      ) {
        throw new RangeError(
          `${variant.variantId}.motorDrive requires nonnegative torque and 0 < efficiency <= 1.`,
        );
      }
    }
    if (
      variant.electricalFairnessMode !== undefined &&
      variant.electricalFairnessMode !== "shared-circuit" &&
      variant.electricalFairnessMode !== "independent-mppt"
    ) {
      throw new RangeError(
        `${variant.variantId}.electricalFairnessMode is not supported.`,
      );
    }
    if (variant.annualTransientThermal !== undefined) {
      const transient = variant.annualTransientThermal;
      const workerSurface = variant.continuousSurface;
      if (input.mode !== "annual") {
        throw new RangeError(`${variant.variantId}.annualTransientThermal requires annual mode.`);
      }
      if (workerSurface === undefined) {
        throw new RangeError(`${variant.variantId}.annualTransientThermal requires a continuous surface.`);
      }
      if (workerSurface.electricalModel !== "local-mpp-area-integral") {
        throw new RangeError(
          `${variant.variantId}.annualTransientThermal does not yet support explicit engineering electrical connections.`,
        );
      }
      if (variant.obstacleBounds !== undefined) {
        throw new RangeError(`${variant.variantId}.annualTransientThermal does not support obstacleBounds.`);
      }
      if (variant.planeTracking !== undefined) {
        throw new RangeError(`${variant.variantId}.annualTransientThermal does not support planeTracking.`);
      }
      if (transient.surface.kind !== workerSurface.shape) {
        throw new RangeError(`${variant.variantId}.annualTransientThermal surface shape must match the worker surface.`);
      }
      const transientSamples = transient.surface.zones.flatMap((zone) => zone.samples);
      const geometryTolerance = (scale: number) => Math.max(1e-10, Math.abs(scale) * 1e-8);
      if (Math.abs(transient.surface.dimensions.activeAreaM2 - workerSurface.activeAreaM2)
        > geometryTolerance(workerSurface.activeAreaM2)) {
        throw new RangeError(`${variant.variantId}.annualTransientThermal active area must match the worker surface.`);
      }
      if (Math.abs(transient.surface.dimensions.heightM - workerSurface.heightM)
        > geometryTolerance(workerSurface.heightM)) {
        throw new RangeError(`${variant.variantId}.annualTransientThermal height must match the worker surface.`);
      }
      if (transientSamples.length !== workerSurface.samples.length
        || transientSamples.length !== workerSurface.integrationSampleCount) {
        throw new RangeError(`${variant.variantId}.annualTransientThermal sample count must match the worker surface.`);
      }
      transientSamples.forEach((sample, sampleIndex) => {
        const workerSample = workerSurface.samples[sampleIndex];
        const compare = (left: number, right: number, field: string) => {
          if (Math.abs(left - right) > geometryTolerance(Math.max(Math.abs(left), Math.abs(right)))) {
            throw new RangeError(
              `${variant.variantId}.annualTransientThermal sample ${sampleIndex} ${field} must match the worker surface.`,
            );
          }
        };
        compare(sample.areaM2, workerSample.areaM2, "area");
        compare(sample.position[0], workerSample.positionM.x, "position.x");
        compare(sample.position[1], workerSample.positionM.y, "position.y");
        compare(sample.position[2], workerSample.positionM.z, "position.z");
        compare(sample.normal[0], workerSample.normal.x, "normal.x");
        compare(sample.normal[1], workerSample.normal.y, "normal.y");
        compare(sample.normal[2], workerSample.normal.z, "normal.z");
      });
      if (transient.thermalNodeCount !== undefined && (
        !Number.isInteger(transient.thermalNodeCount) || transient.thermalNodeCount < 1
      )) {
        throw new RangeError(`${variant.variantId}.thermalNodeCount must be a positive integer.`);
      }
      [
        transient.referenceEfficiency ?? variant.referenceEfficiency,
        transient.gammaPerC,
        transient.referenceTemperatureC ?? 25,
        transient.absorptivity ?? 0.9,
        transient.initialTemperatureC ?? input.weather[0].ambientC,
        transient.effectiveSkyTemperatureOffsetC ?? -6,
        transient.maximumThermalSubstepSeconds ?? 300,
        transient.warmupPeriodHours ?? 24,
        transient.warmupConvergenceToleranceC ?? 0.02,
      ].forEach((value) => {
        if (!Number.isFinite(value)) {
          throw new RangeError(`${variant.variantId}.annualTransientThermal values must be finite.`);
        }
      });
      if (transient.absorptivity !== undefined
        && (transient.absorptivity < 0 || transient.absorptivity > 1)) {
        throw new RangeError(`${variant.variantId}.absorptivity must be between zero and one.`);
      }
    }
    if (
      variant.electricalFairnessMode === "independent-mppt" &&
      variant.circuit !== undefined &&
      variant.circuit !== false
    ) {
      throw new RangeError(
        `${variant.variantId}.independent-mppt cannot include shared circuit options.`,
      );
    }
    if (
      variant.electricalFairnessMode === "shared-circuit" &&
      variant.circuit === false
    ) {
      throw new RangeError(
        `${variant.variantId}.shared-circuit cannot disable the circuit.`,
      );
    }
    if (
      variant.electricalFairnessMode !== undefined &&
      (variant.panelCount ?? 0) > 1 &&
      variant.panels === undefined
    ) {
      throw new RangeError(
        `${variant.variantId}.electricalFairnessMode requires explicit per-zone panels.`,
      );
    }

    if (variant.panels !== undefined) {
      if (variant.panels.length !== (variant.panelCount ?? 0)) {
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
        if (panel.surfaceSamples !== undefined) {
          if (
            !Array.isArray(panel.surfaceSamples) ||
            panel.surfaceSamples.length < 1 ||
            panel.surfaceSamples.length > MAX_SURFACE_SAMPLES_PER_ZONE
          ) {
            throw new RangeError(
              `${panelLabel}.surfaceSamples must contain 1-${MAX_SURFACE_SAMPLES_PER_ZONE} samples.`,
            );
          }
          let totalAreaWeight = 0;
          panel.surfaceSamples.forEach((sample, sampleIndex) => {
            const sampleLabel = `${panelLabel}.surfaceSamples[${sampleIndex}]`;
            assertVec3(sample.positionM, `${sampleLabel}.positionM`, true);
            assertVec3(sample.normal, `${sampleLabel}.normal`);
            if (!Number.isFinite(sample.areaWeight) || sample.areaWeight <= 0) {
              throw new RangeError(`${sampleLabel}.areaWeight must be finite and greater than zero.`);
            }
            totalAreaWeight += sample.areaWeight;
          });
          if (!Number.isFinite(totalAreaWeight) || totalAreaWeight <= 0) {
            throw new RangeError(`${panelLabel}.surfaceSamples total areaWeight is invalid.`);
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
      if (Math.abs(explicitArea - (variant.totalPanelAreaM2 ?? 0)) > 1e-10) {
        throw new RangeError(`${variant.variantId}의 명시적 패널 면적 합계가 totalPanelAreaM2와 다릅니다.`);
      }
    }
    if (variant.continuousSurface && variant.planeTracking) {
      variant.continuousSurface.samples.forEach((sample, sampleIndex) => {
        if (dot(normalize(sample.normal), WORLD_UP) < 1 - POSE_ALIGNMENT_TOLERANCE) {
          throw new RangeError(
            `${variant.variantId}.continuousSurface.samples[${sampleIndex}].normal must be horizontal when planeTracking is enabled.`,
          );
        }
      });
    }
    if (!variant.continuousSurface) resolvedPanels(input, variant).forEach((panel) => {
      const pose = canonicalPanelPose(panel);
      if (variant.planeTracking) {
        if (dot(pose.normal, WORLD_UP) < 1 - POSE_ALIGNMENT_TOLERANCE) {
          throw new RangeError(
            `${panel.panelId} must have a horizontal baseline normal when planeTracking is enabled.`,
          );
        }
        panel.surfaceSamples?.forEach((sample, sampleIndex) => {
          if (dot(normalize(sample.normal), WORLD_UP) < 1 - POSE_ALIGNMENT_TOLERANCE) {
            throw new RangeError(
              `${panel.panelId}.surfaceSamples[${sampleIndex}].normal must be horizontal when planeTracking is enabled.`,
            );
          }
        });
      }
    });
  });
  const maximumTotalPanels = MAX_SIMULATION_VARIANTS * MAX_PANELS_PER_VARIANT;
  if (totalPanels > maximumTotalPanels) {
    throw new RangeError(`워커 입력의 전체 패널 수는 최대 ${maximumTotalPanels}개입니다.`);
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
  if (
    input.reportingOffsetMinutes !== undefined &&
    (!Number.isInteger(input.reportingOffsetMinutes) || Math.abs(input.reportingOffsetMinutes) > 1_440)
  ) {
    throw new RangeError("보고 시간대 오프셋은 -1,440~1,440분 정수여야 합니다.");
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
  if (variant.continuousSurface) {
    throw new TypeError("A continuous surface cannot be resolved as discrete panels.");
  }
  const defaults = input.physics?.panelDefaults ?? {};
  if (!variant.panels) {
    return [
      {
        ...defaults,
        panelId: `${variant.variantId}:aggregate`,
        normal: { x: 0, y: 1, z: 0 },
        areaM2: variant.totalPanelAreaM2 ?? PANEL_AREA_M2,
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

/** Mirrors the solar context resolved inside `simulateInstant`. */
function obstacleSunDirection(input: SimulationKernelInput, weather: WeatherPoint): Vec3 {
  const override = input.physics?.solarOverride;
  if (override) {
    const azimuthDeg = ((override.azimuthDeg % 360) + 360) % 360;
    const elevationDeg = Math.max(-90, Math.min(90, override.elevationDeg));
    return sunVector(azimuthDeg, elevationDeg);
  }
  const location = input.physics?.location;
  const pressurePa = input.physics?.weather?.pressurePa;
  return sunVector(solarPosition({
    timestamp: weather.timeUtcMs,
    latitudeDeg: location?.latitudeDeg ?? 37.5665,
    longitudeDeg: location?.longitudeDeg ?? 126.978,
    elevationM: location?.elevationM ?? 38,
    pressureHPa: location?.pressureHPa ?? (
      pressurePa === undefined ? undefined : pressurePa / 100
    ),
    temperatureC: location?.temperatureC ?? weather.ambientC,
    deltaTSeconds: location?.deltaTSeconds,
    deltaUt1Seconds: location?.deltaUt1Seconds,
    applyRefraction: location?.applyRefraction,
  }));
}

function rayIntersectsAabb(
  origin: Vec3,
  direction: Vec3,
  bounds: SimulationObstacleBounds,
): boolean {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (const axis of ["x", "y", "z"] as const) {
    const component = direction[axis];
    if (Math.abs(component) < 1e-12) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return false;
      continue;
    }
    const inverse = 1 / component;
    let first = (bounds.min[axis] - origin[axis]) * inverse;
    let second = (bounds.max[axis] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return far >= 0;
}

function obstacleVisibilityAtPoint(
  origin: Vec3,
  direction: Vec3,
  bounds: readonly SimulationObstacleBounds[],
): 0 | 1 {
  return bounds.some((obstacle) => rayIntersectsAabb(origin, direction, obstacle)) ? 0 : 1;
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

/**
 * Resolves the normal prescribed by the annual plane tracker. A non-positive
 * solar Y component is night (or the horizon), so every mode deterministically
 * returns the horizontal stow pose.
 */
export function planeTrackingNormal(
  mode: SimulationPlaneTracking["mode"],
  sunDirection: Vec3,
): Vec3 {
  const sun = normalize(sunDirection);
  if (sun.y <= 0) return { ...WORLD_UP };
  if (mode === "dual-axis") return sun;
  return normalize({ x: sun.x, y: sun.y, z: 0 });
}

function rotatePointAroundPivot(point: Vec3, pivot: Vec3, quaternion: Quaternion): Vec3 {
  const rotated = rotateVector(quaternion, {
    x: point.x - pivot.x,
    y: point.y - pivot.y,
    z: point.z - pivot.z,
  });
  return {
    x: pivot.x + rotated.x,
    y: pivot.y + rotated.y,
    z: pivot.z + rotated.z,
  };
}

/** Applies the tracker as one rigid world-space transform about `centreM`. */
export function applyPlaneTrackingToPanelPose(
  panel: SimulationPanelWorkItem,
  tracking: SimulationPlaneTracking,
  sunDirection: Vec3,
): RotatedPanelPose {
  const base = canonicalPanelPose(panel);
  const targetNormal = planeTrackingNormal(tracking.mode, sunDirection);
  const trackerQuaternion = quaternionBetween(WORLD_UP, targetNormal);
  return {
    positionM: rotatePointAroundPivot(
      panel.positionM ?? { x: 0, y: 0, z: 0 },
      tracking.centreM,
      trackerQuaternion,
    ),
    normal: normalize(rotateVector(trackerQuaternion, base.normal)),
    quaternion: normalizeQuaternion(multiplyQuaternion(trackerQuaternion, base.quaternion)),
    sampleAxisU: normalize(rotateVector(trackerQuaternion, base.sampleAxisU)),
    sampleAxisV: normalize(rotateVector(trackerQuaternion, base.sampleAxisV)),
    angleRad: 0,
  };
}

export interface RotatedSurfaceSample extends SimulationSurfaceSample {
  /** Normalized relative area within the electrical zone. */
  areaWeight: number;
}

/** Applies the exact same plane-tracker transform and pivot to every sample. */
export function applyPlaneTrackingToSurfaceSamples(
  samples: readonly SimulationSurfaceSample[],
  tracking: SimulationPlaneTracking,
  sunDirection: Vec3,
): RotatedSurfaceSample[] {
  const targetNormal = planeTrackingNormal(tracking.mode, sunDirection);
  const trackerQuaternion = quaternionBetween(WORLD_UP, targetNormal);
  const totalAreaWeight = samples.reduce((sum, sample) => sum + sample.areaWeight, 0);
  return samples.map((sample) => ({
    positionM: rotatePointAroundPivot(sample.positionM, tracking.centreM, trackerQuaternion),
    normal: normalize(rotateVector(trackerQuaternion, sample.normal)),
    areaWeight: sample.areaWeight / totalAreaWeight,
  }));
}

function rotateSurfaceSamplesAroundY(
  samples: readonly SimulationSurfaceSample[],
  angleRad: number,
): RotatedSurfaceSample[] {
  const totalAreaWeight = samples.reduce((sum, sample) => sum + sample.areaWeight, 0);
  return samples.map((sample) => ({
    positionM: rotateAroundY(sample.positionM, angleRad),
    normal: normalize(rotateAroundY(sample.normal, angleRad)),
    areaWeight: sample.areaWeight / totalAreaWeight,
  }));
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

interface ScheduledRotationPhaseCache {
  weather: readonly WeatherPoint[];
  rpmByWeatherStep: readonly number[];
  prefixAngleRad: Float64Array;
}

const scheduledRotationPhaseCache = new WeakMap<
  SimulationVariantWorkItem,
  ScheduledRotationPhaseCache
>();

function scheduledRotationPrefixAngles(
  input: SimulationKernelInput,
  variant: SimulationVariantWorkItem,
): Float64Array {
  const rpmByWeatherStep = variant.rotationRpmByWeatherStep;
  if (!rpmByWeatherStep) return new Float64Array(input.weather.length);
  const cached = scheduledRotationPhaseCache.get(variant);
  if (cached?.weather === input.weather && cached.rpmByWeatherStep === rpmByWeatherStep) {
    return cached.prefixAngleRad;
  }
  const prefixAngleRad = new Float64Array(input.weather.length);
  for (let index = 1; index < input.weather.length; index += 1) {
    const durationSeconds = (
      input.weather[index].timeUtcMs - input.weather[index - 1].timeUtcMs
    ) / 1_000;
    const intervalAngleRad = rpmByWeatherStep[index - 1] * 2 * Math.PI * durationSeconds / 60;
    if (!Number.isFinite(intervalAngleRad)) {
      throw new RangeError(`${variant.variantId}.rotationRpmByWeatherStep produces a non-finite phase.`);
    }
    // Only phase modulo one turn is observable; reducing at every boundary
    // avoids precision loss across an annual high-RPM schedule.
    prefixAngleRad[index] = fixedRotation(
      prefixAngleRad[index - 1] + intervalAngleRad,
      0,
      0,
    ).angleRad;
  }
  scheduledRotationPhaseCache.set(variant, { weather: input.weather, rpmByWeatherStep, prefixAngleRad });
  return prefixAngleRad;
}

function rotationRpmAtStep(context: SimulationStepContext): number {
  const scheduled = context.variant.rotationRpmByWeatherStep?.[context.stepIndex];
  if (scheduled !== undefined) return scheduled;
  return context.variant.rotation?.mode === "fixed" ? context.variant.rotation.rpm : 0;
}

function rotationAngleAt(context: SimulationStepContext): number {
  const { input, variant, weather } = context;
  const rotation = variant.rotation;
  if (!rotation) return 0;
  if (rotation.mode === "static") return rotation.angleRad ?? 0;
  if (variant.rotationRpmByWeatherStep) {
    const prefixAngleRad = scheduledRotationPrefixAngles(input, variant)[context.stepIndex];
    return fixedRotation((rotation.initialAngleRad ?? 0) + prefixAngleRad, 0, 0).angleRad;
  }
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
  const scheduled = context.variant.rotationRpmByWeatherStep !== undefined;
  const intervalRpm = rotationRpmAtStep(context);
  const samplesPerTurn = context.variant.rotationPhaseSamples ?? 1;
  const intervalSeconds = forwardIntervalSeconds(context.input, context.stepIndex);
  if (
    rotation?.mode !== "fixed" ||
    (!scheduled && samplesPerTurn <= 1) ||
    intervalSeconds <= 0 ||
    Math.abs(intervalRpm) < 1e-15
  ) {
    return {
      startAngleRad,
      direction: 1,
      totalTurns: 0,
      completeTurns: 0,
      residualTurns: 0,
      completeTurnSamples: 0,
      residualSamples: 0,
      // A scheduled zero-RPM interval is exactly represented by its constant
      // start pose. Mark it as a forward-interval value so a following month's
      // different RPM is not trapezoidally blended into this interval.
      intervalAveraged: scheduled
        && rotation?.mode === "fixed"
        && intervalSeconds > 0
        && Math.abs(intervalRpm) < 1e-15,
    };
  }

  const signedTurns = intervalRpm * intervalSeconds / 60;
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
  if (!plan.intervalAveraged || plan.totalTurns === 0) return 1;
  return plan.completeTurnSamples + plan.residualSamples;
}

/**
 * Weighted midpoint quadrature over the exact angular interval [θ(t), θ(t+dt)].
 * Integer turns and the fractional remainder are both retained; there is no
 * threshold at one revolution and no discarded residual arc.
 */
export function rotationIntervalSamples(context: SimulationStepContext): RotationIntervalSample[] {
  const plan = rotationIntervalPlan(context);
  if (!plan.intervalAveraged || plan.totalTurns === 0) {
    return [{
      angleRad: plan.startAngleRad,
      weight: 1,
      intervalAveraged: plan.intervalAveraged,
    }];
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
interface ZonePhysicsResult {
  panelId: string;
  areaM2: number;
  dcPowerW: number;
  dcVoltageV: number;
  dcCurrentA: number;
  ivCurve?: IVCurve;
  poaWm2: number;
  moduleTemperatureC: number;
  ghiClosure: ReturnType<typeof simulateInstant>["irradiance"]["ghiClosure"];
}

/** Matches the optimizer bus-voltage contract used by continuous-surface Mode B. */
function optimizerBusVoltage(
  zones: readonly ZonePhysicsResult[],
  inverter: InverterConfig,
): number {
  const natural = zones.reduce((sum, zone) => sum + zone.dcVoltageV, 0);
  const lower = Math.max(1e-6, inverter.mpptMinVoltageV);
  const upper = Math.max(
    lower,
    Math.min(inverter.mpptMaxVoltageV, inverter.maxDcVoltageV),
  );
  return Math.min(upper, Math.max(lower, natural || lower));
}

function idealContinuousBusVoltage(
  dcPowerW: number,
  vmpV: number,
  inverter: InverterConfig,
): number {
  const lower = Math.max(1e-6, inverter.mpptMinVoltageV);
  const upper = Math.max(
    lower,
    Math.min(inverter.mpptMaxVoltageV, inverter.maxDcVoltageV),
  );
  // The default comparison assumes ideal local DC aggregation. Select a bus
  // voltage without using a panel/string count and avoid an artificial current
  // bottleneck whenever the configured inverter range permits it.
  const currentCompatible = inverter.maxInputCurrentA > 0
    ? dcPowerW / inverter.maxInputCurrentA
    : upper;

  return Math.min(upper, Math.max(lower, vmpV, currentCompatible));
}
function engineeringReferenceCellConfig(
  config: ElectricalConfig,
  nominalCellAreaM2: number,
  efficiency: number,
): ElectricalConfig {
  const nameplatePowerScale = nominalCellAreaM2 * efficiency *
    config.referenceIrradianceWm2 / Math.max(config.pmaxW, 1e-12);
  return {
    ...config,
    areaM2: nominalCellAreaM2,
    efficiency,
    pmaxW: nominalCellAreaM2 * efficiency * config.referenceIrradianceWm2,
    iscA: config.iscA * nameplatePowerScale,
    impA: config.impA * nameplatePowerScale,
    alphaIscAperC: config.alphaIscAperC * nameplatePowerScale,
    seriesResistanceOhm: config.seriesResistanceOhm / nameplatePowerScale,
    shuntResistanceOhm: config.shuntResistanceOhm / nameplatePowerScale,
    cellsInSeries: 1,
  };
}

function transformedContinuousSample(
  sample: SimulationContinuousSurfaceSample,
  angleRad: number,
  tracking: SimulationPlaneTracking | undefined,
  sunDirection: Vec3,
): SimulationContinuousSurfaceSample {
  if (!tracking) {
    return {
      ...sample,
      positionM: rotateAroundY(sample.positionM, angleRad),
      normal: normalize(rotateAroundY(sample.normal, angleRad)),
    };
  }
  const targetNormal = planeTrackingNormal(tracking.mode, sunDirection);
  const trackerQuaternion = quaternionBetween(WORLD_UP, targetNormal);
  return {
    ...sample,
    positionM: rotatePointAroundPivot(sample.positionM, tracking.centreM, trackerQuaternion),
    normal: normalize(rotateVector(trackerQuaternion, sample.normal)),
  };
}

function continuousRegionId(
  shape: NonNullable<SimulationVariantWorkItem["continuousSurface"]>["shape"],
  sample: SimulationContinuousSurfaceSample,
): string {
  if (sample.regionId) return sample.regionId;
  if (shape === "cylinder") return normalize(sample.normal).y > 0.5 ? "top" : "lateral";
  return "surface";
}

function computeContinuousSurfaceStepAtAngle(
  { input, variant, weather, stepIndex, isCancelled }: SimulationStepContext,
  angleRad: number,
): SimulationPhysicsStepResult {
  const surface = variant.continuousSurface;
  if (!surface) throw new TypeError("continuousSurface is required.");
  const tracking = variant.planeTracking;
  const needsSunDirection = Boolean(tracking || variant.obstacleBounds?.length);
  const sunDirection = needsSunDirection
    ? obstacleSunDirection(input, weather)
    : { x: 0, y: 1, z: 0 };
  const irradiance = scaledIrradiance(variant, weather, stepIndex);
  const simulationWeather = {
    ...input.physics?.weather,
    ambientTemperatureC: weather.ambientC,
    referenceWindSpeedMS: weather.windSpeedMs,
  };
  const surfaceOptions = {
    ...input.physics?.panelDefaults,
    ...surface.surfaceOptions,
  };
  const electrical = {
    ...input.physics?.electrical,
    ...variant.electrical,
    mode: "simple" as const,
  };
  const electricalConfig = electrical.config ?? DEFAULT_ELECTRICAL;
  const regions: Record<string, SimulationSurfaceRegionResult> = {};
  let dcPowerW = 0;
  let poaAreaW = 0;
  let temperatureAreaC = 0;
  let closure: ReturnType<typeof simulateInstant>["irradiance"]["ghiClosure"] | undefined;
  const aggregateElectricalAvailability = 1 - Math.min(
    1, Math.max(0, electrical.aggregateLossFraction ?? 0),
  );

  const engineeringSamples: Array<{
    id: string;
    areaM2: number;
    poaWm2: number;
    cellTemperatureC: number;
  }> = [];
  for (const [sampleIndex, baseSample] of surface.samples.entries()) {
    if (isCancelled?.()) throw new SimulationCancelledError();
    const sample = transformedContinuousSample(baseSample, angleRad, tracking, sunDirection);
    const baseVisibility = surfaceOptions.visibility ?? 1;
    const visibility = variant.obstacleBounds?.length
      ? baseVisibility * obstacleVisibilityAtPoint(
          sample.positionM,
          sunDirection,
          variant.obstacleBounds,
        )
      : baseVisibility;
    const result = simulateInstant({
      timestamp: weather.timeUtcMs,
      location: input.physics?.location,
      solarOverride: input.physics?.solarOverride,
      irradiance,
      panel: {
        ...surfaceOptions,
        normal: sample.normal,
        areaM2: sample.areaM2,
        efficiency: variant.referenceEfficiency,
        heightM: surfaceOptions.heightM ?? Math.max(0.01, sample.positionM.y),
        visibility,
      },
      weather: simulationWeather,
      // ηPV(T) × POA × dA is the local ideal-MPP integrand. There is no
      // per-zone curve, series current, bypass diode, or sample normalizer.
      electrical,
      inverter: false,
      thermal: input.physics?.thermal,
    });
    closure ??= result.irradiance.ghiClosure;
    dcPowerW += result.dcPowerW;
    poaAreaW += result.poa.totalWm2 * sample.areaM2;
    temperatureAreaC += result.moduleTemperatureC * sample.areaM2;
    engineeringSamples.push({
      id: `${variant.variantId}:surface-sample-${sampleIndex + 1}`,
      areaM2: sample.areaM2,
      poaWm2: result.solar.isDaylight ? result.effectivePoaWm2 * aggregateElectricalAvailability : 0,
      cellTemperatureC: result.moduleTemperatureC,
    });
    const regionId = continuousRegionId(surface.shape, sample);
    const region = regions[regionId] ??= {
      areaM2: 0,
      directOpticalW: 0,
      diffuseOpticalW: 0,
      groundOpticalW: 0,
      dcPowerW: 0,
      acPowerW: 0,
    };
    region.areaM2 += sample.areaM2;
    region.directOpticalW += result.poa.directPoaWm2 * sample.areaM2;
    region.diffuseOpticalW += result.poa.diffusePoaWm2 * sample.areaM2;
    region.groundOpticalW += result.poa.groundPoaWm2 * sample.areaM2;
    region.dcPowerW += result.dcPowerW;
  }

  const idealLocalMppDcPowerW = dcPowerW;
  // The explicit circuit is identically de-energised when every local MPP is
  // zero (night, or an otherwise unavailable surface). Skipping the IV
  // network solve in that exact case avoids thousands of meaningless annual
  // circuit sweeps without approximating any non-zero operating point.
  const engineering = surface.electricalModel === "explicit-series-parallel-bypass"
    && idealLocalMppDcPowerW > 0
    ? solveEngineeringSurfaceElectrical(
        engineeringSamples,
        engineeringReferenceCellConfig(
          electricalConfig,
          surface.engineeringConnection.nominalCellAreaM2,
          variant.referenceEfficiency,
        ),
        surface.engineeringConnection,
      )
    : undefined;
  if (
    engineering &&
    engineering.dcPowerW > idealLocalMppDcPowerW + Math.max(1e-9, idealLocalMppDcPowerW * 1e-8)
  ) {
    throw new Error("Engineering surface electrical output exceeds the local-MPP upper bound.");
  }
  dcPowerW = engineering?.dcPowerW ?? idealLocalMppDcPowerW;

  const inverterSelection = variant.inverter !== undefined
    ? variant.inverter
    : input.physics?.inverter;
  const inverterConfig = inverterSelection === false
    ? undefined
    : inverterSelection ?? DEFAULT_INVERTER;
  const dcVoltageV = engineering
    ? engineering.dcVoltageV
    : inverterConfig
      ? idealContinuousBusVoltage(dcPowerW, electricalConfig.vmpV, inverterConfig)
      : dcPowerW > 0 ? Math.max(0, electricalConfig.vmpV) : 0;
  const dcCurrentA = engineering
    ? engineering.dcCurrentA
    : dcVoltageV > 0 ? dcPowerW / dcVoltageV : 0;
  const inverter = inverterConfig
    ? calculateInverter({ dcPowerW, dcVoltageV, dcCurrentA, config: inverterConfig })
    : undefined;
  const reportedDcPowerW = inverter?.acceptedDcPowerW ?? dcPowerW;
  const reportedAcPowerW = inverter?.acPowerW ?? dcPowerW;
  // Regions are attribution groups, so scale ideal regional contributions by
  // the exact parent engineering/inverter ratio instead of solving per region.
  const dcScale = idealLocalMppDcPowerW > 0 ? reportedDcPowerW / idealLocalMppDcPowerW : 0;
  const acScale = idealLocalMppDcPowerW > 0 ? reportedAcPowerW / idealLocalMppDcPowerW : 0;
  Object.values(regions).forEach((region) => {
    const localDcPowerW = region.dcPowerW;
    region.dcPowerW = localDcPowerW * dcScale;
    region.acPowerW = localDcPowerW * acScale;
  });
  const fallbackClosure = closure ?? {
    residualWm2: 0,
    relativeResidual: 0,
    toleranceWm2: 0,
    isClosed: true,
  };
  return {
    dcPowerW: reportedDcPowerW,
    acPowerW: reportedAcPowerW,
    motorPowerW: 0,
    poaWm2: poaAreaW / surface.activeAreaM2,
    moduleTemperatureC: temperatureAreaC / surface.activeAreaM2,
    mismatchLossFraction: engineering?.mismatchAndWiringLossFraction ?? 0,
    bypassActiveCount: engineering?.bypassActiveCount ?? 0,
    inverterStatus: inverter?.status ?? "disabled",
    ghiClosure: {
      residualWm2: fallbackClosure.residualWm2,
      relativeResidual: fallbackClosure.relativeResidual,
      toleranceWm2: fallbackClosure.toleranceWm2,
      isClosed: fallbackClosure.isClosed,
      policy: "preserve-source-and-warn",
    },
    rotationIntervalAveraged: false,
    surfaceRegions: regions,
  };
}

function computePhysicsStepAtAngle(
  { input, variant, weather, stepIndex, isCancelled }: SimulationStepContext,
  angleRad: number,
): SimulationPhysicsStepResult {
  if (variant.continuousSurface) {
    return computeContinuousSurfaceStepAtAngle(
      { input, variant, weather, stepIndex, isCancelled },
      angleRad,
    );
  }
  const panels = resolvedPanels(input, variant);
  const legacySharedCircuit =
    panels.length > 1 && variant.circuit !== undefined && variant.circuit !== false;
  const useSharedCircuit = variant.electricalFairnessMode === "shared-circuit" || (
    variant.electricalFairnessMode === undefined && legacySharedCircuit
  );
  const useDetailedElectrical = useSharedCircuit ||
    variant.electricalFairnessMode === "independent-mppt";
  const panelResults: ZonePhysicsResult[] = [];
  const obstacleBounds = variant.obstacleBounds?.length
    ? variant.obstacleBounds
    : undefined;
  const tracking = variant.planeTracking;
  const sunDirection = obstacleBounds || tracking
    ? obstacleSunDirection(input, weather)
    : undefined;

  for (const panel of panels) {
    if (isCancelled?.()) throw new SimulationCancelledError();
    const pose = tracking
      ? applyPlaneTrackingToPanelPose(panel, tracking, sunDirection!)
      : rotatePanelPoseAroundY(panel, angleRad);
    const areaM2 = panel.areaM2 ?? PANEL_AREA_M2;
    const efficiency = panel.efficiency ?? variant.referenceEfficiency;
    const electrical: NonNullable<InstantSimulationInput["electrical"]> = {
      ...input.physics?.electrical,
      ...variant.electrical,
      ...panel.electrical,
      ...(useDetailedElectrical ? { mode: "single-diode" as const } : {}),
    };
    const sharedPanelInput = {
      efficiency,
      visibility: panel.visibilityByStep?.[stepIndex] ?? panel.visibility,
      diffuseVisibility:
        panel.diffuseVisibilityByStep?.[stepIndex] ?? panel.diffuseVisibility,
      groundVisibility:
        panel.groundVisibilityByStep?.[stepIndex] ?? panel.groundVisibility,
      albedo: panel.albedo,
      iam: panel.iam,
      diffuseModel: panel.diffuseModel,
      soilingLossFraction: panel.soilingLossFraction,
    };
    const irradiance = scaledIrradiance(variant, weather, stepIndex);
    const simulationWeather = {
      ...input.physics?.weather,
      ambientTemperatureC: weather.ambientC,
      referenceWindSpeedMS: weather.windSpeedMs,
    };

    if (!panel.surfaceSamples) {
      const result = simulateInstant({
        timestamp: weather.timeUtcMs,
        location: input.physics?.location,
        solarOverride: input.physics?.solarOverride,
        irradiance,
        panel: {
          ...sharedPanelInput,
          normal: pose.normal,
          sampleAxisU: pose.sampleAxisU,
          areaM2,
          heightM: panel.heightM,
          visibility: sunDirection && obstacleBounds
            ? (sharedPanelInput.visibility ?? 1) * obstacleVisibilityAtPoint(
                pose.positionM,
                sunDirection,
                obstacleBounds,
              )
            : sharedPanelInput.visibility,
        },
        weather: simulationWeather,
        electrical,
        inverter: false,
        thermal: input.physics?.thermal,
      });
      panelResults.push({
        panelId: panel.panelId,
        areaM2,
        dcPowerW: result.dcPowerW,
        dcVoltageV: result.dcVoltageV,
        dcCurrentA: result.dcCurrentA,
        ivCurve: result.ivCurve,
        poaWm2: result.poa.totalWm2,
        moduleTemperatureC: result.moduleTemperatureC,
        ghiClosure: result.irradiance.ghiClosure,
      });
      continue;
    }

    const surfaceSamples = tracking
      ? applyPlaneTrackingToSurfaceSamples(panel.surfaceSamples, tracking, sunDirection!)
      : rotateSurfaceSamplesAroundY(panel.surfaceSamples, angleRad);
    const sampleResults = surfaceSamples.map((sample) => {
      if (isCancelled?.()) throw new SimulationCancelledError();
      return {
        areaWeight: sample.areaWeight,
        result: simulateInstant({
          timestamp: weather.timeUtcMs,
          location: input.physics?.location,
          solarOverride: input.physics?.solarOverride,
          irradiance,
          panel: {
            ...sharedPanelInput,
            normal: sample.normal,
            areaM2: areaM2 * sample.areaWeight,
            heightM: panel.heightM ?? Math.max(0.01, sample.positionM.y),
            visibility: sunDirection && obstacleBounds
              ? (sharedPanelInput.visibility ?? 1) * obstacleVisibilityAtPoint(
                  sample.positionM,
                  sunDirection,
                  obstacleBounds,
                )
              : sharedPanelInput.visibility,
          },
          weather: simulationWeather,
          // Samples resolve local POA and temperature only. The electrical
          // zone receives exactly one detailed I-V solve after integration.
          electrical: { ...electrical, mode: "simple" as const },
          inverter: false,
          thermal: input.physics?.thermal,
        }),
      };
    });
    const average = (selector: (result: ReturnType<typeof simulateInstant>) => number) =>
      sampleResults.reduce(
        (sum, sample) => sum + selector(sample.result) * sample.areaWeight,
        0,
      );
    const averageEffectivePoaWm2 = average((result) => result.effectivePoaWm2);
    const averageModuleTemperatureC = average((result) => result.moduleTemperatureC);
    const baseElectrical = electrical.config ?? DEFAULT_ELECTRICAL;
    const zoneElectrical = scaleElectricalConfigForArea(baseElectrical, areaM2);
    const zoneCurve = singleDiodeCurve({
      irradianceWm2: sampleResults[0].result.solar.isDaylight ? averageEffectivePoaWm2 : 0,
      cellTemperatureC: averageModuleTemperatureC,
      config: { ...zoneElectrical, efficiency },
      points: 64,
    });
    panelResults.push({
      panelId: panel.panelId,
      areaM2,
      dcPowerW: zoneCurve.mpp.powerW,
      dcVoltageV: zoneCurve.mpp.voltageV,
      dcCurrentA: zoneCurve.mpp.currentA,
      ivCurve: zoneCurve,
      poaWm2: average((result) => result.poa.totalWm2),
      moduleTemperatureC: averageModuleTemperatureC,
      ghiClosure: sampleResults[0].result.irradiance.ghiClosure,
    });
  }

  const topology = variant.topology ?? "series";
  const inverterSelection = variant.inverter !== undefined
    ? variant.inverter
    : input.physics?.inverter;
  const optimizerInverter = inverterSelection === false
    ? undefined
    : inverterSelection ?? DEFAULT_INVERTER;
  let dcPowerW: number;
  let dcVoltageV: number;
  let dcCurrentA: number;
  let mismatchLossFraction = 0;
  let bypassActiveCount = 0;

  if (useSharedCircuit) {
    const devices: CircuitDevice[] = panelResults.map((result) => {
      const zeroPoint = { voltageV: 0, currentA: 0, powerW: 0 };
      return {
        id: result.panelId,
        curve: result.ivCurve ?? {
          points: [zeroPoint],
          iscA: 0,
          vocV: 0,
          mpp: zeroPoint,
        },
      };
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
    if (variant.electricalFairnessMode === "independent-mppt") {
      dcVoltageV = optimizerInverter
        ? optimizerBusVoltage(panelResults, optimizerInverter)
        : panelResults.reduce((sum, result) => sum + result.dcVoltageV, 0);
    } else if (panels.length === 1 && !variant.panels) {
      const representative = panelResults[0];
      dcVoltageV = topology === "series"
        ? representative.dcVoltageV * (variant.panelCount ?? 1)
        : representative.dcVoltageV;
    } else {
      dcVoltageV = topology === "series"
        ? panelResults.reduce((sum, result) => sum + result.dcVoltageV, 0)
        : Math.max(0, ...panelResults.map((result) => result.dcVoltageV));
    }
    dcCurrentA = dcVoltageV > 0 ? dcPowerW / dcVoltageV : 0;
  }

  const inverter = inverterSelection === false
    ? undefined
    : calculateInverter({
        dcPowerW,
        dcVoltageV,
        dcCurrentA,
        ...(inverterSelection ? { config: inverterSelection } : {}),
      });
  const reportedDcPowerW = variant.electricalFairnessMode !== undefined && inverter
    ? inverter.acceptedDcPowerW
    : dcPowerW;
  const totalArea = panelResults.reduce((sum, result) => sum + result.areaM2, 0);
  const weighted = (selector: (result: (typeof panelResults)[number]) => number) =>
    totalArea > 0
      ? panelResults.reduce((sum, result) => sum + selector(result) * result.areaM2, 0) / totalArea
      : 0;
  const closure = panelResults[0].ghiClosure;

  return {
    dcPowerW: reportedDcPowerW,
    acPowerW: inverter?.acPowerW ?? reportedDcPowerW,
    motorPowerW: 0,
    poaWm2: weighted((result) => result.poaWm2),
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
    surfaceRegions: {},
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
  const regionIds = new Set(results.flatMap((result) => Object.keys(result.surfaceRegions ?? {})));
  const surfaceRegions = Object.fromEntries([...regionIds].map((regionId) => {
    const entries = results.map((result) => result.surfaceRegions?.[regionId]);
    const weighted = (field: keyof SimulationSurfaceRegionResult) => entries.reduce(
      (sum, entry, index) => sum + (entry?.[field] ?? 0) * samples[index].weight,
      0,
    );
    return [regionId, {
      areaM2: weighted("areaM2"),
      directOpticalW: weighted("directOpticalW"),
      diffuseOpticalW: weighted("diffuseOpticalW"),
      groundOpticalW: weighted("groundOpticalW"),
      dcPowerW: weighted("dcPowerW"),
      acPowerW: weighted("acPowerW"),
    }];
  }));
  return {
    dcPowerW: average((result) => result.dcPowerW),
    acPowerW: average((result) => result.acPowerW),
    motorPowerW: average((result) => result.motorPowerW ?? 0),
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
    surfaceRegions,
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
    return applyMotorDrive(context.variant, {
      ...result,
      rotationIntervalAveraged: samples[0].intervalAveraged,
    });
  }
  const results: SimulationPhysicsStepResult[] = [];
  for (const sample of samples) {
    if (context.isCancelled?.()) throw new SimulationCancelledError();
    results.push(computePhysicsStepAtAngle(context, sample.angleRad));
  }
  return applyMotorDrive(context.variant, averagePhaseResults(results, samples));
};

function applyMotorDrive(
  variant: SimulationVariantWorkItem,
  result: SimulationPhysicsStepResult,
): SimulationPhysicsStepResult {
  if (!variant.motorDrive) return result;
  const rpm = variant.rotation?.mode === "fixed" ? variant.rotation.rpm : 0;
  const motorPowerW = motorDrivePowerW({
    requiredTorqueNm: variant.motorDrive.requiredTorqueNm,
    rpm,
    motorEfficiency: variant.motorDrive.motorEfficiency,
  });
  const grossAcPowerW = result.acPowerW;
  const netAcPowerW = Math.max(0, grossAcPowerW - motorPowerW);
  const acScale = grossAcPowerW > 0 ? netAcPowerW / grossAcPowerW : 0;
  return {
    ...result,
    acPowerW: netAcPowerW,
    motorPowerW,
    surfaceRegions: Object.fromEntries(Object.entries(result.surfaceRegions ?? {}).map(
      ([regionId, region]) => [regionId, { ...region, acPowerW: region.acPowerW * acScale }],
    )),
  };
}

function normalizedStepResult(
  result: number | SimulationPhysicsStepResult,
  weather: WeatherPoint,
  variant?: SimulationVariantWorkItem,
): SimulationPhysicsStepResult {
  const normalized = typeof result === "number"
    ? {
        dcPowerW: result,
        acPowerW: result,
        motorPowerW: 0,
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
        surfaceRegions: {},
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
        motorPowerW: result.motorPowerW ?? 0,
        surfaceRegions: result.surfaceRegions ?? {},
      };
  const withMotor = variant?.motorDrive && (normalized.motorPowerW ?? 0) === 0
    ? applyMotorDrive(variant, normalized)
    : normalized;
  const numericValues = [
    withMotor.dcPowerW,
    withMotor.acPowerW,
    withMotor.motorPowerW ?? 0,
    withMotor.poaWm2,
    withMotor.moduleTemperatureC,
    withMotor.mismatchLossFraction,
    withMotor.bypassActiveCount,
    withMotor.ghiClosure.residualWm2,
    withMotor.ghiClosure.relativeResidual,
    withMotor.ghiClosure.toleranceWm2,
  ];
  if (
    numericValues.some((value) => !Number.isFinite(value)) ||
    withMotor.dcPowerW < 0 ||
    withMotor.acPowerW < 0 ||
    (withMotor.motorPowerW ?? 0) < 0 ||
    withMotor.poaWm2 < 0 ||
    withMotor.mismatchLossFraction < 0 ||
    withMotor.mismatchLossFraction > 1 ||
    withMotor.bypassActiveCount < 0 ||
    withMotor.ghiClosure.relativeResidual < 0 ||
    withMotor.ghiClosure.toleranceWm2 < 0
  ) {
    throw new Error("워커 물리 단계가 유효하지 않은 값을 반환했습니다.");
  }
  const surfaceRegions = withMotor.surfaceRegions ?? {};
  const regionValues = Object.values(surfaceRegions);
  regionValues.forEach((region) => {
    if (
      Object.values(region).some((value) => !Number.isFinite(value) || value < 0) ||
      !(region.areaM2 > 0)
    ) {
      throw new Error("워커 연속표면 영역 단계가 유효하지 않은 값을 반환했습니다.");
    }
  });
  if (regionValues.length > 0) {
    const regionDcW = regionValues.reduce((sum, region) => sum + region.dcPowerW, 0);
    const regionAcW = regionValues.reduce((sum, region) => sum + region.acPowerW, 0);
    const toleranceDc = Math.max(1e-10, withMotor.dcPowerW * 1e-8);
    const toleranceAc = Math.max(1e-10, withMotor.acPowerW * 1e-8);
    if (
      Math.abs(regionDcW - withMotor.dcPowerW) > toleranceDc ||
      Math.abs(regionAcW - withMotor.acPowerW) > toleranceAc
    ) {
      throw new Error("워커 연속표면 영역 출력 합이 전체 출력과 다릅니다.");
    }
  }
  return withMotor;
}

interface MonthlyAccumulator {
  dcEnergyWhByVariant: Record<string, number>;
  acEnergyWhByVariant: Record<string, number>;
  motorEnergyWhByVariant?: Record<string, number>;
}

function monthKey(timeUtcMs: number, reportingOffsetMinutes: number): string {
  return new Date(timeUtcMs + reportingOffsetMinutes * 60_000).toISOString().slice(0, 7);
}

function nextMonthUtc(timeUtcMs: number, reportingOffsetMinutes: number): number {
  const offsetMs = reportingOffsetMinutes * 60_000;
  const reportingDate = new Date(timeUtcMs + offsetMs);
  return Date.UTC(
    reportingDate.getUTCFullYear(),
    reportingDate.getUTCMonth() + 1,
    1,
  ) - offsetMs;
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
  totalMotor: Record<string, number>,
  regionTotals: SimulationCompleteEvent["surfaceRegionEnergyWhByVariant"],
  reportingOffsetMinutes: number,
): void {
  const durationMs = endMs - startMs;
  if (!(durationMs > 0)) return;
  let segmentStart = startMs;
  while (segmentStart < endMs) {
    const segmentEnd = Math.min(endMs, nextMonthUtc(segmentStart, reportingOffsetMinutes));
    const startFraction = (segmentStart - startMs) / durationMs;
    const endFraction = (segmentEnd - startMs) / durationMs;
    const hours = (segmentEnd - segmentStart) / 3_600_000;
    const key = monthKey(segmentStart, reportingOffsetMinutes);
    let bucket = monthly.get(key);
    if (!bucket) {
      bucket = {
        dcEnergyWhByVariant: Object.fromEntries(variantIds.map((id) => [id, 0])),
        acEnergyWhByVariant: Object.fromEntries(variantIds.map((id) => [id, 0])),
        ...(variantIds.some((id) => (previous[id].motorPowerW ?? 0) > 0 || (current[id].motorPowerW ?? 0) > 0)
          ? { motorEnergyWhByVariant: Object.fromEntries(variantIds.map((id) => [id, 0])) }
          : {}),
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
      const motorStart = previousStep.rotationIntervalAveraged
        ? previousStep.motorPowerW ?? 0
        : interpolate(previousStep.motorPowerW ?? 0, currentStep.motorPowerW ?? 0, startFraction);
      const motorEnd = previousStep.rotationIntervalAveraged
        ? previousStep.motorPowerW ?? 0
        : interpolate(previousStep.motorPowerW ?? 0, currentStep.motorPowerW ?? 0, endFraction);
      const motorEnergy = 0.5 * (motorStart + motorEnd) * hours;
      bucket.dcEnergyWhByVariant[variantId] += dcEnergy;
      bucket.acEnergyWhByVariant[variantId] += acEnergy;
      if (bucket.motorEnergyWhByVariant) {
        bucket.motorEnergyWhByVariant[variantId] += motorEnergy;
      }
      totalDc[variantId] += dcEnergy;
      totalAc[variantId] += acEnergy;
      totalMotor[variantId] += motorEnergy;
      const regionIds = new Set([
        ...Object.keys(previousStep.surfaceRegions ?? {}),
        ...Object.keys(currentStep.surfaceRegions ?? {}),
      ]);
      const variantRegions = regionTotals[variantId] ??= {};
      for (const regionId of regionIds) {
        const previousRegion = previousStep.surfaceRegions?.[regionId];
        const currentRegion = currentStep.surfaceRegions?.[regionId];
        const regionDcStart = previousStep.rotationIntervalAveraged
          ? previousRegion?.dcPowerW ?? 0
          : interpolate(previousRegion?.dcPowerW ?? 0, currentRegion?.dcPowerW ?? 0, startFraction);
        const regionDcEnd = previousStep.rotationIntervalAveraged
          ? previousRegion?.dcPowerW ?? 0
          : interpolate(previousRegion?.dcPowerW ?? 0, currentRegion?.dcPowerW ?? 0, endFraction);
        const regionAcStart = previousStep.rotationIntervalAveraged
          ? previousRegion?.acPowerW ?? 0
          : interpolate(previousRegion?.acPowerW ?? 0, currentRegion?.acPowerW ?? 0, startFraction);
        const regionAcEnd = previousStep.rotationIntervalAveraged
          ? previousRegion?.acPowerW ?? 0
          : interpolate(previousRegion?.acPowerW ?? 0, currentRegion?.acPowerW ?? 0, endFraction);
        const accumulator = variantRegions[regionId] ??= { dcEnergyWh: 0, acEnergyWh: 0 };
        accumulator.dcEnergyWh += 0.5 * (regionDcStart + regionDcEnd) * hours;
        accumulator.acEnergyWh += 0.5 * (regionAcStart + regionAcEnd) * hours;
      }
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
  const hasMotorDrive = input.variants.some((variant) => variant.motorDrive !== undefined);
  const motorEnergyWhByVariant = Object.fromEntries(variantIds.map((id) => [id, 0]));
  const surfaceRegionEnergyWhByVariant = Object.fromEntries(
    variantIds.map((id) => [id, {}]),
  ) as SimulationCompleteEvent["surfaceRegionEnergyWhByVariant"];
  const monthly = new Map<string, MonthlyAccumulator>();
  const reportingOffsetMinutes = input.reportingOffsetMinutes ?? 0;
  const startedAt = Date.now();
  const annualTransientRotationByVariant: NonNullable<
    SimulationCompleteEvent["annualTransientRotationByVariant"]
  > = {};
  const transientVariants = input.variants.filter(
    (variant) => variant.annualTransientThermal !== undefined,
  );
  for (const variant of transientVariants) {
      if (hooks.isCancelled?.()) throw new SimulationCancelledError();
      const transient = variant.annualTransientThermal!;
      const rotation = variant.rotation;
      const rpm = rotation?.mode === "fixed" ? rotation.rpm : 0;
      const surfaceOptions = variant.continuousSurface?.surfaceOptions;
      annualTransientRotationByVariant[variant.variantId] = simulateAnnualRotationDecomposition({
        surface: transient.surface,
        weather: input.weather,
        location: input.physics?.location ?? { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
        rpm,
        ...(variant.rotationRpmByWeatherStep === undefined
          ? {}
          : { rpmByWeatherStep: variant.rotationRpmByWeatherStep }),
        initialPhaseRad: rotation?.mode === "fixed"
          ? rotation.initialAngleRad ?? 0
          : rotation?.angleRad ?? 0,
        referenceEfficiency: transient.referenceEfficiency ?? variant.referenceEfficiency,
        gammaPerC: transient.gammaPerC,
        referenceTemperatureC: transient.referenceTemperatureC,
        absorptivity: transient.absorptivity,
        soilingLossFraction: surfaceOptions?.soilingLossFraction,
        albedo: surfaceOptions?.albedo ?? input.physics?.panelDefaults?.albedo,
        iam: surfaceOptions?.iam ?? input.physics?.panelDefaults?.iam,
        diffuseModel: surfaceOptions?.diffuseModel ?? input.physics?.panelDefaults?.diffuseModel,
        initialTemperatureC: transient.initialTemperatureC,
        effectiveSkyTemperatureOffsetC: transient.effectiveSkyTemperatureOffsetC,
        inverter: variant.inverter ?? input.physics?.inverter,
        motorDrive: variant.motorDrive,
        motorRpm: rpm,
        motorRpmByWeatherStep: variant.rotationRpmByWeatherStep,
        thermalMesh: transient.thermalNodeCount === undefined
          ? undefined
          : { targetNodeCount: transient.thermalNodeCount },
        thermalConfig: {
          ...input.physics?.thermal,
          ...(transient.maximumThermalSubstepSeconds === undefined
            ? {}
            : { maximumSubstepSeconds: transient.maximumThermalSubstepSeconds }),
        },
        warmup: {
          periodHours: transient.warmupPeriodHours ?? 24,
          convergenceToleranceC: transient.warmupConvergenceToleranceC ?? 0.02,
        },
        reportingOffsetMinutes,
        opticalPhaseSamples: variant.rotationPhaseSamples,
        convectionPhaseSamples: variant.rotationPhaseSamples,
      });
      // One synchronous E00/E10/E01/E11 calculation cannot yet report
      // internal progress, but cancellation is observed and the event loop is
      // yielded between transient variants.
      if (hooks.isCancelled?.()) throw new SimulationCancelledError();
      await (hooks.yieldControl ?? defaultYield)();
  }
  const thermalModelMetadataByVariant = Object.fromEntries(input.variants.map((variant) => [
    variant.variantId,
    thermalModelMetadata(variant.annualTransientThermal
      ? "annual-transient-material-state"
      : "quasi-steady-faiman"),
  ]));
  const workByStep = input.weather.map((weather, stepIndex) =>
    input.variants.reduce((sum, variant) => {
      const phaseCount = computeStep === computePhysicsStep
        ? rotationPhaseCount({ input, variant, weather, stepIndex })
        : 1;
      const zoneSampleCount = variant.continuousSurface?.samples.length ?? variant.panels?.reduce(
        (variantWork, panel) => variantWork + (panel.surfaceSamples?.length ?? 1),
        0,
      ) ?? 1;
      return sum + Math.max(1, zoneSampleCount) * phaseCount;
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
        stepResults[variant.variantId] = normalizedStepResult(rawResult, weather, variant);
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
          motorEnergyWhByVariant,
          surfaceRegionEnergyWhByVariant,
          reportingOffsetMinutes,
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
        ...(hasMotorDrive ? {
          motorPowerWByVariant: Object.fromEntries(
            variantIds.map((id) => [id, stepResults[id].motorPowerW ?? 0]),
          ),
        } : {}),
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
        surfaceRegionsByVariant: Object.fromEntries(
          variantIds.map((id) => [id, stepResults[id].surfaceRegions ?? {}]),
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
  const authoritativeEnergyPathByVariant = Object.fromEntries(input.variants.map((variant) => [
    variant.variantId,
    variant.annualTransientThermal ? "annual-transient-e11" : "worker-quasi-steady",
  ])) as SimulationCompleteEvent["authoritativeEnergyPathByVariant"];
  Object.entries(annualTransientRotationByVariant).forEach(([variantId, decomposition]) => {
    dcEnergyWhByVariant[variantId] = decomposition.e11.dcEnergyWh;
    acEnergyWhByVariant[variantId] = decomposition.e11.acEnergyWh;
    motorEnergyWhByVariant[variantId] = decomposition.e11.motorEnergyWh;
    // The row stream and region ledger are quasi-steady diagnostics. They
    // cannot be reconciled to the authoritative transient E11 aggregate, so
    // an empty object explicitly means region attribution is unavailable.
    surfaceRegionEnergyWhByVariant[variantId] = {};
  });
  const monthlyKeys = new Set([
    ...monthly.keys(),
    ...Object.values(annualTransientRotationByVariant)
      .flatMap((decomposition) => decomposition.e11.monthly.map((entry) => entry.month)),
  ]);
  const monthlyEnergy: SimulationMonthlyEnergy[] = [...monthlyKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((monthUtc) => {
      const quasiSteady = monthly.get(monthUtc) ?? {
        dcEnergyWhByVariant: Object.fromEntries(variantIds.map((id) => [id, 0])),
        acEnergyWhByVariant: Object.fromEntries(variantIds.map((id) => [id, 0])),
      };
      const dcEnergyWhByVariantForMonth = { ...quasiSteady.dcEnergyWhByVariant };
      const acEnergyWhByVariantForMonth = { ...quasiSteady.acEnergyWhByVariant };
      Object.entries(annualTransientRotationByVariant).forEach(([variantId, decomposition]) => {
        const transient = decomposition.e11.monthly.find((entry) => entry.month === monthUtc);
        dcEnergyWhByVariantForMonth[variantId] = transient?.dcEnergyWh ?? 0;
        acEnergyWhByVariantForMonth[variantId] = transient?.acEnergyWh ?? 0;
      });
      return {
        monthUtc,
        dcEnergyWhByVariant: dcEnergyWhByVariantForMonth,
        acEnergyWhByVariant: acEnergyWhByVariantForMonth,
        ...(hasMotorDrive
          ? {
              motorEnergyWhByVariant: Object.fromEntries(variantIds.map((variantId) => {
                const decomposition = annualTransientRotationByVariant[variantId];
                const transient = decomposition?.e11.monthly.find((entry) => entry.month === monthUtc);
                return [variantId, transient?.motorEnergyWh
                  ?? quasiSteady.motorEnergyWhByVariant?.[variantId] ?? 0];
              })),
            }
          : quasiSteady.motorEnergyWhByVariant === undefined
          ? {}
          : { motorEnergyWhByVariant: quasiSteady.motorEnergyWhByVariant }),
      };
    });
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
    ...(hasMotorDrive ? { motorEnergyWhByVariant } : {}),
    authoritativeEnergyPathByVariant,
    surfaceRegionEnergyWhByVariant,
    thermalModelMetadataByVariant,
    ...(Object.keys(annualTransientRotationByVariant).length === 0
      ? {}
      : { annualTransientRotationByVariant }),
    monthlyEnergy,
    reportingOffsetMinutes,
    steps: input.weather.length,
    intervals: Math.max(0, input.weather.length - 1),
    durationHours: (lastTime - firstTime) / 3_600_000,
    ghiClosureWarningCount,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
}
