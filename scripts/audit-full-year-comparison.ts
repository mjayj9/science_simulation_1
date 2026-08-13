import { writeFileSync } from "node:fs";
import {
  commonMaximumHeightM,
  createComparisonSurface,
  type ComparisonShapeKind,
} from "../src/lib/geometry/index";
import {
  DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER,
  DEFAULT_THERMAL,
  deriveAnalyticShapeRotationParameters,
  integrateNaturalRotationHistory,
  type NaturalRotationShapeModel,
} from "../src/lib/physics/index";
import { getOfflineWeather } from "../src/lib/weather/index";
import {
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  type SimulationContinuousSurfaceElectricalModel,
  type SimulationKernelInput,
  type SimulationVariantWorkItem,
} from "../src/workers/index";

const jsonPath = process.argv[3] ?? "docs/full-year-comparison-audit-2026.json";
const markdownPath = process.argv[4] ?? "docs/full-year-comparison-audit-2026.md";
const year = 2025;
const landAreaM2 = 0.05;
const maximumHeightM = commonMaximumHeightM(landAreaM2);
const fixedRpm = 2;
const offsetMinutes = 540;
const offsetMs = offsetMinutes * 60_000;
const location = { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 };
const shapes: readonly ComparisonShapeKind[] = [
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
];
const weather = getOfflineWeather({
  ...location,
  start: Date.UTC(year, 0, 1) - offsetMs,
  end: Date.UTC(year + 1, 0, 1) - offsetMs,
  stepMinutes: 60,
  seed: "full-year-fair-comparison-2025",
  offlinePreset: "partly-cloudy",
}, { now: new Date(0) });
const electrical = {
  ...DEFAULT_ELECTRICAL,
  efficiency: 0.2,
  pmaxW: DEFAULT_ELECTRICAL.areaM2 * 0.2 * DEFAULT_ELECTRICAL.referenceIrradianceWm2,
  gammaPmpPerC: -0.004,
  cellsInSeries: 1,
};
const inverter = {
  ...DEFAULT_INVERTER,
  ratedAcPowerW: 100,
  nominalEfficiency: 0.96,
  mpptMinVoltageV: 0.1,
  mpptMaxVoltageV: 100,
  maxDcVoltageV: 500,
  maxInputCurrentA: 100,
  startPowerW: 0,
  nightConsumptionW: 0,
  standbyConsumptionW: 0,
  wiringLossFraction: 0.015,
};
const surfaces = Object.fromEntries(shapes.map((shape) => [shape, createComparisonSurface(shape, {
  landAreaM2,
  maxHeightM: maximumHeightM,
  cylinderHeightM: maximumHeightM,
  coneHeightM: maximumHeightM,
  planeTiltDeg: 30,
  planeAzimuthDeg: 180,
  footprintMode: "swept",
  groundClearanceM: 0.01,
  maximumActiveAreaM2: 100_000,
  maximumAspectRatio: 4,
  azimuthSamples: 16,
  meridionalSegments: 4,
})]));

function noCqSchedule(shape: ComparisonShapeKind): number[] {
  const surface = surfaces[shape];
  const dimensions = surface.comparison.dimensions;
  const analytic = deriveAnalyticShapeRotationParameters({
    shape,
    widthM: dimensions.widthM,
    depthM: dimensions.depthM,
    heightM: dimensions.heightM,
    radiusM: dimensions.radiusM,
    massKg: surface.comparison.activeAreaM2 * 12,
  });
  const userSource = {
    source: "user" as const,
    reference: "audit friction/inertia sensitivity; C_Q absent",
    confidence: "low" as const,
  };
  const model: NaturalRotationShapeModel = {
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
    sources: { ...analytic.sources, frictionAndDrag: userSource },
  };
  const history = integrateNaturalRotationHistory({
    weather: weather.points,
    model,
    timezoneOffsetMinutes: offsetMinutes,
    initialRpm: 0,
    maximumSubstepSeconds: 3_600,
    finalPointIsClosingEndpoint: true,
  });
  if (history.annual.timeWeightedMeanRpm !== 0) throw new Error(`${shape}: no-C_Q RPM is nonzero.`);
  return history.rpmByWeatherStep;
}

type RotationMode = "static" | "fixed" | "natural";
type ElectricalMode = SimulationContinuousSurfaceElectricalModel;

function variant(
  shape: ComparisonShapeKind,
  rotationMode: RotationMode,
  electricalModel: ElectricalMode,
): SimulationVariantWorkItem {
  const surface = surfaces[shape];
  const id = `${rotationMode}:${electricalModel}:${shape}`;
  return {
    variantId: id,
    referenceEfficiency: electrical.efficiency,
    continuousSurface: createContinuousSurfaceWorkItem(surface, {
      landAreaM2,
      meshVersion: "full-year-audit-m4-a16",
      ...(shape === "plane" ? { tiltDeg: 30 } : {}),
      surfaceOptions: {
        albedo: 0.2,
        iam: { model: "ashrae", b0: 0.05 },
        diffuseModel: "hay-davies",
        soilingLossFraction: 0.02,
      },
      ...(electricalModel === "explicit-series-parallel-bypass" ? {
        electricalModel,
        engineeringConnection: {
          nominalCellAreaM2: 0.01,
          parallelStrings: 2,
          cellsPerBypassSubstring: 5,
          bypassForwardVoltageV: 0.5,
          stringWiringResistanceOhm: 0.02,
          arrayWiringResistanceOhm: 0.01,
          cellIvModel: "piecewise-nameplate",
          circuitSamples: 128,
        },
      } : { electricalModel }),
    }),
    electrical: { mode: "simple", config: electrical },
    inverter,
    rotation: rotationMode === "static"
      ? { mode: "static", angleRad: 0 }
      : rotationMode === "fixed"
        ? { mode: "fixed", rpm: fixedRpm, initialAngleRad: 0, referenceTimestamp: weather.points[0].timeUtcMs }
        : { mode: "fixed", rpm: 0, initialAngleRad: 0 },
    ...(rotationMode === "natural" ? { rotationRpmByWeatherStep: noCqSchedule(shape) } : {}),
    rotationPhaseSamples: rotationMode === "fixed" ? 8 : 1,
  };
}

async function runGroup(rotationMode: RotationMode, electricalModel: ElectricalMode) {
  const variants = shapes.map((shape) => variant(shape, rotationMode, electricalModel));
  const input: SimulationKernelInput = {
    variants,
    weather: weather.points,
    physics: {
      location,
      weather: { referenceWindHeightM: 10, roughnessLengthM: 0.03, displacementHeightM: 0 },
      electrical: { mode: "simple", config: electrical },
      thermal: DEFAULT_THERMAL,
      inverter,
      panelDefaults: {
        albedo: 0.2,
        iam: { model: "ashrae", b0: 0.05 },
        diffuseModel: "hay-davies",
        soilingLossFraction: 0.02,
      },
    },
    mode: "annual",
    chunkSize: 744,
    maximumGapHours: 2,
    reportingOffsetMinutes: offsetMinutes,
  };
  const request = createSimulationRunRequest(`full-year-${rotationMode}-${electricalModel}`, input);
  const result = await runSimulationKernel(request, { yieldControl: async () => undefined });
  if (result.steps !== 8_761 || result.intervals !== 8_760 || result.durationHours !== 8_760) {
    throw new Error(`${rotationMode}/${electricalModel}: incomplete annual clock.`);
  }
  return shapes.map((shape) => {
    const id = `${rotationMode}:${electricalModel}:${shape}`;
    const activeAreaM2 = surfaces[shape].comparison.activeAreaM2;
    const acKWh = result.acEnergyWhByVariant[id] / 1_000;
    return {
      shape,
      landAreaM2,
      heightM: surfaces[shape].comparison.dimensions.heightM,
      activePvAreaM2: activeAreaM2,
      pvLandRatio: activeAreaM2 / landAreaM2,
      acKWhYear: acKWh,
      kWhPerLandM2Year: acKWh / landAreaM2,
      kWhPerPvM2Year: acKWh / activeAreaM2,
      electricalModel,
      thermalModel: result.thermalModelMetadataByVariant[id].labelKo,
      rotationModel: rotationMode === "static"
        ? "static 0 RPM"
        : rotationMode === "fixed"
          ? `controlled common ${fixedRpm} RPM`
          : "shape dynamics; no C_Q; time-weighted 0 RPM",
      weatherSource: `${weather.provenance.provider}/${weather.provenance.kind}`,
      timeResolution: "60 min; actual 8760 intervals + closing endpoint",
      requestFingerprint: request.fingerprint,
    };
  }).sort((left, right) => right.kWhPerLandM2Year - left.kWhPerLandM2Year);
}

const groups = [] as Array<{
  rotationMode: RotationMode;
  electricalModel: ElectricalMode;
  rows: Awaited<ReturnType<typeof runGroup>>;
}>;
for (const rotationMode of ["static", "fixed", "natural"] as const) {
  for (const electricalModel of ["local-mpp-area-integral", "explicit-series-parallel-bypass"] as const) {
    groups.push({ rotationMode, electricalModel, rows: await runGroup(rotationMode, electricalModel) });
  }
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  conditions: {
    year,
    landAreaM2,
    maximumHeightM,
    planeTiltDeg: 30,
    reflector: "none",
    albedo: 0.2,
    obstacles: "none",
    fixedRpm,
    naturalCq: "absent; symmetric shapes default to 0 RPM",
    weatherPoints: weather.points.length,
    intervals: weather.points.length - 1,
    durationHours: 8_760,
    integration: "actual hourly full-year worker, not representative-day scaling",
  },
  groups,
};
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const sections = groups.flatMap((group) => [
  `## ${group.rotationMode} / ${group.electricalModel}`,
  "",
  "| Rank | Shape | A_land | A_PV | A_PV/A_land | AC kWh/year | kWh/m2-land/year | kWh/m2-PV/year | Thermal | Rotation |",
  "|---:|---|---:|---:|---:|---:|---:|---:|---|---|",
  ...group.rows.map((row, index) => `| ${index + 1} | ${row.shape} | ${row.landAreaM2.toFixed(4)} | ${row.activePvAreaM2.toFixed(4)} | ${row.pvLandRatio.toFixed(3)} | ${row.acKWhYear.toFixed(6)} | ${row.kWhPerLandM2Year.toFixed(6)} | ${row.kWhPerPvM2Year.toFixed(6)} | ${row.thermalModel} | ${row.rotationModel} |`),
  "",
]);
writeFileSync(markdownPath, [
  "# Actual full-year fair-comparison audit",
  "",
  "All ranks below use 8,760 actual hourly intervals plus the non-integrated closing endpoint. No representative-day scaling or shape output multiplier is used.",
  "",
  ...sections,
].join("\n"), "utf8");
console.log(JSON.stringify({ jsonPath, markdownPath, groupCount: groups.length, groups }));
