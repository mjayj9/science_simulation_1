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
  /** Wind-normal area used in C_Q=tau/(0.5*rho*V^2*A_ref*R_ref). */
  referenceProjectedAreaM2?: number;
  /** Rotor radius used both by the C_Q moment normalization and lambda=omega*R_ref/V. */
  referenceRadiusM?: number;
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
  /**
   * `directional-shape` evaluates the analytic body silhouette at every
   * weather/phase substep. `fixed-reference` follows a source C_Q definition
   * with one explicit A_ref and R_ref. Auxiliary rotors always use their own
   * fixed reference values and never borrow the PV body's dimensions.
   */
  referenceBasis?: "directional-shape" | "fixed-reference";
  referenceProjectedAreaM2?: number;
  referenceRadiusM?: number;
}

export interface NaturalRotationDirectionalAerodynamics {
  /** Human-readable analytic definition included in the audit trail. */
  definition: string;
  evaluate: (windDirectionRad: number, bodyAngleRad: number) => {
    projectedAreaM2: number;
    forceApplicationRadiusM: number;
  };
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
  /** Optional wind-direction/body-phase-resolved silhouette and moment arm. */
  directionalAerodynamics?: NaturalRotationDirectionalAerodynamics;
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
  /** Initial body yaw about the vertical axis. Default 0 rad. */
  initialAngleRad?: number;
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
  startAngleRad: number;
  endAngleRad: number;
  meanProjectedAreaM2: number;
  meanForceApplicationRadiusM: number;
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
  /** Wrapped body yaw at every supplied weather boundary. */
  instantaneousAngleRadByWeatherStep: number[];
  months: NaturalRotationMonthlyResult[];
  annual: {
    integratedHours: number;
    timeWeightedMeanRpm: number;
    timeWeightedMeanAbsoluteRpm: number;
    finalRpm: number;
    maximumAbsoluteDynamicBalanceResidualNmS: number;
    totalDynamicBalanceResidualNmS: number;
    totalSubsteps: number;
    timeWeightedMeanProjectedAreaM2: number;
    timeWeightedMeanForceApplicationRadiusM: number;
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
    directionalProjectedGeometry: boolean;
    directionalGeometryDefinition: string;
    torqueCoefficientReference: "absent" | "directional-shape" | "fixed-reference" | "auxiliary-rotor-fixed-reference";
    rotationScheduleDefinition: "interval-time-mean-rpm; prefix-phase equals integrated omega";
    phaseScheduleClosureRad: number;
  };
}

export interface AnalyticShapeRotationInput {
  shape: ComparisonShapeKind;
  widthM: number;
  depthM: number;
  heightM: number;
  radiusM?: number;
  planeTiltDeg?: number;
  planeAzimuthDeg?: number;
  planeSlantLengthM?: number;
  massKg: number;
}

export interface AnalyticShapeRotationParameters {
  projectedAreaM2: number;
  forceApplicationRadiusM: number;
  inertiaKgM2: number;
  directionalAerodynamics: NaturalRotationDirectionalAerodynamics;
  sources: Pick<
    NaturalRotationShapeModel["sources"],
    "projectedArea" | "forceApplicationRadius" | "inertia"
  >;
}

interface MonthAccumulator {
  seconds: number;
  omegaIntegralRad: number;
  projectedAreaIntegralM2Seconds: number;
  forceRadiusIntegralMSeconds: number;
  absoluteOmegaIntegralRad: number;
  referenceWindIntegralMSSeconds: number;
  structureWindIntegralMSSeconds: number;
  substeps: number;
}

interface TorqueState {
  aerodynamicNm: number;
  lossNm: number;
  netNm: number;
  projectedAreaM2: number;
  forceApplicationRadiusM: number;
  tipSpeedRatio: number;
  torqueCoefficient: number;
}

interface AerodynamicReference {
  projectedAreaM2: number;
  forceApplicationRadiusM: number;
  kind: "directional-shape" | "fixed-reference" | "auxiliary-rotor-fixed-reference";
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

function wrapRadians(value: number): number {
  const wrapped = value % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function relativeWindAngle(
  windDirectionRad: number,
  bodyAngleRad: number,
  referenceAzimuthRad: number,
): number {
  return wrapRadians(windDirectionRad - bodyAngleRad - referenceAzimuthRad);
}

/**
 * Derives the horizontal-wind silhouette, C_Q moment reference radius, and
 * vertical-axis inertia of a uniform PV thin skin. `massKg` is the rotating
 * skin/laminate mass supplied explicitly (normally A_PV times an areal mass);
 * no solid-volume mass is invented. C_Q remains a separate measured or user
 * input and is never inferred from these geometric formulas.
 */
export function deriveAnalyticShapeRotationParameters(
  input: AnalyticShapeRotationInput,
): AnalyticShapeRotationParameters {
  const widthM = positiveFinite(input.widthM, "widthM");
  const depthM = positiveFinite(input.depthM, "depthM");
  const heightM = positiveFinite(input.heightM, "heightM");
  const massKg = positiveFinite(input.massKg, "massKg");
  const radiusM = input.radiusM === undefined ? undefined : positiveFinite(input.radiusM, "radiusM");
  const planeSlantLengthM = input.shape === "plane"
    ? positiveFinite(input.planeSlantLengthM ?? Math.hypot(depthM, heightM), "planeSlantLengthM")
    : 0;
  const planeTiltRad = input.shape === "plane"
    ? (input.planeTiltDeg === undefined
        ? Math.atan2(heightM, depthM)
        : input.planeTiltDeg * Math.PI / 180)
    : 0;
  const planeAzimuthRad = (input.planeAzimuthDeg ?? 0) * Math.PI / 180;
  if (!Number.isFinite(planeTiltRad) || planeTiltRad < 0 || planeTiltRad > Math.PI / 2) {
    throw new RangeError("planeTiltDeg must be within 0..90 degrees");
  }
  if (!Number.isFinite(planeAzimuthRad)) throw new RangeError("planeAzimuthDeg must be finite");

  let projectedAreaM2: number;
  let forceApplicationRadiusM: number;
  let inertiaKgM2: number;
  let areaFormula: string;
  let inertiaFormula: string;
  let directionalAerodynamics: NaturalRotationDirectionalAerodynamics;
  switch (input.shape) {
    case "sphere":
      if (radiusM === undefined) throw new RangeError("sphere requires radiusM");
      projectedAreaM2 = Math.PI * radiusM ** 2;
      forceApplicationRadiusM = radiusM;
      inertiaKgM2 = 2 * massKg * radiusM ** 2 / 3;
      areaFormula = "sphere frontal disk: pi*r^2";
      inertiaFormula = "uniform spherical PV thin skin: 2*m*r^2/3";
      directionalAerodynamics = {
        definition: "axisymmetric sphere: A=pi*r^2 and R_ref=r for every wind azimuth",
        evaluate: () => ({ projectedAreaM2, forceApplicationRadiusM }),
      };
      break;
    case "hemisphere":
      if (radiusM === undefined) throw new RangeError("hemisphere requires radiusM");
      projectedAreaM2 = 0.5 * Math.PI * radiusM ** 2;
      forceApplicationRadiusM = radiusM;
      inertiaKgM2 = 2 * massKg * radiusM ** 2 / 3;
      areaFormula = "hemisphere side silhouette: pi*r^2/2";
      inertiaFormula = "uniform hemispherical PV thin skin: 2*m*r^2/3";
      directionalAerodynamics = {
        definition: "axisymmetric hemisphere: A=pi*r^2/2 and R_ref=r for every wind azimuth",
        evaluate: () => ({ projectedAreaM2, forceApplicationRadiusM }),
      };
      break;
    case "cylinder":
      if (radiusM === undefined) throw new RangeError("cylinder requires radiusM");
      projectedAreaM2 = 2 * radiusM * heightM;
      forceApplicationRadiusM = radiusM;
      {
        const topAreaM2 = Math.PI * radiusM ** 2;
        const lateralAreaM2 = 2 * Math.PI * radiusM * heightM;
        inertiaKgM2 = massKg * radiusM ** 2
          * (0.5 * topAreaM2 + lateralAreaM2) / (topAreaM2 + lateralAreaM2);
      }
      areaFormula = "vertical cylinder frontal rectangle: 2*r*h";
      inertiaFormula = "uniform top-disk plus lateral cylindrical PV skin, area-weighted";
      directionalAerodynamics = {
        definition: "axisymmetric cylinder: A=2*r*h and R_ref=r for every wind azimuth",
        evaluate: () => ({ projectedAreaM2, forceApplicationRadiusM }),
      };
      break;
    case "cone":
      if (radiusM === undefined) throw new RangeError("cone requires radiusM");
      projectedAreaM2 = radiusM * heightM;
      forceApplicationRadiusM = radiusM;
      inertiaKgM2 = 0.5 * massKg * radiusM ** 2;
      areaFormula = "vertical cone triangular silhouette: r*h";
      inertiaFormula = "uniform lateral conical PV thin skin: m*r^2/2";
      directionalAerodynamics = {
        definition: "axisymmetric cone: A=r*h and R_ref=r for every wind azimuth",
        evaluate: () => ({ projectedAreaM2, forceApplicationRadiusM }),
      };
      break;
    case "cube":
      projectedAreaM2 = widthM * heightM;
      forceApplicationRadiusM = Math.hypot(widthM, depthM) / 2;
      {
        const topAreaM2 = widthM * depthM;
        const xFaceAreaM2 = 2 * depthM * heightM;
        const zFaceAreaM2 = 2 * widthM * heightM;
        const activeSkinAreaM2 = topAreaM2 + xFaceAreaM2 + zFaceAreaM2;
        const areaMomentM4 = topAreaM2 * (widthM ** 2 + depthM ** 2) / 12
          + xFaceAreaM2 * (widthM ** 2 / 4 + depthM ** 2 / 12)
          + zFaceAreaM2 * (depthM ** 2 / 4 + widthM ** 2 / 12);
        inertiaKgM2 = massKg * areaMomentM4 / activeSkinAreaM2;
      }
      areaFormula = "rectangular 5-face skin: A(psi)=h*(w*|cos psi|+d*|sin psi|)";
      inertiaFormula = "uniform top plus four-side PV thin skin, face-area-weighted";
      directionalAerodynamics = {
        definition: "cube/box yaw silhouette and half cross-wind support width evaluated per weather substep",
        evaluate: (windDirectionRad, bodyAngleRad) => {
          const relative = relativeWindAngle(windDirectionRad, bodyAngleRad, 0);
          const projectedWidthM = widthM * Math.abs(Math.cos(relative))
            + depthM * Math.abs(Math.sin(relative));
          return {
            projectedAreaM2: heightM * projectedWidthM,
            forceApplicationRadiusM: projectedWidthM / 2,
          };
        },
      };
      break;
    case "plane":
      projectedAreaM2 = widthM * planeSlantLengthM * Math.sin(planeTiltRad);
      forceApplicationRadiusM = Math.hypot(widthM, depthM) / 2;
      inertiaKgM2 = massKg * (widthM ** 2 + depthM ** 2) / 12;
      areaFormula = "tilted plane: A(psi)=w*L*sin(tilt)*|cos psi|";
      inertiaFormula = "uniform tilted rectangular PV skin: m*(w^2+(L*cos tilt)^2)/12";
      directionalAerodynamics = {
        definition: "tilted-plane horizontal-wind projection and half cross-wind support width evaluated per weather substep",
        evaluate: (windDirectionRad, bodyAngleRad) => {
          const relative = relativeWindAngle(windDirectionRad, bodyAngleRad, planeAzimuthRad);
          const absoluteCosine = Math.abs(Math.cos(relative));
          const absoluteSine = Math.abs(Math.sin(relative));
          const horizontalSlantProjectionM = planeSlantLengthM * Math.cos(planeTiltRad);
          return {
            projectedAreaM2: projectedAreaM2 * absoluteCosine,
            forceApplicationRadiusM: (
              widthM * absoluteCosine + horizontalSlantProjectionM * absoluteSine
            ) / 2,
          };
        },
      };
      break;
  }

  return {
    projectedAreaM2,
    forceApplicationRadiusM,
    inertiaKgM2,
    directionalAerodynamics,
    sources: {
      projectedArea: analyticSource(areaFormula),
      forceApplicationRadius: analyticSource("wind-direction-resolved geometric moment reference about the vertical axis"),
      inertia: analyticSource(`${inertiaFormula}; rotating PV-skin mass supplied explicitly`),
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

function aerodynamicReferenceAt(
  model: NaturalRotationShapeModel,
  windDirectionRad: number,
  bodyAngleRad: number,
): AerodynamicReference {
  const directional = model.directionalAerodynamics?.evaluate(windDirectionRad, bodyAngleRad) ?? {
    projectedAreaM2: model.projectedAreaM2,
    forceApplicationRadiusM: model.forceApplicationRadiusM,
  };
  nonnegativeFinite(directional.projectedAreaM2, "directional projectedAreaM2");
  positiveFinite(directional.forceApplicationRadiusM, "directional forceApplicationRadiusM");
  const torqueModel = model.torqueModel;
  if (torqueModel?.kind === "auxiliary-rotor") {
    return {
      projectedAreaM2: torqueModel.auxiliaryRotor?.referenceProjectedAreaM2
        ?? torqueModel.referenceProjectedAreaM2
        ?? 0,
      forceApplicationRadiusM: torqueModel.auxiliaryRotor?.referenceRadiusM
        ?? torqueModel.referenceRadiusM
        ?? 0,
      kind: "auxiliary-rotor-fixed-reference",
    };
  }
  const referenceBasis = torqueModel?.referenceBasis
    ?? (model.directionalAerodynamics ? "directional-shape" : "fixed-reference");
  if (referenceBasis === "directional-shape") {
    return { ...directional, kind: "directional-shape" };
  }
  return {
    projectedAreaM2: torqueModel?.referenceProjectedAreaM2 ?? model.projectedAreaM2,
    forceApplicationRadiusM: torqueModel?.referenceRadiusM ?? model.forceApplicationRadiusM,
    kind: "fixed-reference",
  };
}

function torqueAt(
  model: NaturalRotationShapeModel,
  angularVelocityRadS: number,
  structureWindSpeedMS: number,
  windDirectionRad: number,
  bodyAngleRad: number,
): TorqueState {
  const omega = Math.max(0, angularVelocityRadS);
  const reference = aerodynamicReferenceAt(model, windDirectionRad, bodyAngleRad);
  let aerodynamicNm = 0;
  let lambda = 0;
  let cq = 0;
  if (model.torqueModel && structureWindSpeedMS > 1e-12
    && reference.projectedAreaM2 > 0 && reference.forceApplicationRadiusM > 0) {
    lambda = omega * reference.forceApplicationRadiusM / structureWindSpeedMS;
    cq = model.torqueModel.torqueCoefficient(lambda);
    if (!Number.isFinite(cq)) throw new RangeError("C_Q(lambda) must be finite");
    aerodynamicNm = 0.5
      * (model.airDensityKgM3 ?? 1.225)
      * reference.projectedAreaM2
      * reference.forceApplicationRadiusM
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
  return {
    aerodynamicNm,
    lossNm,
    netNm: aerodynamicNm - lossNm,
    projectedAreaM2: reference.projectedAreaM2,
    forceApplicationRadiusM: reference.forceApplicationRadiusM,
    tipSpeedRatio: lambda,
    torqueCoefficient: cq,
  };
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
  nonnegativeFinite(model.projectedAreaM2, "projectedAreaM2");
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
    if (model.torqueModel.referenceProjectedAreaM2 !== undefined) {
      nonnegativeFinite(model.torqueModel.referenceProjectedAreaM2, "torqueModel.referenceProjectedAreaM2");
    }
    if (model.torqueModel.referenceRadiusM !== undefined) {
      nonnegativeFinite(model.torqueModel.referenceRadiusM, "torqueModel.referenceRadiusM");
    }
    const rotor = model.torqueModel.auxiliaryRotor;
    if (rotor) {
      if (rotor.referenceProjectedAreaM2 !== undefined) {
        nonnegativeFinite(rotor.referenceProjectedAreaM2, "auxiliaryRotor.referenceProjectedAreaM2");
      }
      if (rotor.referenceRadiusM !== undefined) {
        nonnegativeFinite(rotor.referenceRadiusM, "auxiliaryRotor.referenceRadiusM");
      }
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
  windDirectionRad: number,
  bodyAngleRad: number,
): { omegaRadS: number; torque: TorqueState; constraintTorqueNm: number } {
  const maximumOmega = rpmToAngularVelocity(model.maximumRpm);
  if (maximumOmega <= 0) {
    const torque = torqueAt(model, 0, structureWindSpeedMS, windDirectionRad, bodyAngleRad);
    return { omegaRadS: 0, torque, constraintTorqueNm: -torque.netNm };
  }
  const residual = (candidate: number): number => candidate - startOmegaRadS
    - deltaSeconds * torqueAt(
      model, candidate, structureWindSpeedMS, windDirectionRad, bodyAngleRad,
    ).netNm / model.inertiaKgM2;
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
  const torque = torqueAt(
    model, omegaRadS, structureWindSpeedMS, windDirectionRad, bodyAngleRad,
  );
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
    projectedAreaIntegralM2Seconds: 0,
    forceRadiusIntegralMSeconds: 0,
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
  const referenceArea = rotor.referenceProjectedAreaM2
    ?? model.torqueModel.referenceProjectedAreaM2;
  const referenceRadius = rotor.referenceRadiusM
    ?? model.torqueModel.referenceRadiusM;
  if (!(referenceArea !== undefined && referenceArea > 0)) {
    reasons.push("auxiliary-CQ-reference-area-missing");
  }
  if (!(referenceRadius !== undefined && referenceRadius > 0)) {
    reasons.push("auxiliary-CQ-reference-radius-missing");
  }
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
  const initialAngleRad = input.initialAngleRad ?? 0;
  if (!Number.isFinite(initialAngleRad)) throw new RangeError("initialAngleRad must be finite");
  for (const [index, point] of input.weather.entries()) {
    if (!Number.isFinite(point.timeUtcMs)) {
      throw new RangeError(`weather[${index}].timeUtcMs must be finite`);
    }
    if (!Number.isFinite(point.windSpeedMs) || point.windSpeedMs < 0) {
      throw new RangeError(`weather[${index}].windSpeedMs must be finite and nonnegative`);
    }
    if (!Number.isFinite(point.windDirectionDeg)) {
      throw new RangeError(`weather[${index}].windDirectionDeg must be finite`);
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
  const instantaneousAngleRadByWeatherStep = Array<number>(input.weather.length).fill(0);
  let omegaRadS = rpmToAngularVelocity(initialRpm);
  instantaneousRpmByWeatherStep[0] = initialRpm;
  let bodyAngleRad = wrapRadians(initialAngleRad);
  let totalDynamicBalanceResidualNmS = 0;
  instantaneousAngleRadByWeatherStep[0] = bodyAngleRad;
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
    const intervalStartAngleRad = bodyAngleRad;
    let omegaIntegralRad = 0;
    let referenceWindIntegral = 0;
    let structureWindIntegral = 0;
    let aerodynamicImpulseNmS = 0;
    let lossImpulseNmS = 0;
    let projectedAreaIntegral = 0;
    let forceRadiusIntegral = 0;
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
      const directionDeltaDeg = (
        (endWeather.windDirectionDeg - startWeather.windDirectionDeg + 540) % 360
      ) - 180;
      const windDirectionRad = (
        startWeather.windDirectionDeg + directionDeltaDeg * fraction
      ) * Math.PI / 180;
      const structureWindSpeedMS = structureWindSpeed(input.model, referenceWindSpeedMS);
      const startOmegaRadS = omegaRadS;
      const solved = backwardEulerOmega(
        input.model,
        startOmegaRadS,
        structureWindSpeedMS,
        deltaSeconds,
        windDirectionRad,
        bodyAngleRad,
      );
      omegaRadS = solved.omegaRadS;
      const meanOmegaRadS = 0.5 * (startOmegaRadS + omegaRadS);
      const omegaSubstepIntegralRad = meanOmegaRadS * deltaSeconds;
      const absoluteOmegaSubstepIntegralRad = 0.5
        * (Math.abs(startOmegaRadS) + Math.abs(omegaRadS))
        * deltaSeconds;
      bodyAngleRad = wrapRadians(bodyAngleRad + omegaSubstepIntegralRad);
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
      month.projectedAreaIntegralM2Seconds += solved.torque.projectedAreaM2 * deltaSeconds;
      month.forceRadiusIntegralMSeconds += solved.torque.forceApplicationRadiusM * deltaSeconds;
      referenceWindIntegral += referenceWindSpeedMS * deltaSeconds;
      structureWindIntegral += structureWindSpeedMS * deltaSeconds;
      aerodynamicImpulseNmS += aerodynamicImpulse;
      lossImpulseNmS += lossImpulse;
      constraintImpulseNmS += constraintImpulse;
      projectedAreaIntegral += solved.torque.projectedAreaM2 * deltaSeconds;
      forceRadiusIntegral += solved.torque.forceApplicationRadiusM * deltaSeconds;
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
      startAngleRad: intervalStartAngleRad,
      endAngleRad: bodyAngleRad,
      meanProjectedAreaM2: projectedAreaIntegral / intervalDurationSeconds,
      meanForceApplicationRadiusM: forceRadiusIntegral / intervalDurationSeconds,
      substeps: intervalSubsteps,
    });
    rpmByWeatherStep[intervalIndex] = meanRpm;
    instantaneousRpmByWeatherStep[intervalIndex + 1] = endRpm;
    instantaneousAngleRadByWeatherStep[intervalIndex + 1] = bodyAngleRad;
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
  const prefixPhaseRad = intervals.reduce((sum, interval) =>
    sum + rpmToAngularVelocity(interval.meanRpm) * interval.durationSeconds, initialAngleRad);
  const phaseScheduleClosureRad = Math.atan2(Math.sin(prefixPhaseRad - bodyAngleRad), Math.cos(prefixPhaseRad - bodyAngleRad));

  return {
    shape: input.model.shape,
    intervals,
    rpmByWeatherStep,
    instantaneousRpmByWeatherStep,
    months,
    instantaneousAngleRadByWeatherStep,
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
      timeWeightedMeanProjectedAreaM2: totalSeconds > 0
        ? intervals.reduce((sum, interval) => sum + interval.meanProjectedAreaM2 * interval.durationSeconds, 0) / totalSeconds
        : 0,
      timeWeightedMeanForceApplicationRadiusM: totalSeconds > 0
        ? intervals.reduce((sum, interval) => sum + interval.meanForceApplicationRadiusM * interval.durationSeconds, 0) / totalSeconds
        : 0,
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
      directionalProjectedGeometry: input.model.directionalAerodynamics !== undefined,
      directionalGeometryDefinition: input.model.directionalAerodynamics?.definition
        ?? "constant A_projected and R_ref",
      torqueCoefficientReference: input.model.torqueModel === undefined
        ? "absent"
        : aerodynamicReferenceAt(input.model, 0, 0).kind,
      rotationScheduleDefinition: "interval-time-mean-rpm; prefix-phase equals integrated omega",
      phaseScheduleClosureRad,
    },
  };
}
