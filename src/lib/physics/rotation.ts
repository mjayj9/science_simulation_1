import { DEG2RAD, clamp, mod } from "./types";
import type { Vec3 } from "./types";
import type { WeatherPoint } from "../weather/types";
import { logWindSpeed, powerLawWindSpeed } from "./environment";
import { cross, dot, magnitude, normalize, rotateAroundY, safeNormalize, scale, subtract } from "./vector";

export interface RotationState {
  angleRad: number;
  angularVelocityRadS: number;
}

export interface RotationDynamics {
  inertiaKgM2: number;
  viscousFrictionNmPerRadS: number;
  coulombFrictionNm: number;
  maximumRpm: number;
  frictionSmoothingRadS?: number;
  maximumSubstepAngleDeg?: number;
}

export interface AerodynamicPanel {
  positionM: Vec3;
  normal: Vec3;
  areaM2: number;
  dragCoefficient?: number;
}

export type AxisymmetricRotationShape = "sphere" | "hemisphere" | "cylinder" | "cone";
export type RotationShape = AxisymmetricRotationShape | "plane" | "cube" | "free";
export type SelfStartingDeviceKind =
  | "auxiliary-rotor"
  | "helical-surface"
  | "user-cq"
  | "measured-curve";

export interface SelfStartingTorqueModel {
  kind: SelfStartingDeviceKind;
  /** Dimensionless C_Q as a function of tip-speed ratio lambda. */
  torqueCoefficient: (tipSpeedRatio: number) => number;
  /** Optional measured/validated provenance used for the confidence grade. */
  source?: "measured" | "manufacturer" | "user";
  label?: string;
}

export interface EnvironmentalAverageRpmInput {
  shape: RotationShape;
  referenceWindSpeedMS: number;
  referenceHeightM: number;
  structureCentreHeightM: number;
  rotorRadiusM: number;
  rotorAreaM2: number;
  maximumRpm: number;
  windProfile?:
    | {
        model: "log";
        roughnessLengthM?: number;
        displacementHeightM?: number;
      }
    | {
        model: "power";
        exponent?: number;
      };
  selfStarting?: SelfStartingTorqueModel;
  airDensityKgM3?: number;
  staticFrictionNm?: number;
  bearingViscousNmPerRadS?: number;
  airDragNmPerRadS2?: number;
}

export type RotationConfidence = "high" | "medium" | "low";

export interface EnvironmentalAverageRpmResult {
  referenceWindSpeedMS: number;
  referenceHeightM: number;
  structureCentreHeightM: number;
  structureWindSpeedMS: number;
  aerodynamicModel: string;
  torqueCoefficient: number;
  staticFrictionNm: number;
  bearingViscousNmPerRadS: number;
  airDragNmPerRadS2: number;
  unconstrainedRpm: number;
  finalRpm: number;
  angularVelocityRadS: number;
  aerodynamicTorqueNm: number;
  lossTorqueNm: number;
  torqueResidualNm: number;
  safetyLimited: boolean;
  confidence: RotationConfidence;
  warning?: string;
}

export interface MonthlyEnvironmentalAverageRpmInput {
  weather: readonly WeatherPoint[];
  /** Fixed offset used to map each UTC timestamp to a local calendar month. */
  timezoneOffsetMinutes: number;
  /**
   * Annual series carry the next-year boundary as their final point. Keep it
   * in the returned schedule for worker length/phase closure, but omit it from
   * the monthly wind statistics because it represents no integrated interval.
   */
  finalPointIsClosingEndpoint?: boolean;
  baseInput: Omit<EnvironmentalAverageRpmInput, "referenceWindSpeedMS">;
}

export interface MonthlyEnvironmentalAverageRpmResult {
  /** Local calendar month in the inclusive range 1..12. */
  localMonth: number;
  sampleCount: number;
  /** Null means the source series contained no sample in this local month. */
  meanReferenceWindSpeedMS: number | null;
  missingWeather: boolean;
  result: EnvironmentalAverageRpmResult;
}

export interface MonthlyEnvironmentalAverageRpmSchedule {
  months: MonthlyEnvironmentalAverageRpmResult[];
  /** One RPM per input weather point, in the original weather-array order. */
  rpmByWeatherStep: number[];
}

export interface MotorDrivePowerInput {
  requiredTorqueNm: number;
  rpm: number;
  motorEfficiency: number;
}

export function motorDrivePowerW(input: MotorDrivePowerInput): number {
  if (!Number.isFinite(input.requiredTorqueNm) || input.requiredTorqueNm < 0) {
    throw new RangeError("requiredTorqueNm must be finite and nonnegative");
  }
  if (!Number.isFinite(input.rpm)) throw new RangeError("rpm must be finite");
  if (!(input.motorEfficiency > 0) || input.motorEfficiency > 1) {
    throw new RangeError("motorEfficiency must satisfy 0 < eta <= 1");
  }
  return input.requiredTorqueNm * Math.abs(rpmToAngularVelocity(input.rpm))
    / input.motorEfficiency;
}

function isAxisymmetricShape(shape: RotationShape): shape is AxisymmetricRotationShape {
  return shape === "sphere"
    || shape === "hemisphere"
    || shape === "cylinder"
    || shape === "cone";
}

function nonnegativeFinite(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${label} must be finite and nonnegative`);
  }
  return resolved;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and positive`);
  }
  return value;
}

function zeroEnvironmentalRpm(
  input: EnvironmentalAverageRpmInput,
  structureWindSpeedMS: number,
  warning: string,
): EnvironmentalAverageRpmResult {
  return {
    referenceWindSpeedMS: input.referenceWindSpeedMS,
    referenceHeightM: input.referenceHeightM,
    structureCentreHeightM: input.structureCentreHeightM,
    structureWindSpeedMS,
    aerodynamicModel: "no-self-starting-torque-model",
    torqueCoefficient: 0,
    staticFrictionNm: nonnegativeFinite(input.staticFrictionNm, 0, "staticFrictionNm"),
    bearingViscousNmPerRadS: nonnegativeFinite(
      input.bearingViscousNmPerRadS,
      0,
      "bearingViscousNmPerRadS",
    ),
    airDragNmPerRadS2: nonnegativeFinite(input.airDragNmPerRadS2, 0, "airDragNmPerRadS2"),
    unconstrainedRpm: 0,
    finalRpm: 0,
    angularVelocityRadS: 0,
    aerodynamicTorqueNm: 0,
    lossTorqueNm: 0,
    torqueResidualNm: 0,
    safetyLimited: false,
    confidence: "high",
    warning,
  };
}

/**
 * Solves 0.5*rho*A*R*C_Q(lambda)*U^2 = tau_static+b*omega+c*omega^2.
 * No environment-name/RPM lookup or fitted shape multiplier is involved.
 */
export function solveEnvironmentalAverageRpm(
  input: EnvironmentalAverageRpmInput,
): EnvironmentalAverageRpmResult {
  nonnegativeFinite(input.referenceWindSpeedMS, 0, "referenceWindSpeedMS");
  positiveFinite(input.referenceHeightM, "referenceHeightM");
  positiveFinite(input.structureCentreHeightM, "structureCentreHeightM");
  positiveFinite(input.rotorRadiusM, "rotorRadiusM");
  positiveFinite(input.rotorAreaM2, "rotorAreaM2");
  nonnegativeFinite(input.maximumRpm, 0, "maximumRpm");
  const profile = input.windProfile ?? { model: "power" as const, exponent: 0.16 };
  const structureWindSpeedMS = profile.model === "log"
    ? logWindSpeed({
        referenceWindSpeedMS: input.referenceWindSpeedMS,
        heightM: input.structureCentreHeightM,
        referenceHeightM: input.referenceHeightM,
        roughnessLengthM: profile.roughnessLengthM,
        displacementHeightM: profile.displacementHeightM,
      })
    : powerLawWindSpeed(
        input.referenceWindSpeedMS,
        input.structureCentreHeightM,
        input.referenceHeightM,
        profile.exponent ?? 0.16,
      );

  if (!input.selfStarting && isAxisymmetricShape(input.shape)) {
    return zeroEnvironmentalRpm(
      input,
      structureWindSpeedMS,
      "현재 축대칭 형상에는 자가 기동 토크를 만드는 공력장치가 없어 자연 회전 RPM을 계산할 수 없습니다.",
    );
  }
  if (!input.selfStarting) {
    return zeroEnvironmentalRpm(
      input,
      structureWindSpeedMS,
      "공력 토크계수 C_Q(λ) 또는 측정 RPM-풍속 곡선이 없어 자연 회전 RPM을 계산할 수 없습니다.",
    );
  }

  const rho = positiveFinite(input.airDensityKgM3 ?? 1.225, "airDensityKgM3");
  const staticFrictionNm = nonnegativeFinite(input.staticFrictionNm, 0, "staticFrictionNm");
  const bearingViscousNmPerRadS = nonnegativeFinite(
    input.bearingViscousNmPerRadS,
    0,
    "bearingViscousNmPerRadS",
  );
  const airDragNmPerRadS2 = nonnegativeFinite(
    input.airDragNmPerRadS2,
    0,
    "airDragNmPerRadS2",
  );
  const maximumOmega = rpmToAngularVelocity(input.maximumRpm);
  const torqueAt = (omega: number): { aerodynamic: number; loss: number; residual: number; cq: number } => {
    const lambda = structureWindSpeedMS > 1e-12
      ? omega * input.rotorRadiusM / structureWindSpeedMS
      : 0;
    const rawCq = input.selfStarting!.torqueCoefficient(lambda);
    if (!Number.isFinite(rawCq)) throw new RangeError("C_Q(lambda) must be finite");
    const cq = Math.max(0, rawCq);
    const aerodynamic = 0.5 * rho * input.rotorAreaM2 * input.rotorRadiusM
      * cq * structureWindSpeedMS ** 2;
    // Static friction applies once motion is attempted. At omega=0 this lets
    // the sign of residual determine whether the device can actually start.
    const loss = staticFrictionNm
      + bearingViscousNmPerRadS * omega
      + airDragNmPerRadS2 * omega * omega;
    return { aerodynamic, loss, residual: aerodynamic - loss, cq };
  };

  const atRest = torqueAt(0);
  if (structureWindSpeedMS <= 1e-12 || atRest.residual <= 0) {
    return {
      ...zeroEnvironmentalRpm(
        input,
        structureWindSpeedMS,
        "평균 공력 기동토크가 베어링 정지마찰을 넘지 못해 평형 RPM은 0입니다.",
      ),
      aerodynamicModel: `${input.selfStarting.kind}: C_Q(lambda) torque balance`,
      torqueCoefficient: atRest.cq,
      staticFrictionNm,
      bearingViscousNmPerRadS,
      airDragNmPerRadS2,
      aerodynamicTorqueNm: atRest.aerodynamic,
      lossTorqueNm: atRest.loss,
      torqueResidualNm: atRest.residual,
      confidence: input.selfStarting.source === "measured" ? "medium" : "low",
    };
  }

  // Find the first stable positive crossing. Expanding the upper bracket well
  // beyond the safety limit separates the unconstrained equilibrium from the
  // subsequently applied structural cap.
  let lower = 0;
  let upper = Math.max(maximumOmega, structureWindSpeedMS / input.rotorRadiusM, 1e-3);
  let upperState = torqueAt(upper);
  for (let expansion = 0; expansion < 60 && upperState.residual > 0; expansion += 1) {
    upper *= 2;
    upperState = torqueAt(upper);
  }
  if (upperState.residual > 0) {
    throw new RangeError("C_Q(lambda) does not produce a finite stable torque equilibrium");
  }
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (torqueAt(midpoint).residual > 0) lower = midpoint;
    else upper = midpoint;
  }
  const unconstrainedOmega = (lower + upper) / 2;
  const finalOmega = Math.min(unconstrainedOmega, maximumOmega);
  const finalState = torqueAt(finalOmega);
  const unconstrainedRpm = angularVelocityToRpm(unconstrainedOmega);
  const finalRpm = angularVelocityToRpm(finalOmega);
  const source = input.selfStarting.source ?? "user";
  return {
    referenceWindSpeedMS: input.referenceWindSpeedMS,
    referenceHeightM: input.referenceHeightM,
    structureCentreHeightM: input.structureCentreHeightM,
    structureWindSpeedMS,
    aerodynamicModel: `${input.selfStarting.kind}: C_Q(lambda) torque balance`,
    torqueCoefficient: finalState.cq,
    staticFrictionNm,
    bearingViscousNmPerRadS,
    airDragNmPerRadS2,
    unconstrainedRpm,
    finalRpm,
    angularVelocityRadS: finalOmega,
    aerodynamicTorqueNm: finalState.aerodynamic,
    lossTorqueNm: finalState.loss,
    torqueResidualNm: finalState.residual,
    safetyLimited: finalOmega < unconstrainedOmega - 1e-12,
    confidence: source === "measured" ? "high" : source === "manufacturer" ? "medium" : "low",
  };
}

/**
 * Builds a deterministic 12-month RPM schedule from arithmetic monthly mean
 * wind speeds. Empty months are never interpolated: they are solved at 0 m/s
 * and carry an explicit warning so downstream callers can keep the gap visible.
 */
export function solveMonthlyEnvironmentalAverageRpm(
  input: MonthlyEnvironmentalAverageRpmInput,
): MonthlyEnvironmentalAverageRpmSchedule {
  if (!Number.isFinite(input.timezoneOffsetMinutes)) {
    throw new RangeError("timezoneOffsetMinutes must be finite");
  }
  if (input.timezoneOffsetMinutes < -14 * 60 || input.timezoneOffsetMinutes > 14 * 60) {
    throw new RangeError("timezoneOffsetMinutes must be within UTC-14:00..UTC+14:00");
  }

  const windSums = Array<number>(12).fill(0);
  const sampleCounts = Array<number>(12).fill(0);
  const localMonthIndices: number[] = [];
  const offsetMilliseconds = input.timezoneOffsetMinutes * 60_000;
  for (const [index, point] of input.weather.entries()) {
    if (!Number.isFinite(point.timeUtcMs)) {
      throw new RangeError(`weather[${index}].timeUtcMs must be finite`);
    }
    if (!Number.isFinite(point.windSpeedMs) || point.windSpeedMs < 0) {
      throw new RangeError(`weather[${index}].windSpeedMs must be finite and nonnegative`);
    }
    const localTimeMilliseconds = point.timeUtcMs + offsetMilliseconds;
    if (!Number.isFinite(localTimeMilliseconds)) {
      throw new RangeError(`weather[${index}] local timestamp is outside the finite range`);
    }
    const localMonthIndex = new Date(localTimeMilliseconds).getUTCMonth();
    if (Number.isNaN(localMonthIndex)) {
      throw new RangeError(`weather[${index}].timeUtcMs is outside the supported Date range`);
    }
    localMonthIndices.push(localMonthIndex);
    const closingEndpoint = input.finalPointIsClosingEndpoint
      && index === input.weather.length - 1;
    if (!closingEndpoint) {
      windSums[localMonthIndex] += point.windSpeedMs;
      sampleCounts[localMonthIndex] += 1;
    }
  }

  const months = Array.from({ length: 12 }, (_, localMonthIndex) => {
    const sampleCount = sampleCounts[localMonthIndex];
    const missingWeather = sampleCount === 0;
    const meanReferenceWindSpeedMS = missingWeather
      ? null
      : windSums[localMonthIndex] / sampleCount;
    const result = solveEnvironmentalAverageRpm({
      ...input.baseInput,
      referenceWindSpeedMS: meanReferenceWindSpeedMS ?? 0,
    });
    return {
      localMonth: localMonthIndex + 1,
      sampleCount,
      meanReferenceWindSpeedMS,
      missingWeather,
      result: missingWeather
        ? {
            ...result,
            warning: [
              "해당 로컬 월에 기상 표본이 없어 평균풍속을 0 m/s로 처리했으며 RPM은 0입니다.",
              result.warning,
            ].filter(Boolean).join(" "),
          }
        : result,
    };
  });
  return {
    months,
    rpmByWeatherStep: localMonthIndices.map(
      (localMonthIndex) => months[localMonthIndex].result.finalRpm,
    ),
  };
}

/** Right-handed panel frame in one coordinate space: sampleAxisU × sampleAxisV = normal. */
export interface PanelFrame {
  normal: Vec3;
  sampleAxisU: Vec3;
  sampleAxisV: Vec3;
}

export interface PanelFrameInput {
  normal: Vec3;
  /** Optional in-plane sampling axis. It is projected onto the panel plane. */
  sampleAxisU?: Vec3;
}

/** Builds a deterministic orthonormal sampling frame around the front normal. */
export function createPanelFrame(input: PanelFrameInput): PanelFrame {
  const normal = normalize(input.normal);
  const reference = Math.abs(normal.y) > 0.9
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 };
  const fallbackU = normalize(cross(reference, normal));
  const requestedU = input.sampleAxisU;
  const projectedU = requestedU
    ? subtract(requestedU, scale(normal, dot(requestedU, normal)))
    : fallbackU;
  const sampleAxisU = safeNormalize(projectedU, fallbackU);
  const sampleAxisV = normalize(cross(normal, sampleAxisU));
  return { normal, sampleAxisU, sampleAxisV };
}

/** Applies the same world +Y transform to the normal and both ray-sampling axes. */
export function rotatePanelFrameAroundY(frame: PanelFrame, angleRad: number): PanelFrame {
  return {
    normal: rotateAroundY(frame.normal, angleRad),
    sampleAxisU: rotateAroundY(frame.sampleAxisU, angleRad),
    sampleAxisV: rotateAroundY(frame.sampleAxisV, angleRad),
  };
}

export function rpmToAngularVelocity(rpm: number): number {
  return 2 * Math.PI * rpm / 60;
}

export function angularVelocityToRpm(angularVelocityRadS: number): number {
  return angularVelocityRadS * 60 / (2 * Math.PI);
}

export function fixedRotation(
  initialAngleRad: number,
  rpm: number,
  elapsedSeconds: number,
): RotationState {
  const angularVelocityRadS = rpmToAngularVelocity(rpm);
  return {
    angleRad: mod(initialAngleRad + angularVelocityRadS * elapsedSeconds, 2 * Math.PI),
    angularVelocityRadS,
  };
}

export function aerodynamicTorqueNm(
  panels: readonly AerodynamicPanel[],
  windVelocityMS: Vec3,
  angularVelocityRadS: number,
  airDensityKgM3 = 1.225,
): number {
  let torque = 0;
  for (const panel of panels) {
    const rotationalVelocity: Vec3 = {
      x: angularVelocityRadS * panel.positionM.z,
      y: 0,
      z: -angularVelocityRadS * panel.positionM.x,
    };
    const relativeWind = subtract(windVelocityMS, rotationalVelocity);
    const speed = magnitude(relativeWind);
    if (speed <= 1e-12) continue;
    const direction = normalize(relativeWind);
    const normal = normalize(panel.normal);
    const projectedArea = Math.max(0, panel.areaM2) * Math.abs(
      normal.x * direction.x + normal.y * direction.y + normal.z * direction.z,
    );
    const force = scale(
      direction,
      0.5 * airDensityKgM3 * (panel.dragCoefficient ?? 1.17) * projectedArea * speed * speed,
    );
    torque += cross(panel.positionM, force).y;
  }
  return torque;
}

export function adaptiveRotationStep(
  state: RotationState,
  deltaSeconds: number,
  windTorque: number | ((state: Readonly<RotationState>) => number),
  dynamics: RotationDynamics,
): RotationState {
  if (!(deltaSeconds >= 0) || !(dynamics.inertiaKgM2 > 0)) {
    throw new RangeError("Rotation timestep must be nonnegative and inertia positive");
  }
  if (deltaSeconds === 0) return { ...state };
  const maximumAngularVelocity = rpmToAngularVelocity(Math.max(0, dynamics.maximumRpm));
  const maximumStepAngle = (dynamics.maximumSubstepAngleDeg ?? 5) * DEG2RAD;
  const estimatedSpeed = Math.max(Math.abs(state.angularVelocityRadS), maximumAngularVelocity * 0.05, 1e-6);
  const byAngle = Math.ceil(deltaSeconds * estimatedSpeed / Math.max(1e-6, maximumStepAngle));
  const mechanicalTime = dynamics.viscousFrictionNmPerRadS > 0
    ? dynamics.inertiaKgM2 / dynamics.viscousFrictionNmPerRadS
    : Number.POSITIVE_INFINITY;
  const byTimeConstant = Number.isFinite(mechanicalTime)
    ? Math.ceil(deltaSeconds / Math.max(1e-6, mechanicalTime / 20))
    : 1;
  const substeps = Math.round(clamp(Math.max(1, byAngle, byTimeConstant), 1, 20_000));
  const dt = deltaSeconds / substeps;
  const smoothing = dynamics.frictionSmoothingRadS ?? 1e-3;
  const next = { ...state };
  for (let index = 0; index < substeps; index += 1) {
    const torque = typeof windTorque === "function" ? windTorque(next) : windTorque;
    const friction =
      dynamics.viscousFrictionNmPerRadS * next.angularVelocityRadS +
      dynamics.coulombFrictionNm * Math.tanh(next.angularVelocityRadS / Math.max(1e-9, smoothing));
    const acceleration = (torque - friction) / dynamics.inertiaKgM2;
    next.angularVelocityRadS = clamp(
      next.angularVelocityRadS + acceleration * dt,
      -maximumAngularVelocity,
      maximumAngularVelocity,
    );
    next.angleRad = mod(next.angleRad + next.angularVelocityRadS * dt, 2 * Math.PI);
  }
  return next;
}

export function phaseAverage(
  evaluator: (angleRad: number) => number,
  samples = 72,
  initialAngleRad = 0,
): number {
  const count = Math.round(clamp(samples, 1, 720));
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    sum += evaluator(mod(initialAngleRad + 2 * Math.PI * (index + 0.5) / count, 2 * Math.PI));
  }
  return sum / count;
}
