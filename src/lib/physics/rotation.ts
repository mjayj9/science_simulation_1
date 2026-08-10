import { DEG2RAD, clamp, mod } from "./types";
import type { Vec3 } from "./types";
import { cross, magnitude, normalize, scale, subtract } from "./vector";

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
