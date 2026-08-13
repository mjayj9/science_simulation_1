import { writeFileSync } from "node:fs";
import {
  MAX_COMPARISON_PLANE_TILT_DEG,
  commonMaximumHeightM,
  createComparisonSurface,
  type ComparisonShapeKind,
} from "../src/lib/geometry/index";
import {
  DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER,
  DEFAULT_THERMAL,
} from "../src/lib/physics/index";
import { optimizeWeatherDrivenAnnualPlaneTilt } from "../src/lib/compare/index";
import { getOfflineWeather } from "../src/lib/weather/index";
import {
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  type SimulationKernelInput,
} from "../src/workers/index";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Usage: audit-fair-comparison.ts <output.json>");

const YEAR = 2026;
const LAND_AREA_M2 = 0.05;
const HEIGHT_M = commonMaximumHeightM(LAND_AREA_M2);
const LOCATION = { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 };
const OFFSET_MS = 9 * 3_600_000;
const START_MS = Date.UTC(YEAR, 0, 1) - OFFSET_MS;
const END_MS = Date.UTC(YEAR + 1, 0, 1) - OFFSET_MS;
const SHAPES: readonly ComparisonShapeKind[] = [
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
];
const weather = getOfflineWeather({
  ...LOCATION,
  start: START_MS,
  end: END_MS,
  stepMinutes: 60,
  seed: "240521",
  offlinePreset: "clear",
}, { now: new Date(0) });

const electrical = {
  ...DEFAULT_ELECTRICAL,
  efficiency: 0.2,
  idealityFactor: 1.2,
  alphaIscAperC: 0.0005,
};
const inverter = {
  ...DEFAULT_INVERTER,
  nominalEfficiency: 0.96,
  mpptMinVoltageV: 0.3,
  mpptMaxVoltageV: 20,
  maxDcVoltageV: 1_200,
  maxInputCurrentA: 25,
  wiringLossFraction: 0.015,
};
const planeTilt = optimizeWeatherDrivenAnnualPlaneTilt({
  weather: weather.points,
  location: LOCATION,
  landAreaM2: LAND_AREA_M2,
  maximumHeightM: HEIGHT_M,
  supportHeightM: 0,
  planeAzimuthDeg: 180,
  optics: {
    albedo: 0.2,
    iam: { model: "ashrae", b0: 0.05 },
    soilingLossFraction: 0.02,
    diffuseModel: "hay-davies",
  },
  electrical,
  thermal: DEFAULT_THERMAL,
  inverter,
  maximumTiltDeg: MAX_COMPARISON_PLANE_TILT_DEG,
  coarseStepDeg: 5,
  toleranceDeg: 0.01,
});

const surfaces = Object.fromEntries(SHAPES.map((shape) => [shape, createComparisonSurface(shape, {
  landAreaM2: LAND_AREA_M2,
  maxHeightM: HEIGHT_M,
  cylinderHeightM: HEIGHT_M,
  coneHeightM: HEIGHT_M,
  planeTiltDeg: planeTilt.tiltDeg,
  planeAzimuthDeg: 180,
  footprintMode: "static",
  groundClearanceM: 0.01,
  maximumActiveAreaM2: 100_000,
  maximumAspectRatio: 4,
  azimuthSamples: 32,
  meridionalSegments: 8,
})]));

function variantFor(shape: ComparisonShapeKind) {
  const surface = surfaces[shape];
  return {
      variantId: shape,
      referenceEfficiency: 0.2,
      continuousSurface: createContinuousSurfaceWorkItem(surface, {
        landAreaM2: LAND_AREA_M2,
        meshVersion: `fair-audit-m8-a32`,
        ...(shape === "plane" ? { tiltDeg: planeTilt.tiltDeg } : {}),
        surfaceOptions: {
          albedo: 0.2,
          iam: { model: "ashrae" as const, b0: 0.05 },
          diffuseModel: "hay-davies" as const,
          soilingLossFraction: 0.02,
        },
      }),
      electrical: { mode: "simple" as const, config: electrical },
      inverter,
      rotation: { mode: "static" as const, angleRad: 0 },
      rotationPhaseSamples: 1,
    };
}
function inputFor(shape: ComparisonShapeKind, month: number): SimulationKernelInput {
  const localStart = Date.UTC(YEAR, month, 14, 15);
  const localEnd = localStart + 24 * 3_600_000;
  return {
  variants: [variantFor(shape)],
  // Representative monthly clear days provide a fast, deterministic annual
  // audit. The production UI offers a separate full-hour worker path.
  weather: getOfflineWeather({
      ...LOCATION,
      start: localStart,
      end: localEnd,
      stepMinutes: 60,
      seed: `240521-audit-${month + 1}`,
      offlinePreset: "clear",
    }, { now: new Date(0) }).points,
  physics: {
    location: LOCATION,
    weather: {
      referenceWindHeightM: 10,
      roughnessLengthM: 0.03,
      displacementHeightM: 0,
    },
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
  mode: "time-series",
  chunkSize: 168,
  maximumGapHours: 2,
  reportingOffsetMinutes: 540,
};
}
const temperatureSums = Object.fromEntries(SHAPES.map((shape) => [shape, 0]));
const temperatureCounts = Object.fromEntries(SHAPES.map((shape) => [shape, 0]));
const temperatureMaximum = Object.fromEntries(SHAPES.map((shape) => [shape, -Infinity]));
const annualWhByShape = Object.fromEntries(SHAPES.map((shape) => [shape, 0]));
const cylinderRegions: Record<string, { dcEnergyWh: number; acEnergyWh: number }> = {};
const requestFingerprints: Record<string, string[]> = {};
for (const shape of SHAPES) {
  requestFingerprints[shape] = [];
  for (let month = 0; month < 12; month += 1) {
    let monthlyTemperatureSum = 0;
    let monthlyTemperatureCount = 0;
    const request = createSimulationRunRequest(`fair-comparison-audit-${shape}-${month + 1}`, inputFor(shape, month));
    requestFingerprints[shape].push(request.fingerprint);
    const result = await runSimulationKernel(request, {
      onChunk: (chunk) => {
        for (const row of chunk.rows) {
          const temperatureC = row.moduleTemperatureCByVariant[shape];
          monthlyTemperatureSum += temperatureC;
          monthlyTemperatureCount += 1;
          temperatureMaximum[shape] = Math.max(temperatureMaximum[shape], temperatureC);
        }
      },
      yieldControl: async () => undefined,
    });
    const days = new Date(Date.UTC(YEAR, month + 1, 0)).getUTCDate();
    temperatureSums[shape] += monthlyTemperatureSum * days;
    temperatureCounts[shape] += monthlyTemperatureCount * days;
    annualWhByShape[shape] += result.acEnergyWhByVariant[shape] * days;
    if (shape === "cylinder") {
      for (const [regionId, energy] of Object.entries(result.surfaceRegionEnergyWhByVariant.cylinder)) {
        const total = cylinderRegions[regionId] ??= { dcEnergyWh: 0, acEnergyWh: 0 };
        total.dcEnergyWh += energy.dcEnergyWh * days;
        total.acEnergyWh += energy.acEnergyWh * days;
      }
    }
  }
}

const rows = SHAPES.map((shape) => {
  const surface = surfaces[shape];
  const annualWh = annualWhByShape[shape];
  const annualKWh = annualWh / 1_000;
  return {
    shape,
    landAreaM2: surface.comparison.landAreaM2,
    footprintIndex: surface.comparison.footprintIndex,
    heightM: surface.comparison.dimensions.heightM,
    activeAreaM2: surface.comparison.activeAreaM2,
    pvLandRatio: surface.comparison.activeAreaM2 / surface.comparison.landAreaM2,
    annualAcKWh: annualKWh,
    kWhPerLandM2: annualKWh / surface.comparison.landAreaM2,
    kWhPerPvM2: annualKWh / surface.comparison.activeAreaM2,
    averageSurfaceTemperatureC: temperatureSums[shape] / temperatureCounts[shape],
    maximumSurfaceTemperatureC: temperatureMaximum[shape],
  };
});
writeFileSync(outputPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  requestFingerprints,
  conditions: {
    year: YEAR,
    landAreaM2: LAND_AREA_M2,
    maximumHeightM: HEIGHT_M,
    planeTiltDeg: planeTilt.tiltDeg,
    planeTiltMethod: planeTilt.method,
    planeTiltObjective: "annual inverter AC after POA, Faiman temperature and temperature-adjusted DC",
    rotation: "static",
    rpm: 0,
    reflector: "none",
    albedo: 0.2,
    obstacles: "none",
    weatherProvider: weather.provenance.provider,
    weatherKind: `${weather.provenance.kind}; 12 representative days for report audit`,
    representativeDatesLocal: Array.from({ length: 12 }, (_, month) => `${YEAR}-${String(month + 1).padStart(2, "0")}-15`),
    optimizationWeatherSeed: "240521",
    auditWeatherSeeds: "240521-audit-{1..12}",
    thermalModel: "Faiman steady-state in representative-day time-series kernel",
  },
  rows,
  cylinderRegions,
  tests: {
    absoluteAndLandRankIdentical: [...rows].sort((a, b) => b.annualAcKWh - a.annualAcKWh)
      .map((row) => row.shape).join(",") === [...rows].sort((a, b) => b.kWhPerLandM2 - a.kWhPerLandM2)
      .map((row) => row.shape).join(","),
  },
}, null, 2));
console.log(JSON.stringify(rows));
