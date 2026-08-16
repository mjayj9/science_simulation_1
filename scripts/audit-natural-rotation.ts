import { writeFileSync } from "node:fs";
import {
  commonMaximumHeightM,
  createComparisonSurface,
  type ComparisonShapeKind,
} from "../src/lib/geometry/index";
import {
  deriveAnalyticShapeRotationParameters,
  integrateNaturalRotationHistory,
  type NaturalRotationShapeModel,
} from "../src/lib/physics/index";
import { getOfflineWeather } from "../src/lib/weather/index";

const jsonPath = process.argv[3] ?? "docs/natural-rotation-audit-2026.json";
const markdownPath = process.argv[4] ?? "docs/natural-rotation-audit-2026.md";
const year = 2025;
const landAreaM2 = 0.05;
const maximumHeightM = commonMaximumHeightM(landAreaM2);
const groundClearanceM = 0;
const location = { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 };
const offsetMinutes = 540;
const offsetMs = offsetMinutes * 60_000;
const weather = getOfflineWeather({
  ...location,
  start: Date.UTC(year, 0, 1) - offsetMs,
  end: Date.UTC(year + 1, 0, 1) - offsetMs,
  stepMinutes: 60,
  seed: "natural-rotation-audit-2025",
  offlinePreset: "partly-cloudy",
}, { now: new Date(0) });
const shapes: readonly ComparisonShapeKind[] = [
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
];
const userSource = {
  source: "user" as const,
  reference: "audit sensitivity assumption; not measured or literature-derived",
  confidence: "low" as const,
};

function shapeModel(shape: ComparisonShapeKind, withUserTorque: boolean): NaturalRotationShapeModel {
  const surface = createComparisonSurface(shape, {
    landAreaM2,
    maxHeightM: maximumHeightM,
    cylinderHeightM: maximumHeightM - groundClearanceM,
    coneHeightM: maximumHeightM - groundClearanceM,
    planeTiltDeg: 30,
    footprintMode: "swept",
    groundClearanceM,
    maximumActiveAreaM2: 100_000,
    maximumAspectRatio: 4,
    azimuthSamples: 16,
    meridionalSegments: 4,
  });
  const dimensions = surface.comparison.dimensions;
  const massKg = surface.comparison.activeAreaM2 * 12;
  const analytic = deriveAnalyticShapeRotationParameters({
    shape,
    widthM: dimensions.widthM,
    depthM: dimensions.depthM,
    heightM: dimensions.heightM,
    radiusM: dimensions.radiusM,
    planeTiltDeg: dimensions.planeTiltDeg,
    planeAzimuthDeg: dimensions.planeAzimuthDeg,
    planeSlantLengthM: dimensions.planeSlantLengthM,
    massKg,
  });
  return {
    shape,
    projectedAreaM2: analytic.projectedAreaM2,
    forceApplicationRadiusM: analytic.forceApplicationRadiusM,
    inertiaKgM2: analytic.inertiaKgM2,
    directionalAerodynamics: analytic.directionalAerodynamics,
    structureCentreHeightM: Math.max(0.01, surface.dimensions.centreY),
    referenceHeightM: 10,
    maximumRpm: 30,
    staticFrictionNm: 0.002,
    bearingViscousNmPerRadS: 0.01,
    airDragNmPerRadS2: 0.001,
    airDensityKgM3: 1.225,
    windProfile: { model: "power", exponent: 0.16 },
    ...(withUserTorque ? {
      torqueModel: {
        kind: "auxiliary-rotor" as const,
        label: "unverified auxiliary rotor; C_Q(lambda)=0.12*max(0,1-lambda/3)",
        provenance: userSource,
        auxiliaryRotor: {
          referenceProjectedAreaM2: 0.01, referenceRadiusM: 0.06,
          footprintAreaM2: Math.PI * 0.06 ** 2, assemblyHeightM: maximumHeightM,
          shadowLossFraction: 0.02,
          footprintIncludedInLandConstraint: false,
          heightIncludedInCommonEnvelope: false,
          shadowIncludedInPvYield: false,
        },
        torqueCoefficient: (tipSpeedRatio: number) => 0.12 * Math.max(0, 1 - tipSpeedRatio / 3),
      },
    } : {}),
    sources: {
      ...analytic.sources,
      frictionAndDrag: userSource,
    },
  };
}

function run(shape: ComparisonShapeKind, withUserTorque: boolean) {
  const model = shapeModel(shape, withUserTorque);
  const history = integrateNaturalRotationHistory({
    weather: weather.points,
    model,
    timezoneOffsetMinutes: offsetMinutes,
    initialRpm: 0,
    maximumSubstepSeconds: withUserTorque ? 900 : 3_600,
    finalPointIsClosingEndpoint: true,
  });
  return {
    shape,
    projectedAreaM2: model.projectedAreaM2,
    forceApplicationRadiusM: model.forceApplicationRadiusM,
    inertiaKgM2: model.inertiaKgM2,
    annualTimeWeightedMeanRpm: history.annual.timeWeightedMeanRpm,
    timeWeightedProjectedAreaM2: history.annual.timeWeightedMeanProjectedAreaM2,
    timeWeightedForceRadiusM: history.annual.timeWeightedMeanForceApplicationRadiusM,
    finalRpm: history.annual.finalRpm,
    integratedHours: history.annual.integratedHours,
    maximumDynamicBalanceResidualNmS: history.annual.maximumAbsoluteDynamicBalanceResidualNmS,
    torqueCoefficientInput: history.audit.torqueCoefficientInput,
    confidence: history.audit.confidence,
    officialComparisonEligible: history.audit.officialComparisonEligible,
    exclusionReasons: history.audit.exclusionReasons,
    parameterSources: history.audit.parameterSources,
    directionalGeometryDefinition: history.audit.directionalGeometryDefinition,
    torqueCoefficientReference: history.audit.torqueCoefficientReference,
    rotationScheduleDefinition: history.audit.rotationScheduleDefinition,
    phaseScheduleClosureRad: history.audit.phaseScheduleClosureRad,
    months: history.months,
  };
}

const officialNoCq = shapes.map((shape) => run(shape, false));
const unverifiedUserCqSensitivity = shapes.map((shape) => run(shape, true));
if (officialNoCq.some((row) => row.annualTimeWeightedMeanRpm !== 0)) {
  throw new Error("A symmetric shape without C_Q must remain at zero natural RPM.");
}
if (officialNoCq.some((row) => row.integratedHours !== 8_760)) {
  throw new Error("Natural-rotation audit did not integrate all 8,760 intervals.");
}
if (unverifiedUserCqSensitivity.some((row) => row.officialComparisonEligible)) {
  throw new Error("Unverified auxiliary-rotor sensitivity must be excluded from official ranking.");
}
if ([...officialNoCq, ...unverifiedUserCqSensitivity].some((row) => Math.abs(row.phaseScheduleClosureRad) > 1e-9)) {
  throw new Error("Interval-mean RPM schedule does not close the integrated body phase.");
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  conditions: {
    year,
    landAreaM2,
    maximumHeightM,
    weatherSource: `${weather.provenance.provider}/${weather.provenance.kind}`,
    weatherSeed: "natural-rotation-audit-2025",
    timeResolutionMinutes: 60,
    weatherPoints: weather.points.length,
    intervals: weather.points.length - 1,
    equation: "I*domega/dt=tau_aero(V,omega,shape)-tau_loss(omega)",
    integration: "backward Euler at every weather interval; time-weighted monthly/annual RPM",
    windDirection: "shortest-arc interpolation; A_projected and R_ref evaluated from wind azimuth minus body yaw",
    inertia: "uniform PV thin-skin mass distribution; no solid-volume body assumption",
    cqDefinition: "C_Q=tau/(0.5*rho*V^2*A_ref*R_ref), lambda=omega*R_ref/V",
    windElectricityIncluded: false,
  },
  officialNoCq,
  unverifiedUserCqSensitivity,
};
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const table = (rows: typeof officialNoCq) => [
  "| Shape | mean A_projected (m2) | mean R_ref (m) | thin-skin I_y (kg m2) | Annual RPM | C_Q input | C_Q reference | phase closure (rad) | Official |",
  "|---|---:|---:|---:|---:|---|---|---:|---|",
  ...rows.map((row) => `| ${row.shape} | ${row.timeWeightedProjectedAreaM2.toFixed(6)} | ${row.timeWeightedForceRadiusM.toFixed(6)} | ${row.inertiaKgM2.toFixed(8)} | ${row.annualTimeWeightedMeanRpm.toFixed(6)} | ${row.torqueCoefficientInput} | ${row.torqueCoefficientReference} | ${row.phaseScheduleClosureRad.toExponential(3)} | ${row.officialComparisonEligible ? "yes" : "no"} |`),
].join("\n");
const markdown = [
  "# Shape-specific natural-rotation audit",
  "",
  "The official case has no measured or literature C_Q(lambda). All symmetric structures therefore remain at 0 RPM. Wind-generated electricity is excluded.",
  "",
  "## Official no-C_Q case",
  "",
  table(officialNoCq),
  "",
  "## Unverified user-C_Q sensitivity (excluded)",
  "",
  table(unverifiedUserCqSensitivity),
  "",
  "The sensitivity uses explicit auxiliary C_Q A_ref=0.01 m2, R_ref=0.06 m and a stated lambda=3 linear zero. Its footprint, complete height and 2% shadow are not applied to A_land, H_max or PV yield, so it is excluded and is not a prediction.",
  "",
].join("\n");
writeFileSync(markdownPath, markdown, "utf8");
console.log(JSON.stringify({ jsonPath, markdownPath, officialNoCq, unverifiedUserCqSensitivity }));
