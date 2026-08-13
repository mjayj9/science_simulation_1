import type { ComparisonShapeKind } from "../geometry";
import type { WeatherPoint } from "../weather";
import { logWindSpeed, powerLawWindSpeed } from "./environment";
import { angularVelocityToRpm, rpmToAngularVelocity } from "./rotation";

export type NaturalRotationDataSource =
  | "measured"
  | "primary-literature"
  | "manufacturer"
  | "analytic-geometry"
  | "user";

export type NaturalRotationConfidence = "high" | "medium" | "low";

export interface NaturalRotationParameterSource {
  source: NaturalRotationDataSource;
  /** DOI, report identifier, test report, or a concise user-input label. */
  reference: string;
  confidence: NaturalRotationConfidence;
}

export interface AuxiliaryRotorFairness {
  /** Auxiliary rotor plan area counted in the same A_land allocation. */
  footprintAreaM2: number;
  /** Highest point of the complete rotor/structure assembly. */
  assemblyHeightM: number;
  /** Fractional PV-energy shadow loss applied by the PV calculation. */
  shadowLossFraction: number;
  footprintIncludedInLandConstraint: boolean;
  heightIncludedInCommonEnvelope: boolean;
  shadowIncludedInPvYield: boolean;
}

export interface NaturalTorqueCoefficientModel {
  kind: "integrated-shape" | "auxiliary-rotor";
  /** C_Q(lambda) for this exact shape/rotor and Reynolds-number regime. */
  torqueCoefficient: (tipSpeedRatio: number) => number;
  provenance: NaturalRotationParameterSource;
  label?: string;
  /** Required for a physically separate asymmetric passive rotor. */
  auxiliaryRotor?: AuxiliaryRotorFairness;
}

export interface NaturalRotationShapeModel {
  shape: ComparisonShapeKind | "free";
  /** Wind-normal reference area used by the source C_Q definition. */
  projectedAreaM2: number;
  /** Moment arm used by the source C_Q definition. */
  forceApplicationRadiusM: number;
  /** Moment of inertia about the vertical rotation axis. */
  inertiaKgM2: number;
  structureCentreHeightM: number;
  referenceHeightM: number;
  maximumRpm: number;
  staticFrictionNm: number;
  bearingViscousNmPerRadS: number;
  airDragNmPerRadS2: number;
  airDensityKgM3?: number;
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
  torqueModel?: NaturalTorqueCoefficientModel;
  sources: {
    projectedArea: NaturalRotationParameterSource;
    forceApplicationRadius: NaturalRotationParameterSource;
    inertia: NaturalRotationParameterSource;
    frictionAndDrag: NaturalRotationParameterSource;
  };
}

export interface NaturalRotationHistoryOptions {
  weather: readonly WeatherPoint[];
  model: NaturalRotationShapeModel;
  /** Fixed calendar offset for monthly time-weighted averages. */
  timezoneOffsetMinutes?: number;
  /** Default zero is the auditable self-starting condition. */
  initialRpm?: number;
  /** Backward-Euler substep ceiling. Default 60 seconds. */
  maximumSubstepSeconds?: number;
  /** Retained as an audit assertion; the final point is never integrated. */
  finalPointIsClosingEndpoint?: boolean;
}

export interface NaturalRotationIntervalResult {
  startTimeUtcMs: number;
  endTimeUtcMs: number;
  durationSeconds: number;
  startRpm: number;
  endRpm: number;
  /** Exact phase-compatible mean used by the annual worker on this interval. */
  meanRpm: number;
  meanReferenceWindSpeedMS: number;
  meanStructureWindSpeedMS: number;
  aerodynamicImpulseNmS: number;
  lossImpulseNmS: number;
  constraintImpulseNmS: number;
  dynamicBalanceResidualNmS: number;
  substeps: number;
}

export interface NaturalRotationMonthlyResult {
  localMonth: number;
  durationHours: number;
  timeWeightedMeanRpm: number;
  timeWeightedMeanAbsoluteRpm: number;
  timeWeightedMeanReferenceWindSpeedMS: number;
  timeWeightedMeanStructureWindSpeedMS: number;
  substeps: number;
}

export interface NaturalRotationHistoryResult {
  shape: NaturalRotationShapeModel["shape"];
  intervals: NaturalRotationIntervalResult[];
  /** Interval-mean RPM for i < N-1; final instantaneous RPM at the closing point. */
  rpmByWeatherStep: number[];
  /** Instantaneous state at every supplied weather boundary. */
  instantaneousRpmByWeatherStep: number[];
  months: NaturalRotationMonthlyResult[];
  annual: {
    integratedHours: number;
    timeWeightedMeanRpm: number;
    timeWeightedMeanAbsoluteRpm: number;
    finalRpm: number;
    maximumAbsoluteDynamicBalanceResidualNmS: number;
    totalDynamicBalanceResidualNmS: number;
    totalSubsteps: number;
  };
  audit: {
    integrator: "backward-euler";
    equation: "I*domega/dt=tau_aero(V,omega,shape)-tau_loss(omega)";
    aerodynamicTorqueDefinition: "0.5*rho*A_projected*r_CQ*C_Q(lambda)*V_structure^2";
    lossTorqueDefinition: "tau_static+bearing_viscous*omega+air_drag*omega^2";
    symmetricNoSelfStartingDefault: boolean;
    torqueCoefficientInput: "source-backed" | "user-supplied" | "absent";
    confidence: NaturalRotationConfidence;
    officialComparisonEligible: boolean;
    exclusionReasons: string[];
    parameterSources: NaturalRotationShapeModel["sources"] & {
      torqueCoefficient?: NaturalRotationParameterSource;
    };
    finalPointIsClosingEndpoint: boolean;
  };
}

export interface AnalyticShapeRotationInput {
  shape: ComparisonShapeKind;
  widthM: number;
  depthM: number;
  heightM: number;
  radiusM?: number;
  massKg: number;
}

export interface AnalyticShapeRotationParameters {
  projectedAreaM2: number;
  forceApplicationRadiusM: number;
  inertiaKgM2: number;
  sources: Pick<
    NaturalRotationShapeModel["sources"],
    "projectedArea" | "forceApplicationRadius" | "inertia"
  >;
}

interface MonthAccumulator {
  seconds: number;
  omegaIntegralRad: number;
  absoluteOmegaIntegralRad: number;
  referenceWindIntegralMSSeconds: number;
  structureWindIntegralMSSeconds: number;
  substeps: number;
}

interface TorqueState {
  aerodynamicNm: number;
  lossNm: number;
  netNm: number;
}

const TWO_PI = 2 * Math.PI;
const RPM_PER_RAD_S = 60 / TWO_PI;

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and positive`);
  }
  return value;
}

function nonnegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative`);
  }
  return value;
}

function validateSource(source: NaturalRotationParameterSource, label: string): void {
  if (!source.reference.trim()) throw new RangeError(`${label}.reference cannot be empty`);
  if (!["high", "medium", "low"].includes(source.confidence)) {
    throw new RangeError(`${label}.confidence is invalid`);
  }
}

function confidenceRank(confidence: NaturalRotationConfidence): number {
  return confidence === "high" ? 2 : confidence === "medium" ? 1 : 0;
}

function minimumConfidence(
  sources: readonly NaturalRotationParameterSource[],
): NaturalRotationConfidence {
  return sources.reduce<NaturalRotationConfidence>(
    (lowest, source) => confidenceRank(source.confidence) < confidenceRank(lowest)
      ? source.confidence
      : lowest,
    "high",
  );
}

function analyticSource(reference: string): NaturalRotationParameterSource {
  return { source: "analytic-geometry", reference, confidence: "high" };
}

/**
 * Derives frontal area, force radius, and solid-body vertical-axis inertia from
 * explicit geometry and mass. These are formulas, not empirical RPM
 * multipliers; C_Q remains a separate measured/user input.
 */
export function deriveAnalyticShapeRotationParameters(
  input: AnalyticShapeRotationInput,
): AnalyticShapeRotationParameters {
  const widthM = positiveFinite(input.widthM, "widthM");
  const depthM = positiveFinite(input.depthM, "depthM");
  const heightM = positiveFinite(input.heightM, "heightM");
  const massKg = positiveFinite(input.massKg, "massKg");
  const radiusM = input.radiusM === undefined ? undefined : positiveFinite(input.radiusM, "radiusM");

  let projectedAreaM2: number;
  let forceApplicationRadiusM: number;
  let inertiaKgM2: number;
  let areaFormula: string;
  let inertiaFormula: string;
  switch (input.shape) {
    case "sphere":
      if (radiusM === undefined) throw new RangeError("sphere requires radiusM");
      projectedAreaM2 = Math.PI * radiusM ** 2;
      forceApplicationRadiusM = radiusM;
      inertiaKgM2 = 0.4 * massKg * radiusM ** 2;
      areaFormula = "sphere frontal disk: pi*r^2";
      inertiaFormula = "solid sphere about diameter: 2*m*r^2/5";
      break;
    case "hemisphere":
      if (radiusM === undefined) throw new RangeError("hemisphere requires radiusM");
      projectedAreaM2 = 0.5 * Math.PI * radiusM ** 2;
      forceApplicationRadiusM = radiusM;
      inertiaKgM2 = 0.4 * massKg * radiusM ** 2;
      areaFormula = "hemisphere side silhouette: pi*r^2/2";
      inertiaFormula = "solid hemisphere about symmetry axis: 2*m*r^2/5";
      break;
    case "cylinder":
      if (radiusM === undefined) throw new RangeError("cylinder requires radiusM");
      projectedAreaM2 = 2 * radiusM * heightM;
      forceApplicationRadiusM = radiusM;
      inertiaKgM2 = 0.5 * massKg * radiusM ** 2;
      areaFormula = "vertical cylinder frontal rectangle: 2*r*h";
      inertiaFormula = "solid cylinder about symmetry axis: m*r^2/2";
      break;
    case "cone":
      if (radiusM === undefined) throw new RangeError("cone requires radiusM");
      projectedAreaM2 = radiusM * heightM;
      forceApplicationRadiusM = radiusM;
      inertiaKgM2 = 0.3 * massKg * radiusM ** 2;
      areaFormula = "vertical cone triangular silhouette: r*h";
      inertiaFormula = "solid cone about symmetry axis: 3*m*r^2/10";
      break;
    case "cube":
      projectedAreaM2 = widthM * heightM;
      forceApplicationRadiusM = Math.hypot(widthM, depthM) / 2;
      inertiaKgM2 = massKg * (widthM ** 2 + depthM ** 2) / 12;
      areaFormula = "cube reference face: width*height";
      inertiaFormula = "solid rectangular prism: m*(w^2+d^2)/12";
      break;
    case "plane":
      projectedAreaM2 = widthM * heightM;
      forceApplicationRadiusM = Math.hypot(widthM, depthM) / 2;
      inertiaKgM2 = massKg * (widthM ** 2 + depthM ** 2) / 12;
      areaFormula = "plane maximum frontal envelope: width*height";
      inertiaFormula = "thin rectangular body: m*(w^2+d^2)/12";
      break;
  }

  return {
    projectedAreaM2,
    forceApplicationRadiusM,
    inertiaKgM2,
    sources: {
      projectedArea: analyticSource(areaFormula),
      forceApplicationRadius: analyticSource("geometric radius from the vertical rotation axis"),
      inertia: analyticSource(`${inertiaFormula}; mass supplied explicitly`),
    },
  };
}

function structureWindSpeed(model: NaturalRotationShapeModel, referenceWindSpeedMS: number): number {
  const profile = model.windProfile ?? { model: "power" as const, exponent: 0.16 };
  return profile.model === "log"
    ? logWindSpeed({
        referenceWindSpeedMS,
        heightM: model.structureCentreHeightM,
        referenceHeightM: model.referenceHeightM,
        roughnessLengthM: profile.roughnessLengthM,
        displacementHeightM: profile.displacementHeightM,
      })
    : powerLawWindSpeed(
        referenceWindSpeedMS,
        model.structureCentreHeightM,
        model.referenceHeightM,
        profile.exponent ?? 0.16,
      );
}

function torqueAt(
  model: NaturalRotationShapeModel,
  angularVelocityRadS: number,
  structureWindSpeedMS: number,
): TorqueState {
  const omega = Math.max(0, angularVelocityRadS);
  let aerodynamicNm = 0;
  if (model.torqueModel && structureWindSpeedMS > 1e-12) {
    const lambda = omega * model.forceApplicationRadiusM / structureWindSpeedMS;
    const cq = model.torqueModel.torqueCoefficient(lambda);
    if (!Number.isFinite(cq)) throw new RangeError("C_Q(lambda) must be finite");
    aerodynamicNm = 0.5
      * (model.airDensityKgM3 ?? 1.225)
      * model.projectedAreaM2
      * model.forceApplicationRadiusM
      * cq
      * structureWindSpeedMS ** 2;
  }
  const movingLossNm = model.staticFrictionNm
    + model.bearingViscousNmPerRadS * omega
    + model.airDragNmPerRadS2 * omega ** 2;
  // Stiction exactly cancels sub-threshold torque at rest.
  const lossNm = omega <= 1e-12 && aerodynamicNm <= model.staticFrictionNm
    ? aerodynamicNm
    : movingLossNm;
  return { aerodynamicNm, lossNm, netNm: aerodynamicNm - lossNm };
}

function nextLocalMonthBoundaryUtcMs(timeUtcMs: number, offsetMilliseconds: number): number {
  const local = new Date(timeUtcMs + offsetMilliseconds);
  const boundary = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1)
    - offsetMilliseconds;
  if (boundary > timeUtcMs + 1e-6) return boundary;
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 2, 1)
    - offsetMilliseconds;
}

function localMonthIndex(timeUtcMs: number, offsetMilliseconds: number): number {
  return new Date(timeUtcMs + offsetMilliseconds).getUTCMonth();
}

function validateModel(model: NaturalRotationShapeModel): void {
  positiveFinite(model.projectedAreaM2, "projectedAreaM2");
  positiveFinite(model.forceApplicationRadiusM, "forceApplicationRadiusM");
  positiveFinite(model.inertiaKgM2, "inertiaKgM2");
  positiveFinite(model.structureCentreHeightM, "structureCentreHeightM");
  positiveFinite(model.referenceHeightM, "referenceHeightM");
  nonnegativeFinite(model.maximumRpm, "maximumRpm");
  nonnegativeFinite(model.staticFrictionNm, "staticFrictionNm");
  nonnegativeFinite(model.bearingViscousNmPerRadS, "bearingViscousNmPerRadS");
  nonnegativeFinite(model.airDragNmPerRadS2, "airDragNmPerRadS2");
  positiveFinite(model.airDensityKgM3 ?? 1.225, "airDensityKgM3");
  for (const [label, source] of Object.entries(model.sources)) validateSource(source, label);
  if (model.torqueModel) {
    validateSource(model.torqueModel.provenance, "torqueModel.provenance");
    if (!Number.isFinite(model.torqueModel.torqueCoefficient(0))) {
      throw new RangeError("C_Q(0) must be finite");
    }
    const rotor = model.torqueModel.auxiliaryRotor;
    if (rotor) {
      nonnegativeFinite(rotor.footprintAreaM2, "auxiliaryRotor.footprintAreaM2");
      positiveFinite(rotor.assemblyHeightM, "auxiliaryRotor.assemblyHeightM");
      if (
        !Number.isFinite(rotor.shadowLossFraction)
        || rotor.shadowLossFraction < 0
        || rotor.shadowLossFraction > 1
      ) {
        throw new RangeError("auxiliaryRotor.shadowLossFraction must be within 0..1");
      }
    }
  }
}

function backwardEulerOmega(
  model: NaturalRotationShapeModel,
  startOmegaRadS: number,
  structureWindSpeedMS: number,
  deltaSeconds: number,
): { omegaRadS: number; torque: TorqueState; constraintTorqueNm: number } {
  const maximumOmega = rpmToAngularVelocity(model.maximumRpm);
  if (maximumOmega <= 0) {
    const torque = torqueAt(model, 0, structureWindSpeedMS);
    return { omegaRadS: 0, torque, constraintTorqueNm: -torque.netNm };
  }
  const residual = (candidate: number): number => candidate - startOmegaRadS
    - deltaSeconds * torqueAt(model, candidate, structureWindSpeedMS).netNm / model.inertiaKgM2;
  const atFloor = residual(0);
  const atCeiling = residual(maximumOmega);
  let omegaRadS: number;
  if (atFloor >= 0) omegaRadS = 0;
  else if (atCeiling <= 0) omegaRadS = maximumOmega;
  else {
    let lower = 0;
    let upper = maximumOmega;
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const midpoint = (lower + upper) / 2;
      if (residual(midpoint) <= 0) lower = midpoint;
      else upper = midpoint;
    }
    omegaRadS = (lower + upper) / 2;
  }
  const torque = torqueAt(model, omegaRadS, structureWindSpeedMS);
  const actualAccelerationTorqueNm = model.inertiaKgM2
    * (omegaRadS - startOmegaRadS) / deltaSeconds;
  return {
    omegaRadS,
    torque,
    // Constraint reaction closes the balance at omega=0 and omega=omega_max.
    constraintTorqueNm: actualAccelerationTorqueNm - torque.netNm,
  };
}

function emptyMonthAccumulators(): MonthAccumulator[] {
  return Array.from({ length: 12 }, () => ({
    seconds: 0,
    omegaIntegralRad: 0,
    absoluteOmegaIntegralRad: 0,
    referenceWindIntegralMSSeconds: 0,
    structureWindIntegralMSSeconds: 0,
    substeps: 0,
  }));
}

function fairnessAudit(model: NaturalRotationShapeModel): {
  eligible: boolean;
  reasons: string[];
} {
  if (model.torqueModel?.kind !== "auxiliary-rotor") return { eligible: true, reasons: [] };
  const rotor = model.torqueModel.auxiliaryRotor;
  if (!rotor) return { eligible: false, reasons: ["auxiliary-rotor-fairness-data-missing"] };
  const reasons: string[] = [];
  if (!rotor.footprintIncludedInLandConstraint) reasons.push("auxiliary-footprint-not-in-A_land");
  if (!rotor.heightIncludedInCommonEnvelope) reasons.push("auxiliary-height-not-in-H_max");
  if (!rotor.shadowIncludedInPvYield) reasons.push("auxiliary-shadow-not-in-PV-yield");
  return { eligible: reasons.length === 0, reasons };
}

/**
 * Integrates natural rotation at every weather interval. It deliberately does
 * not evaluate a monthly/annual mean wind in a steady-state torque equation.
 * Interval means are phase-compatible with `rotationRpmByWeatherStep`.
 */
export function integrateNaturalRotationHistory(
  input: NaturalRotationHistoryOptions,
): NaturalRotationHistoryResult {
  validateModel(input.model);
  if (input.weather.length < 2) throw new RangeError("weather requires at least two boundaries");
  const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? 0;
  if (
    !Number.isFinite(timezoneOffsetMinutes)
    || timezoneOffsetMinutes < -14 * 60
    || timezoneOffsetMinutes > 14 * 60
  ) {
    throw new RangeError("timezoneOffsetMinutes must be within UTC-14:00..UTC+14:00");
  }
  const maximumSubstepSeconds = positiveFinite(
    input.maximumSubstepSeconds ?? 60,
    "maximumSubstepSeconds",
  );
  const initialRpm = input.initialRpm ?? 0;
  if (!Number.isFinite(initialRpm) || initialRpm < 0 || initialRpm > input.model.maximumRpm) {
    throw new RangeError("initialRpm must be finite and within 0..maximumRpm");
  }
  for (const [index, point] of input.weather.entries()) {
    if (!Number.isFinite(point.timeUtcMs)) {
      throw new RangeError(`weather[${index}].timeUtcMs must be finite`);
    }
    if (!Number.isFinite(point.windSpeedMs) || point.windSpeedMs < 0) {
      throw new RangeError(`weather[${index}].windSpeedMs must be finite and nonnegative`);
    }
    if (index > 0 && point.timeUtcMs <= input.weather[index - 1].timeUtcMs) {
      throw new RangeError("weather timestamps must be strictly increasing");
    }
  }

  const offsetMilliseconds = timezoneOffsetMinutes * 60_000;
  const monthAccumulators = emptyMonthAccumulators();
  const intervals: NaturalRotationIntervalResult[] = [];
  const instantaneousRpmByWeatherStep = Array<number>(input.weather.length).fill(0);
  const rpmByWeatherStep = Array<number>(input.weather.length).fill(0);
  let omegaRadS = rpmToAngularVelocity(initialRpm);
  instantaneousRpmByWeatherStep[0] = initialRpm;
  let totalDynamicBalanceResidualNmS = 0;
  let maximumAbsoluteDynamicBalanceResidualNmS = 0;
  let totalSubsteps = 0;
  let totalOmegaIntegralRad = 0;
  let totalAbsoluteOmegaIntegralRad = 0;
  let totalSeconds = 0;

  for (let intervalIndex = 0; intervalIndex < input.weather.length - 1; intervalIndex += 1) {
    const startWeather = input.weather[intervalIndex];
    const endWeather = input.weather[intervalIndex + 1];
    const intervalDurationSeconds = (endWeather.timeUtcMs - startWeather.timeUtcMs) / 1_000;
    const intervalStartOmegaRadS = omegaRadS;
    let cursorUtcMs = startWeather.timeUtcMs;
    let omegaIntegralRad = 0;
    let referenceWindIntegral = 0;
    let structureWindIntegral = 0;
    let aerodynamicImpulseNmS = 0;
    let lossImpulseNmS = 0;
    let constraintImpulseNmS = 0;
    let intervalSubsteps = 0;
    while (cursorUtcMs < endWeather.timeUtcMs - 1e-6) {
      const nextMonthBoundary = nextLocalMonthBoundaryUtcMs(cursorUtcMs, offsetMilliseconds);
      const substepEndUtcMs = Math.min(
        endWeather.timeUtcMs,
        cursorUtcMs + maximumSubstepSeconds * 1_000,
        nextMonthBoundary,
      );
      const deltaSeconds = (substepEndUtcMs - cursorUtcMs) / 1_000;
      if (!(deltaSeconds > 0)) throw new RangeError("natural-rotation substep did not advance");
      const midpointUtcMs = (cursorUtcMs + substepEndUtcMs) / 2;
      const fraction = (midpointUtcMs - startWeather.timeUtcMs)
        / (endWeather.timeUtcMs - startWeather.timeUtcMs);
      const referenceWindSpeedMS = startWeather.windSpeedMs
        + (endWeather.windSpeedMs - startWeather.windSpeedMs) * fraction;
      const structureWindSpeedMS = structureWindSpeed(input.model, referenceWindSpeedMS);
      const startOmegaRadS = omegaRadS;
      const solved = backwardEulerOmega(
        input.model,
        startOmegaRadS,
        structureWindSpeedMS,
        deltaSeconds,
      );
      omegaRadS = solved.omegaRadS;
      const meanOmegaRadS = 0.5 * (startOmegaRadS + omegaRadS);
      const omegaSubstepIntegralRad = meanOmegaRadS * deltaSeconds;
      const absoluteOmegaSubstepIntegralRad = 0.5
        * (Math.abs(startOmegaRadS) + Math.abs(omegaRadS))
        * deltaSeconds;
      const aerodynamicImpulse = solved.torque.aerodynamicNm * deltaSeconds;
      const lossImpulse = solved.torque.lossNm * deltaSeconds;
      const constraintImpulse = solved.constraintTorqueNm * deltaSeconds;
      const residualNmS = input.model.inertiaKgM2 * (omegaRadS - startOmegaRadS)
        - (aerodynamicImpulse - lossImpulse + constraintImpulse);

      const month = monthAccumulators[localMonthIndex(midpointUtcMs, offsetMilliseconds)];
      month.seconds += deltaSeconds;
      month.omegaIntegralRad += omegaSubstepIntegralRad;
      month.absoluteOmegaIntegralRad += absoluteOmegaSubstepIntegralRad;
      month.referenceWindIntegralMSSeconds += referenceWindSpeedMS * deltaSeconds;
      month.structureWindIntegralMSSeconds += structureWindSpeedMS * deltaSeconds;
      month.substeps += 1;
      omegaIntegralRad += omegaSubstepIntegralRad;
      referenceWindIntegral += referenceWindSpeedMS * deltaSeconds;
      structureWindIntegral += structureWindSpeedMS * deltaSeconds;
      aerodynamicImpulseNmS += aerodynamicImpulse;
      lossImpulseNmS += lossImpulse;
      constraintImpulseNmS += constraintImpulse;
      totalDynamicBalanceResidualNmS += residualNmS;
      maximumAbsoluteDynamicBalanceResidualNmS = Math.max(
        maximumAbsoluteDynamicBalanceResidualNmS,
        Math.abs(residualNmS),
      );
      totalOmegaIntegralRad += omegaSubstepIntegralRad;
      totalAbsoluteOmegaIntegralRad += absoluteOmegaSubstepIntegralRad;
      totalSeconds += deltaSeconds;
      intervalSubsteps += 1;
      totalSubsteps += 1;
      cursorUtcMs = substepEndUtcMs;
    }
    const endRpm = angularVelocityToRpm(omegaRadS);
    const intervalResidualNmS = input.model.inertiaKgM2
      * (omegaRadS - intervalStartOmegaRadS)
      - (aerodynamicImpulseNmS - lossImpulseNmS + constraintImpulseNmS);
    const meanRpm = omegaIntegralRad / intervalDurationSeconds * RPM_PER_RAD_S;
    intervals.push({
      startTimeUtcMs: startWeather.timeUtcMs,
      endTimeUtcMs: endWeather.timeUtcMs,
      durationSeconds: intervalDurationSeconds,
      startRpm: angularVelocityToRpm(intervalStartOmegaRadS),
      endRpm,
      meanRpm,
      meanReferenceWindSpeedMS: referenceWindIntegral / intervalDurationSeconds,
      meanStructureWindSpeedMS: structureWindIntegral / intervalDurationSeconds,
      aerodynamicImpulseNmS,
      lossImpulseNmS,
      constraintImpulseNmS,
      dynamicBalanceResidualNmS: intervalResidualNmS,
      substeps: intervalSubsteps,
    });
    rpmByWeatherStep[intervalIndex] = meanRpm;
    instantaneousRpmByWeatherStep[intervalIndex + 1] = endRpm;
  }
  rpmByWeatherStep[rpmByWeatherStep.length - 1] = angularVelocityToRpm(omegaRadS);

  const months = monthAccumulators.map((month, monthIndex) => ({
    localMonth: monthIndex + 1,
    durationHours: month.seconds / 3_600,
    timeWeightedMeanRpm: month.seconds > 0
      ? month.omegaIntegralRad / month.seconds * RPM_PER_RAD_S
      : 0,
    timeWeightedMeanAbsoluteRpm: month.seconds > 0
      ? month.absoluteOmegaIntegralRad / month.seconds * RPM_PER_RAD_S
      : 0,
    timeWeightedMeanReferenceWindSpeedMS: month.seconds > 0
      ? month.referenceWindIntegralMSSeconds / month.seconds
      : 0,
    timeWeightedMeanStructureWindSpeedMS: month.seconds > 0
      ? month.structureWindIntegralMSSeconds / month.seconds
      : 0,
    substeps: month.substeps,
  }));
  const fairness = fairnessAudit(input.model);
  const parameterSources = {
    ...input.model.sources,
    ...(input.model.torqueModel
      ? { torqueCoefficient: input.model.torqueModel.provenance }
      : {}),
  };
  const confidence = minimumConfidence(Object.values(parameterSources));
  const torqueSource = input.model.torqueModel?.provenance.source;

  return {
    shape: input.model.shape,
    intervals,
    rpmByWeatherStep,
    instantaneousRpmByWeatherStep,
    months,
    annual: {
      integratedHours: totalSeconds / 3_600,
      timeWeightedMeanRpm: totalSeconds > 0
        ? totalOmegaIntegralRad / totalSeconds * RPM_PER_RAD_S
        : 0,
      timeWeightedMeanAbsoluteRpm: totalSeconds > 0
        ? totalAbsoluteOmegaIntegralRad / totalSeconds * RPM_PER_RAD_S
        : 0,
      finalRpm: angularVelocityToRpm(omegaRadS),
      maximumAbsoluteDynamicBalanceResidualNmS,
      totalDynamicBalanceResidualNmS,
      totalSubsteps,
    },
    audit: {
      integrator: "backward-euler",
      equation: "I*domega/dt=tau_aero(V,omega,shape)-tau_loss(omega)",
      aerodynamicTorqueDefinition: "0.5*rho*A_projected*r_CQ*C_Q(lambda)*V_structure^2",
      lossTorqueDefinition: "tau_static+bearing_viscous*omega+air_drag*omega^2",
      symmetricNoSelfStartingDefault: input.model.torqueModel === undefined && initialRpm === 0,
      torqueCoefficientInput: input.model.torqueModel === undefined
        ? "absent"
        : torqueSource === "user"
          ? "user-supplied"
          : "source-backed",
      confidence,
      officialComparisonEligible: fairness.eligible,
      exclusionReasons: fairness.reasons,
      parameterSources,
      finalPointIsClosingEndpoint: input.finalPointIsClosingEndpoint ?? false,
    },
  };
}
