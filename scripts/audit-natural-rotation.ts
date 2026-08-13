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
    cylinderHeightM: maximumHeightM,
    coneHeightM: maximumHeightM,
    planeTiltDeg: 30,
    footprintMode: "swept",
    groundClearanceM: 0.01,
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
    massKg,
  });
  return {
    shape,
    projectedAreaM2: analytic.projectedAreaM2,
    forceApplicationRadiusM: analytic.forceApplicationRadiusM,
    inertiaKgM2: analytic.inertiaKgM2,
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
        // The fair auxiliary-rotor geometry is intentionally absent, so this
        // sensitivity is computed but excluded from the official ranking.
        kind: "auxiliary-rotor" as const,
        label: "unverified asymmetric rotor sensitivity",
        provenance: userSource,
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
    finalRpm: history.annual.finalRpm,
    integratedHours: history.annual.integratedHours,
    maximumDynamicBalanceResidualNmS: history.annual.maximumAbsoluteDynamicBalanceResidualNmS,
    torqueCoefficientInput: history.audit.torqueCoefficientInput,
    confidence: history.audit.confidence,
    officialComparisonEligible: history.audit.officialComparisonEligible,
    exclusionReasons: history.audit.exclusionReasons,
    parameterSources: history.audit.parameterSources,
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

const report = {
  schemaVersion: 1,
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
    windElectricityIncluded: false,
  },
  officialNoCq,
  unverifiedUserCqSensitivity,
};
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const table = (rows: typeof officialNoCq) => [
  "| Shape | A_projected (m2) | I_y (kg m2) | Annual RPM | C_Q input | Confidence | Official |",
  "|---|---:|---:|---:|---|---|---|",
  ...rows.map((row) => `| ${row.shape} | ${row.projectedAreaM2.toFixed(6)} | ${row.inertiaKgM2.toFixed(8)} | ${row.annualTimeWeightedMeanRpm.toFixed(6)} | ${row.torqueCoefficientInput} | ${row.confidence} | ${row.officialComparisonEligible ? "yes" : "no"} |`),
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
  "This sensitivity omits a fair auxiliary rotor footprint, complete height, and PV-shadow model. It is deliberately excluded from the official ranking and is not a prediction.",
  "",
].join("\n");
writeFileSync(markdownPath, markdown, "utf8");
console.log(JSON.stringify({ jsonPath, markdownPath, officialNoCq, unverifiedUserCqSensitivity }));
