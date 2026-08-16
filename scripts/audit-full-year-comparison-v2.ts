import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  commonMaximumHeightM,
  createComparisonSurface,
  type ComparisonFootprintMode,
  type ComparisonShapeKind,
  type ComparisonSurfaceModel,
} from "../src/lib/geometry/index";
import {
  DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER,
  DEFAULT_THERMAL,
  deriveAnalyticShapeRotationParameters,
  motorDrivePowerW,
  integrateNaturalRotationHistory,
  simulateAnnualRotationDecomposition,
  simulateAnnualTransientSurface,
  type AnnualRotationDecompositionResult,
  type NaturalRotationShapeModel,
} from "../src/lib/physics/index";
import { getOfflineWeather, type WeatherPoint } from "../src/lib/weather/index";
import {
  computePhysicsStep,
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  type SimulationContinuousSurfaceElectricalModel,
  type SimulationKernelInput,
  type SimulationPhysicsStepResult,
  type SimulationStepFunction,
  type SimulationVariantWorkItem,
} from "../src/workers/index";
import { computeSourceClosure } from "./source-closure";

const jsonPath = process.argv[3]?.startsWith("--")
  ? "docs/full-year-comparison-audit-2026.json"
  : process.argv[3] ?? "docs/full-year-comparison-audit-2026.json";
const markdownPath = process.argv[4]?.startsWith("--")
  ? "docs/full-year-comparison-audit-2026.md"
  : process.argv[4] ?? "docs/full-year-comparison-audit-2026.md";
const preflightOnly = process.argv.includes("--preflight-only");
const checkpointPath = "docs/.full-year-comparison-audit-checkpoint.json";
const transientOnly = process.argv.includes("--transient-only");
const quasiOnly = process.argv.includes("--quasi-only");
const phaseGateOnly = process.argv.includes("--phase-gate-only");
const requestedShapesArgument = process.argv.find((argument) => argument.startsWith("--shapes="))
  ?.slice("--shapes=".length);
const auditImplementationVersion = 6;
/**
 * Derived, not hand-listed. This audit is the ideal-path baseline the combined
 * transient+engineering audit validates against, so under-covering its
 * provenance would propagate an unprovable baseline into the official ranking.
 * The superseded literal list omitted `solar.ts`, `irradiance.ts`, `circuit.ts`
 * and `inverter.ts`, all of which move these annual numbers.
 */
const implementationSourceFiles = computeSourceClosure({
  entryPoints: ["scripts/audit-full-year-comparison-v2.ts"],
  rootDir: process.cwd(),
  label: "annual.implementation",
});
const implementationFingerprint = createHash("sha256").update(
  implementationSourceFiles
    .slice()
    .sort()
    .map((sourcePath) => `${sourcePath}\0${readFileSync(sourcePath)}`)
    .join("\n"),
).digest("hex");
const year = 2025;
const landAreaM2 = 0.05;
const maximumHeightM = commonMaximumHeightM(landAreaM2);
const fixedRpm = 2;
const groundClearanceM = 0;
const offsetMinutes = 540;
const offsetMs = offsetMinutes * 60_000;
const location = { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 };
interface AuditResolution {
  azimuthSamples: number;
  meridionalSegments: number;
  phaseSamples: number;
  circuitSamples: number;
}
const lowResolution: Readonly<AuditResolution> = Object.freeze({ azimuthSamples: 16, meridionalSegments: 4, phaseSamples: 4, circuitSamples: 32 });
const highResolution: Readonly<AuditResolution> = Object.freeze({ azimuthSamples: 32, meridionalSegments: 8, phaseSamples: 8, circuitSamples: 64 });
const transientResolution = Object.freeze({
  opticalPhaseSamples: 6,
  referenceOpticalPhaseSamples: 8,
  thermalNodeCount: 6,
  maximumSubstepSeconds: 900,
  warmup: Object.freeze({
    periodHours: 24,
    minimumCycles: 2,
    maximumCycles: 8,
    convergenceToleranceC: 0.05,
  }),
});
const convergenceTolerance = Object.freeze({ idealFraction: 0.01, engineeringFraction: 0.02 });
const engineeringSelectedResolution: Readonly<AuditResolution> = Object.freeze({
  azimuthSamples: 64, meridionalSegments: 16, phaseSamples: 4, circuitSamples: 128,
});
const engineeringReferenceResolution: Readonly<AuditResolution> = Object.freeze({
  azimuthSamples: 128, meridionalSegments: 32, phaseSamples: 4, circuitSamples: 128,
});
const transientPhaseTolerance = Object.freeze({
  acEnergyFraction: 0.01,
  averageTemperatureC: 0.1,
});
const representativeSeasonDayOffsets = Object.freeze([19, 109, 201, 293]);
const motorDrive = Object.freeze({
  requiredTorqueNm: 0.002,
  motorEfficiency: 0.85,
  source: "user-assumption for audit; not measured and not fitted",
  confidence: "low",
});
const shapes: readonly ComparisonShapeKind[] = [
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
];
const requestedShapes = requestedShapesArgument === undefined
  ? shapes
  : requestedShapesArgument.split(",").filter((shape) => shape.length > 0);
const invalidRequestedShapes = requestedShapes.filter(
  (shape): shape is string => !shapes.includes(shape as ComparisonShapeKind),
);
if (requestedShapes.length === 0 || invalidRequestedShapes.length > 0) {
  throw new RangeError(`--shapes must be a comma-separated subset of ${shapes.join(",")}; invalid=${invalidRequestedShapes.join(",")}`);
}
const executionShapes = requestedShapes as readonly ComparisonShapeKind[];
const axisymmetricShapes = new Set<ComparisonShapeKind>([
  "cylinder", "sphere", "hemisphere", "cone",
]);
const electricalModes: readonly SimulationContinuousSurfaceElectricalModel[] = [
  "local-mpp-area-integral", "explicit-series-parallel-bypass",
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

function makeSurface(
  shape: ComparisonShapeKind,
  footprintMode: ComparisonFootprintMode,
  resolution = lowResolution,
): ComparisonSurfaceModel {
  const surface = createComparisonSurface(shape, {
    landAreaM2,
    maxHeightM: maximumHeightM,
    cylinderHeightM: maximumHeightM - groundClearanceM,
    coneHeightM: maximumHeightM - groundClearanceM,
    planeTiltDeg: 30,
    planeAzimuthDeg: 180,
    footprintMode,
    groundClearanceM,
    maximumActiveAreaM2: 100_000,
    maximumAspectRatio: 4,
    azimuthSamples: resolution.azimuthSamples,
    meridionalSegments: resolution.meridionalSegments,
  });
  const selected = surface.comparison.footprint.selectedStructureAreaM2;
  if (Math.abs(selected - landAreaM2) > Math.max(1e-10, landAreaM2 * 1e-8)) {
    throw new Error(`${shape}/${footprintMode}: selected footprint ${selected} != ${landAreaM2}`);
  }
  if (surface.dimensions.centreY + surface.comparison.dimensions.heightM / 2 > maximumHeightM + 1e-10) {
    throw new Error(`${shape}/${footprintMode}: height exceeds common H_max.`);
  }
  return surface;
}

const staticSurfaces = Object.fromEntries(shapes.map((shape) => [shape, makeSurface(shape, "static")])) as Record<ComparisonShapeKind, ComparisonSurfaceModel>;
const sweptSurfaces = Object.fromEntries(shapes.map((shape) => [shape, makeSurface(shape, "swept")])) as Record<ComparisonShapeKind, ComparisonSurfaceModel>;

const naturalHistories = Object.fromEntries(shapes.map((shape) => {
  const surface = staticSurfaces[shape];
  const dimensions = surface.comparison.dimensions;
  const analytic = deriveAnalyticShapeRotationParameters({
    shape,
    widthM: Math.max(1e-9, dimensions.widthM),
    depthM: Math.max(1e-9, dimensions.depthM),
    heightM: Math.max(1e-9, dimensions.heightM),
    radiusM: dimensions.radiusM,
    massKg: Math.max(1e-9, surface.comparison.activeAreaM2 * 12),
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
  if (history.rpmByWeatherStep.some((rpm) => rpm !== 0)
    || history.annual.timeWeightedMeanRpm !== 0) {
    throw new Error(`${shape}: symmetric no-C_Q history must remain exactly 0 RPM.`);
  }
  return [shape, history];
})) as Record<ComparisonShapeKind, ReturnType<typeof integrateNaturalRotationHistory>>;

if (process.argv.includes("--natural-only")) {
  console.log(JSON.stringify(Object.fromEntries(shapes.map((shape) => [shape, naturalHistories[shape].annual]))));
  process.exit(0);
}
type GeometryContract = "static-land-matched" | "swept-rotation-envelope";
type RotationContract =
  | "held-static"
  | "controlled-kinematic"
  | "controlled-motor-net"
  | "natural-no-cq";

function buildVariant(args: {
  shape: ComparisonShapeKind;
  surface: ComparisonSurfaceModel;
  electricalModel: SimulationContinuousSurfaceElectricalModel;
  rotation: RotationContract;
  phaseSamples: number;
  circuitSamples: number;
  variantId: string;
  motor?: boolean;
}): SimulationVariantWorkItem {
  const fixed = args.rotation === "controlled-kinematic"
    || args.rotation === "controlled-motor-net";
  const natural = args.rotation === "natural-no-cq";
  return {
    variantId: args.variantId,
    referenceEfficiency: electrical.efficiency,
    continuousSurface: createContinuousSurfaceWorkItem(args.surface, {
      landAreaM2,
      meshVersion: `annual-a${args.surface.azimuthSamples}-m${args.surface.meridionalSegments}`,
      ...(args.shape === "plane" ? { tiltDeg: 30 } : {}),
      surfaceOptions: {
        albedo: 0.2,
        iam: { model: "ashrae", b0: 0.05 },
        diffuseModel: "hay-davies",
        soilingLossFraction: 0.02,
      },
      ...(args.electricalModel === "explicit-series-parallel-bypass" ? {
        electricalModel: args.electricalModel,
        engineeringConnection: {
          nominalCellAreaM2: 0.01,
          parallelStrings: 2,
          cellsPerBypassSubstring: 5,
          bypassForwardVoltageV: 0.5,
          stringWiringResistanceOhm: 0.02,
          arrayWiringResistanceOhm: 0.01,
          cellIvModel: "piecewise-nameplate",
          circuitSamples: args.circuitSamples,
        },
      } : { electricalModel: args.electricalModel }),
    }),
    electrical: { mode: "simple", config: electrical },
    inverter,
    rotation: fixed
      ? { mode: "fixed", rpm: fixedRpm, initialAngleRad: 0, referenceTimestamp: weather.points[0].timeUtcMs }
      : natural
        ? { mode: "fixed", rpm: 0, initialAngleRad: 0 }
        : { mode: "static", angleRad: 0 },
    ...(natural ? { rotationRpmByWeatherStep: naturalHistories[args.shape].rpmByWeatherStep } : {}),
    rotationPhaseSamples: fixed ? args.phaseSamples : 1,
    ...(args.motor ? {
      motorDrive: {
        requiredTorqueNm: motorDrive.requiredTorqueNm,
        motorEfficiency: motorDrive.motorEfficiency,
      },
    } : {}),
  };
}

function kernelInput(variants: SimulationVariantWorkItem[], points: readonly WeatherPoint[]): SimulationKernelInput {
  return {
    variants,
    weather: [...points],
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
}

async function energyFor(
  variant: SimulationVariantWorkItem,
  points: readonly WeatherPoint[],
  requestId: string,
  showProgress = false,
) {
  const request = createSimulationRunRequest(requestId, kernelInput([variant], points));
  let lastDecile = -1;
  const result = await runSimulationKernel(request, {
    yieldControl: async () => undefined,
    ...(showProgress ? {
      onProgress: (event) => {
        const decile = Math.floor(event.fraction * 10);
        if (decile > lastDecile) {
          lastDecile = decile;
          console.log(`[annual-audit] ${requestId} ${Math.min(100, decile * 10)}%`);
        }
      },
    } : {}),
  });
  return { request, result };
}

function runTransientPhaseConvergenceGate() {
  const caseNames = ["e00", "e10", "e01", "e11"] as const;
  type CaseName = (typeof caseNames)[number];
  const shapeResults = [] as Array<Record<string, unknown>>;
  for (const shape of ["plane", "cube"] as const) {
    const byPhase = new Map<number, {
      energyWh: Record<CaseName, number>;
      averageTemperatureCSum: Record<CaseName, number>;
      elapsedMs: number;
    }>();
    for (const phaseSamples of [
      transientResolution.opticalPhaseSamples,
      transientResolution.referenceOpticalPhaseSamples,
    ]) {
      const aggregate = {
        energyWh: { e00: 0, e10: 0, e01: 0, e11: 0 },
        averageTemperatureCSum: { e00: 0, e10: 0, e01: 0, e11: 0 },
        elapsedMs: 0,
      };
      const startedAt = Date.now();
      for (const dayOffset of representativeSeasonDayOffsets) {
        const seasonalWeather = weather.points.slice(dayOffset * 24, dayOffset * 24 + 25);
        if (seasonalWeather.length !== 25) {
          throw new Error(`${shape}: incomplete seasonal transient convergence fixture.`);
        }
        const result = simulateAnnualRotationDecomposition({
          surface: sweptSurfaces[shape],
          weather: seasonalWeather,
          location,
          rpm: fixedRpm,
          referenceEfficiency: electrical.efficiency,
          gammaPerC: electrical.gammaPmpPerC,
          soilingLossFraction: 0.02,
          albedo: 0.2,
          iam: { model: "ashrae", b0: 0.05 },
          diffuseModel: "hay-davies",
          inverter,
          thermalMesh: { targetNodeCount: transientResolution.thermalNodeCount },
          thermalConfig: { ...DEFAULT_THERMAL, maximumSubstepSeconds: transientResolution.maximumSubstepSeconds },
          warmup: transientResolution.warmup,
          opticalPhaseSamples: phaseSamples,
          convectionPhaseSamples: phaseSamples,
          reportingOffsetMinutes: offsetMinutes,
        });
        if (Math.abs(result.annual.closureResidualWh) > 1e-8
          || [result.e00, result.e10, result.e01, result.e11].some((entry) => (
            entry.energyAudit.relativeEnergyResidual > 1e-8 || !entry.warmup.converged
          ))) {
          throw new Error(`${shape}: transient phase convergence fixture failed closure/residual/warm-up checks.`);
        }
        for (const caseName of caseNames) {
          aggregate.energyWh[caseName] += result.annual[`${caseName}Wh`];
          aggregate.averageTemperatureCSum[caseName] += result[caseName].averageTemperatureC;
        }
      }
      aggregate.elapsedMs = Date.now() - startedAt;
      byPhase.set(phaseSamples, aggregate);
      console.log(`[annual-audit] transient phase ${phaseSamples} ${shape} completed in ${(aggregate.elapsedMs / 1_000).toFixed(1)}s`);
    }
    const selected = byPhase.get(transientResolution.opticalPhaseSamples);
    const reference = byPhase.get(transientResolution.referenceOpticalPhaseSamples);
    if (!selected || !reference) throw new Error("Transient phase convergence pair is incomplete.");
    const comparisons = caseNames.map((caseName) => {
      const selectedWh = selected.energyWh[caseName];
      const referenceWh = reference.energyWh[caseName];
      const relativeAcDifference = Math.abs(selectedWh - referenceWh)
        / Math.max(1e-12, Math.abs(referenceWh));
      const selectedAverageTemperatureC = selected.averageTemperatureCSum[caseName]
        / representativeSeasonDayOffsets.length;
      const referenceAverageTemperatureC = reference.averageTemperatureCSum[caseName]
        / representativeSeasonDayOffsets.length;
      const absoluteAverageTemperatureDifferenceC = Math.abs(
        selectedAverageTemperatureC - referenceAverageTemperatureC,
      );
      return {
        caseName,
        selectedWh,
        referenceWh,
        relativeAcDifference,
        selectedAverageTemperatureC,
        referenceAverageTemperatureC,
        absoluteAverageTemperatureDifferenceC,
        pass: relativeAcDifference <= transientPhaseTolerance.acEnergyFraction
          && absoluteAverageTemperatureDifferenceC <= transientPhaseTolerance.averageTemperatureC,
      };
    });
    shapeResults.push({
      shape,
      selectedPhaseSamples: transientResolution.opticalPhaseSamples,
      referencePhaseSamples: transientResolution.referenceOpticalPhaseSamples,
      representativeDayOffsets: representativeSeasonDayOffsets,
      comparisons,
      pass: comparisons.every((entry) => entry.pass),
      elapsedMs: selected.elapsedMs + reference.elapsedMs,
    });
  }
  return {
    tolerance: transientPhaseTolerance,
    shapes: shapeResults,
    pass: shapeResults.every((entry) => entry.pass),
    contract: "four independent actual-weather 24 h seasonal fixtures; never concatenated or scaled into annual energy",
  };
}

async function runPreflight() {
  const startIndex = 76 * 24;
  const points = weather.points.slice(startIndex, startIndex + 24 + 1);
  const comparisons = [] as Array<Record<string, unknown>>;
  const convergenceCases = [
    ...shapes.map((shape) => ({ shape, electricalModel: "local-mpp-area-integral" as const })),
    { shape: "plane" as const, electricalModel: "explicit-series-parallel-bypass" as const },
    { shape: "cylinder" as const, electricalModel: "explicit-series-parallel-bypass" as const },
  ];
  const preflightFilter = process.argv.find((argument) => argument.startsWith("--preflight-case="))
    ?.slice("--preflight-case=".length);
  const selectedCases = preflightFilter
    ? convergenceCases.filter(({ shape, electricalModel }) => `${shape}:${electricalModel}` === preflightFilter)
    : convergenceCases;
  for (const { shape, electricalModel } of selectedCases) {
    const lowSurface = makeSurface(shape, "swept", lowResolution);
    const highSurface = makeSurface(shape, "swept", highResolution);
    const lowVariant = buildVariant({
      shape, surface: lowSurface, electricalModel, rotation: "controlled-kinematic",
      phaseSamples: lowResolution.phaseSamples, circuitSamples: lowResolution.circuitSamples,
      variantId: `preflight-low:${shape}:${electricalModel}`,
    });
    const highVariant = buildVariant({
      shape, surface: highSurface, electricalModel, rotation: "controlled-kinematic",
      phaseSamples: highResolution.phaseSamples, circuitSamples: highResolution.circuitSamples,
      variantId: `preflight-high:${shape}:${electricalModel}`,
    });
    const startedAt = Date.now();
    const low = await energyFor(lowVariant, points, lowVariant.variantId);
    const high = await energyFor(highVariant, points, highVariant.variantId);
    const lowWh = low.result.acEnergyWhByVariant[lowVariant.variantId];
    const highWh = high.result.acEnergyWhByVariant[highVariant.variantId];
    const relativeDifference = Math.abs(lowWh - highWh) / Math.max(1e-12, Math.abs(highWh));
    const tolerance = electricalModel === "local-mpp-area-integral"
      ? convergenceTolerance.idealFraction
      : convergenceTolerance.engineeringFraction;
    const pass = relativeDifference <= tolerance;
    comparisons.push({
      shape, electricalModel, lowWh, highWh, relativeDifference, tolerance, pass,
      elapsedMs: Date.now() - startedAt,
    });
    console.log(`[annual-audit] preflight ${shape}/${electricalModel}: ${(relativeDifference * 100).toFixed(4)}% (${pass ? "pass" : "fail"})`);
  }
  const axisymmetricExactChecks = [] as Array<Record<string, unknown>>;
  for (const shape of [...axisymmetricShapes]) {
    const surface = makeSurface(shape, "swept", lowResolution);
    const base = { shape, surface, electricalModel: "local-mpp-area-integral" as const, rotation: "controlled-motor-net" as const, circuitSamples: lowResolution.circuitSamples };
    const one = buildVariant({ ...base, phaseSamples: 1, variantId: `symmetry-one:${shape}` });
    const four = buildVariant({ ...base, phaseSamples: 4, variantId: `symmetry-four:${shape}` });
    const oneRun = await energyFor(one, points, one.variantId);
    const fourRun = await energyFor(four, points, four.variantId);
    const oneWh = oneRun.result.acEnergyWhByVariant[one.variantId];
    const fourWh = fourRun.result.acEnergyWhByVariant[four.variantId];
    const absoluteDifferenceWh = Math.abs(oneWh - fourWh);
    const pass = absoluteDifferenceWh <= Math.max(1e-9, Math.abs(fourWh) * 1e-10);
    axisymmetricExactChecks.push({ shape, oneWh, fourWh, absoluteDifferenceWh, pass });
  }
  const nightPoints = weather.points.slice(0, 2);
  if (nightPoints.some((point) => point.ghiWm2 !== 0 || point.dniWm2 !== 0 || point.dhiWm2 !== 0)) {
    throw new Error("Night fast-path fixture is not dark.");
  }
  const nightVariant = buildVariant({
    shape: "sphere", surface: sweptSurfaces.sphere,
    electricalModel: "explicit-series-parallel-bypass", rotation: "held-static",
    phaseSamples: 1, circuitSamples: lowResolution.circuitSamples, variantId: "night-fast-path",
  });
  const night = await energyFor(nightVariant, nightPoints, nightVariant.variantId);
  const nightFastPath = {
    dcWh: night.result.dcEnergyWhByVariant[nightVariant.variantId],
    acWh: night.result.acEnergyWhByVariant[nightVariant.variantId],
    pass: night.result.dcEnergyWhByVariant[nightVariant.variantId] === 0
      && night.result.acEnergyWhByVariant[nightVariant.variantId] === 0,
    contract: "engineering solve is skipped exactly when ideal local-MPP DC is zero",
  };
  const runExtendedCylinderEngineering = async (
    resolution: Readonly<AuditResolution>,
    label: "selected" | "reference",
  ) => {
    const surface = makeSurface("cylinder", "swept", resolution);
    let acWh = 0;
    for (const dayOffset of representativeSeasonDayOffsets) {
      const seasonalPoints = weather.points.slice(dayOffset * 24, dayOffset * 24 + 25);
      if (seasonalPoints.length !== 25) {
        throw new Error("Incomplete seasonal engineering convergence fixture.");
      }
      const variantId = `engineering-extended:${label}:cylinder:${dayOffset}`;
      const variant = buildVariant({
        shape: "cylinder",
        surface,
        electricalModel: "explicit-series-parallel-bypass",
        rotation: "controlled-kinematic",
        phaseSamples: resolution.phaseSamples,
        circuitSamples: resolution.circuitSamples,
        variantId,
      });
      const run = await energyFor(variant, seasonalPoints, variantId);
      acWh += run.result.acEnergyWhByVariant[variantId];
    }
    return { acWh, sampleCount: surface.zones.reduce((sum, zone) => sum + zone.samples.length, 0) };
  };
  const extendedStartedAt = Date.now();
  const extendedSelected = await runExtendedCylinderEngineering(
    engineeringSelectedResolution,
    "selected",
  );
  const extendedReference = await runExtendedCylinderEngineering(
    engineeringReferenceResolution,
    "reference",
  );
  const extendedRelativeDifference = Math.abs(extendedSelected.acWh - extendedReference.acWh)
    / Math.max(1e-12, Math.abs(extendedReference.acWh));
  const extendedCylinderEngineering = {
    shape: "cylinder",
    electricalModel: "explicit-series-parallel-bypass",
    selectedResolution: engineeringSelectedResolution,
    referenceResolution: engineeringReferenceResolution,
    selectedWh: extendedSelected.acWh,
    referenceWh: extendedReference.acWh,
    selectedSampleCount: extendedSelected.sampleCount,
    referenceSampleCount: extendedReference.sampleCount,
    relativeDifference: extendedRelativeDifference,
    tolerance: convergenceTolerance.engineeringFraction,
    pass: extendedRelativeDifference <= convergenceTolerance.engineeringFraction,
    fixture: "four independent actual-weather 24 h seasonal fixtures; never annual-scaled",
    dayOffsets: representativeSeasonDayOffsets,
    elapsedMs: Date.now() - extendedStartedAt,
  };
  console.log(`[annual-audit] extended cylinder engineering: ${(extendedRelativeDifference * 100).toFixed(4)}% (${extendedCylinderEngineering.pass ? "pass" : "fail"})`);

  const idealComparisons = comparisons.filter((entry) => (
    entry.electricalModel === "local-mpp-area-integral"
  ));
  const engineeringComparisons = comparisons.filter((entry) => (
    entry.electricalModel === "explicit-series-parallel-bypass"
  ));
  const exactChecksPass = axisymmetricExactChecks.every((entry) => entry.pass)
    && nightFastPath.pass;
  const officialIdealPass = idealComparisons.length === shapes.length
    && idealComparisons.every((entry) => entry.pass)
    && exactChecksPass;
  const engineeringPass = engineeringComparisons.length > 0
    && engineeringComparisons.every((entry) => entry.pass)
    && extendedCylinderEngineering.pass;
  const engineeringReason = engineeringPass
    ? "All pre-registered engineering convergence checks passed."
    : `Engineering official ranking is not evaluated: the extended cylinder mesh check differed by ${(extendedCylinderEngineering.relativeDifference * 100).toFixed(4)}%, versus the pre-registered ${(extendedCylinderEngineering.tolerance * 100).toFixed(2)}% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.`;
  const pass = officialIdealPass && engineeringPass;
  return {
    pass,
    officialIdealPass,
    engineeringPass,
    engineeringOfficialRankingEligible: false,
    engineeringRankingVerdict: "not-evaluated",
    engineeringReason,
    fixture: "one actual hourly day near March equinox; convergence gate only, never scaled into annual energy",
    weatherPoints: points.length,
    intervals: points.length - 1,
    lowResolution,
    highResolution,
    comparisons,
    ideal: { pass: officialIdealPass, comparisons: idealComparisons },
    engineering: {
      pass: engineeringPass,
      comparisons: engineeringComparisons,
      extendedCylinder: extendedCylinderEngineering,
      tolerance: convergenceTolerance.engineeringFraction,
      status: "not-evaluated",
      officialRankingEligible: false,
    },
    axisymmetricExactChecks,
    nightFastPath,
  };
}

const preflightStartedAt = Date.now();
const transientPhaseConvergence = phaseGateOnly || (!transientOnly && !quasiOnly && requestedShapesArgument === undefined)
  ? runTransientPhaseConvergenceGate()
  : { pass: true, skipped: true, reason: "partial checkpoint run" };
if (phaseGateOnly) {
  console.log(JSON.stringify({ phaseGateOnly: true, transientPhaseConvergence }, null, 2));
  process.exit(transientPhaseConvergence.pass ? 0 : 1);
}
const partialExecution = transientOnly || quasiOnly || requestedShapesArgument !== undefined;
const convergenceGate = partialExecution
  ? {
      pass: false,
      officialIdealPass: true,
      engineeringPass: false,
      engineeringOfficialRankingEligible: false,
      engineeringRankingVerdict: "not-evaluated" as const,
      skipped: true,
      reason: "checkpoint-only partial execution; final report requires the complete convergence preflight",
    }
  : await runPreflight();
const preflightElapsedMs = Date.now() - preflightStartedAt;
if (!("officialIdealPass" in convergenceGate && convergenceGate.officialIdealPass)
  || !transientPhaseConvergence.pass) {
  throw new Error("Official ideal annual convergence, exact symmetry, or transient phase convergence failed; full-year execution is blocked.");
}
if (preflightOnly) {
  console.log(JSON.stringify({ preflightOnly: true, preflightElapsedMs, convergenceGate, transientPhaseConvergence }, null, 2));
  process.exit(0);
}

interface ScalarResult {
  dcEnergyWh: number;
  grossAcEnergyWh: number;
  acEnergyWh: number;
  motorEnergyWh: number;
  requestFingerprint: string;
  elapsedMs: number;
  derivedFrom?: string;
}
interface Checkpoint {
  schemaVersion: 2;
  configurationFingerprint: string;
  implementationFingerprint: string;
  tasks: Record<string, ScalarResult>;
  transient: Record<string, TransientScalar>;
  staticTransient: Record<string, StaticTransientScalar>;
}
interface TransientScalar {
  e00DcWh: number;
  e10DcWh: number;
  e01DcWh: number;
  e11DcWh: number;
  e00Wh: number;
  e10Wh: number;
  e01Wh: number;
  e11Wh: number;
  e00GrossWh: number;
  e11GrossWh: number;
  e11MotorWh: number;
  closureResidualWh: number;
  heatResidualFraction: number;
  warmupConverged: boolean;
  elapsedMs: number;
  averageTemperatureCByCase: {
    e00: number;
    e10: number;
    e01: number;
    e11: number;
  };
  monthly: AnnualRotationDecompositionResult["monthly"];
}
interface StaticTransientScalar {
  dcEnergyWh: number;
  grossAcEnergyWh: number;
  acEnergyWh: number;
  motorEnergyWh: number;
  averageTemperatureC: number;
  heatResidualFraction: number;
  warmupConverged: boolean;
  monthly: Array<{ month: string; acEnergyWh: number }>;
  elapsedMs: number;

}
const configurationFingerprint = createHash("sha256").update(JSON.stringify({
  auditImplementationVersion,
  implementationFingerprint,
  year, landAreaM2, maximumHeightM, fixedRpm, groundClearanceM,
  lowResolution, highResolution, transientResolution,
  engineeringSelectedResolution, engineeringReferenceResolution,
  convergenceTolerance, transientPhaseTolerance, representativeSeasonDayOffsets,
  motorDrive, electrical, inverter, location, offsetMinutes,
  geometry: {
    static: Object.fromEntries(shapes.map((shape) => [shape, {
      activeAreaM2: staticSurfaces[shape].comparison.activeAreaM2,
      sampleCount: staticSurfaces[shape].zones.reduce((sum, zone) => sum + zone.samples.length, 0),
    }])),
    swept: Object.fromEntries(shapes.map((shape) => [shape, {
      activeAreaM2: sweptSurfaces[shape].comparison.activeAreaM2,
      sampleCount: sweptSurfaces[shape].zones.reduce((sum, zone) => sum + zone.samples.length, 0),
    }])),
  },
  weatherFingerprint: createHash("sha256").update(JSON.stringify(weather.points)).digest("hex"),
})).digest("hex");
let checkpoint: Checkpoint = {
  schemaVersion: 2,
  configurationFingerprint,
  implementationFingerprint,
  tasks: {},
  transient: {},
  staticTransient: {},
};
if (existsSync(checkpointPath)) {
  const parsed = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
  if (parsed.schemaVersion === 2
    && parsed.configurationFingerprint === configurationFingerprint
    && parsed.implementationFingerprint === implementationFingerprint) {
    checkpoint = parsed;
    console.log(`[annual-audit] resumed ${Object.keys(checkpoint.tasks).length} quasi, ${Object.keys(checkpoint.transient).length} swept-transient, and ${Object.keys(checkpoint.staticTransient).length} static-transient checkpoints`);
  }
}
const saveCheckpoint = () => writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

async function runAnnualTask(args: {
  key: string;
  shape: ComparisonShapeKind;
  surface: ComparisonSurfaceModel;
  electricalModel: SimulationContinuousSurfaceElectricalModel;
  rotation: RotationContract;
  motor?: boolean;
  phaseSamples?: number;
}): Promise<ScalarResult> {
  const cached = checkpoint.tasks[args.key];
  if (cached) return cached;
  const variant = buildVariant({
    shape: args.shape,
    surface: args.surface,
    electricalModel: args.electricalModel,
    rotation: args.rotation,
    phaseSamples: args.phaseSamples ?? lowResolution.phaseSamples,
    circuitSamples: lowResolution.circuitSamples,
    variantId: args.key,
    motor: args.motor,
  });
  const startedAt = Date.now();
  const { request, result } = await energyFor(variant, weather.points, args.key, true);
  if (result.steps !== 8_761 || result.intervals !== 8_760 || result.durationHours !== 8_760) {
    throw new Error(`${args.key}: incomplete annual clock.`);
  }
  const scalar: ScalarResult = {
    dcEnergyWh: result.dcEnergyWhByVariant[args.key],
    grossAcEnergyWh: result.acEnergyWhByVariant[args.key],
    acEnergyWh: result.acEnergyWhByVariant[args.key],
    motorEnergyWh: result.motorEnergyWhByVariant?.[args.key] ?? 0,
    requestFingerprint: request.fingerprint,
    elapsedMs: Date.now() - startedAt,
  };
  checkpoint.tasks[args.key] = scalar;
  saveCheckpoint();
  return scalar;
}

async function runControlledPair(args: {
  shape: ComparisonShapeKind;
  surface: ComparisonSurfaceModel;
  electricalModel: SimulationContinuousSurfaceElectricalModel;
  phaseSamples: number;
}): Promise<{ gross: ScalarResult; net: ScalarResult }> {
  const grossKey = `controlled-kinematic:${args.electricalModel}:${args.shape}`;
  const netKey = `controlled-motor-net:${args.electricalModel}:${args.shape}`;
  const cachedGross = checkpoint.tasks[grossKey];
  const cachedNet = checkpoint.tasks[netKey];
  if (cachedGross && cachedNet) return { gross: cachedGross, net: cachedNet };
  const grossVariant = buildVariant({
    ...args,
    rotation: "controlled-kinematic",
    circuitSamples: lowResolution.circuitSamples,
    variantId: grossKey,
  });
  const netVariant = buildVariant({
    ...args,
    rotation: "controlled-motor-net",
    circuitSamples: lowResolution.circuitSamples,
    variantId: netKey,
    motor: true,
  });
  const input = kernelInput([grossVariant, netVariant], weather.points);
  const request = createSimulationRunRequest(
    `controlled-pair:${args.electricalModel}:${args.shape}`,
    input,
  );
  const constantMotorPowerW = motorDrivePowerW({
    requiredTorqueNm: motorDrive.requiredTorqueNm,
    rpm: fixedRpm,
    motorEfficiency: motorDrive.motorEfficiency,
  });
  let cachedStepIndex = -1;
  let cachedPhysics: SimulationPhysicsStepResult | undefined;
  const sharedPhysicsStep: SimulationStepFunction = (context) => {
    if (context.variant.variantId === grossKey) {
      const raw = computePhysicsStep(context);
      if (typeof raw === "number") {
        throw new Error("Production physics unexpectedly returned a scalar.");
      }
      cachedStepIndex = context.stepIndex;
      cachedPhysics = raw;
      return raw;
    }
    if (context.variant.variantId !== netKey
      || cachedStepIndex !== context.stepIndex
      || cachedPhysics === undefined) {
      throw new Error("Controlled gross/net shared-physics ordering invariant failed.");
    }
    const netAcPowerW = Math.max(0, cachedPhysics.acPowerW - constantMotorPowerW);
    const scale = cachedPhysics.acPowerW > 0 ? netAcPowerW / cachedPhysics.acPowerW : 0;
    return {
      ...cachedPhysics,
      acPowerW: netAcPowerW,
      motorPowerW: constantMotorPowerW,
      surfaceRegions: Object.fromEntries(Object.entries(cachedPhysics.surfaceRegions ?? {}).map(
        ([regionId, region]) => [regionId, { ...region, acPowerW: region.acPowerW * scale }],
      )),
    };
  };
  let lastDecile = -1;
  const startedAt = Date.now();
  const result = await runSimulationKernel(request, {
    yieldControl: async () => undefined,
    onProgress: (event) => {
      const decile = Math.floor(event.fraction * 10);
      if (decile > lastDecile) {
        lastDecile = decile;
        console.log(`[annual-audit] ${request.requestId} ${Math.min(100, decile * 10)}%`);
      }
    },
  }, sharedPhysicsStep);
  if (result.steps !== 8_761 || result.intervals !== 8_760 || result.durationHours !== 8_760) {
    throw new Error(`${request.requestId}: incomplete annual clock.`);
  }
  const elapsedMs = Date.now() - startedAt;
  const gross: ScalarResult = {
    dcEnergyWh: result.dcEnergyWhByVariant[grossKey],
    grossAcEnergyWh: result.acEnergyWhByVariant[grossKey],
    acEnergyWh: result.acEnergyWhByVariant[grossKey],
    motorEnergyWh: 0,
    requestFingerprint: request.fingerprint,
    elapsedMs,
  };
  const net: ScalarResult = {
    dcEnergyWh: result.dcEnergyWhByVariant[netKey],
    grossAcEnergyWh: result.acEnergyWhByVariant[grossKey],
    acEnergyWh: result.acEnergyWhByVariant[netKey],
    motorEnergyWh: result.motorEnergyWhByVariant?.[netKey] ?? 0,
    requestFingerprint: request.fingerprint,
    elapsedMs: 0,
    derivedFrom: grossKey,
  };
  checkpoint.tasks[grossKey] = gross;
  checkpoint.tasks[netKey] = net;
  saveCheckpoint();
  return { gross, net };
}

function deriveTask(key: string, sourceKey: string): ScalarResult {
  const source = checkpoint.tasks[sourceKey];
  if (!source) throw new Error(`Missing exact-reuse source ${sourceKey}`);
  const derived = { ...source, derivedFrom: sourceKey, elapsedMs: 0 };
  checkpoint.tasks[key] = derived;
  return derived;
}

type Row = ReturnType<typeof makeRow>;
function makeRow(
  shape: ComparisonShapeKind,
  surface: ComparisonSurfaceModel,
  result: ScalarResult,
  electricalModel: SimulationContinuousSurfaceElectricalModel,
  thermalModel: string,
  geometryContract: GeometryContract,
  rotationModel: string,
) {
  const activePvAreaM2 = surface.comparison.activeAreaM2;
  const acKWhYear = result.acEnergyWh / 1_000;
  return {
    shape,
    landAreaM2,
    selectedFootprintM2: surface.comparison.footprint.selectedStructureAreaM2,
    staticProjectedAreaM2: surface.comparison.footprint.staticProjectedAreaM2,
    sweptAreaM2: surface.comparison.footprint.sweptAreaM2,
    heightM: surface.comparison.dimensions.heightM,
    activePvAreaM2,
    pvLandRatio: activePvAreaM2 / landAreaM2,
    grossAcKWhYear: result.grossAcEnergyWh / 1_000,
    motorKWhYear: result.motorEnergyWh / 1_000,
    acKWhYear,
    kWhPerLandM2Year: acKWhYear / landAreaM2,
    kWhPerPvM2Year: acKWhYear / activePvAreaM2,
    electricalModel,
    thermalModel,
    geometryContract,
    rotationModel,
    weatherSource: `${weather.provenance.provider}/${weather.provenance.kind}`,
    timeResolution: "60 min; actual 8760 intervals + closing endpoint",
    representativeDayScaling: false,
    requestFingerprint: result.requestFingerprint,
    derivedFrom: result.derivedFrom,
    elapsedMs: result.elapsedMs,
  };
}

interface Group {
  id: string;
  comparisonMeaning: string;
  geometryContract: GeometryContract;
  rotationMode: string;
  electricalModel: SimulationContinuousSurfaceElectricalModel;
  thermalModel: string;
  officialRankingEligible: boolean;
  rankingVerdict: "pass" | "not-evaluated";
  calculationResolution: string;
  rows: Row[];
}
const groups: Group[] = [];
async function quasiGroup(args: {
  id: string;
  geometryContract: GeometryContract;
  rotation: RotationContract;
  electricalModel: SimulationContinuousSurfaceElectricalModel;
  comparisonMeaning: string;
  motor?: boolean;
}) {
  const surfaces = args.geometryContract === "static-land-matched" ? staticSurfaces : sweptSurfaces;
  const rows: Row[] = [];
  for (const shape of executionShapes) {
    const key = `${args.id}:${shape}`;
    let scalar: ScalarResult;
    if (args.rotation === "natural-no-cq") {
      scalar = deriveTask(key, `static-land-matched:${args.electricalModel}:${shape}`);
    } else if (args.rotation === "controlled-kinematic"
      || args.rotation === "controlled-motor-net") {
      const phaseSamples = args.electricalModel === "local-mpp-area-integral"
        && axisymmetricShapes.has(shape)
        ? 1
        : lowResolution.phaseSamples;
      const pair = await runControlledPair({
        shape,
        surface: surfaces[shape],
        electricalModel: args.electricalModel,
        phaseSamples,
      });
      scalar = args.rotation === "controlled-kinematic" ? pair.gross : pair.net;
    } else {
      scalar = await runAnnualTask({
        key, shape, surface: surfaces[shape], electricalModel: args.electricalModel,
        rotation: args.rotation, motor: args.motor, phaseSamples: 1,
      });
    }
    rows.push(makeRow(
      shape, surfaces[shape], scalar, args.electricalModel,
      "준정상 광학 회전·열이력 미포함",
      args.geometryContract,
      args.rotation === "controlled-motor-net"
        ? `controlled ${fixedRpm} RPM; active motor net AC; tau=${motorDrive.requiredTorqueNm} Nm; eta=${motorDrive.motorEfficiency}`
        : args.rotation === "controlled-kinematic"
          ? `controlled ${fixedRpm} RPM; kinematic gross AC before motor demand`
          : args.rotation === "natural-no-cq"
            ? "shape dynamics; no C_Q; exact 0 RPM; static footprint contract"
            : "held static 0 RPM",
    ));
  }
  groups.push({
    id: args.id,
    comparisonMeaning: args.comparisonMeaning,
    geometryContract: args.geometryContract,
    rotationMode: args.rotation,
    electricalModel: args.electricalModel,
    thermalModel: "quasi-steady-faiman",
    officialRankingEligible: args.electricalModel === "local-mpp-area-integral",
    rankingVerdict: args.electricalModel === "local-mpp-area-integral" ? "pass" : "not-evaluated",
    calculationResolution: args.electricalModel === "local-mpp-area-integral"
      ? `azimuth=${lowResolution.azimuthSamples}; meridional=${lowResolution.meridionalSegments}; phase<=${lowResolution.phaseSamples}; ideal local-MPP`
      : `azimuth=${lowResolution.azimuthSamples}; meridional=${lowResolution.meridionalSegments}; phase=${lowResolution.phaseSamples}; circuit=${lowResolution.circuitSamples}; exploratory non-converged output`,
    rows: rows.sort((left, right) => right.kWhPerLandM2Year - left.kWhPerLandM2Year),
  });
}

for (const electricalModel of electricalModes) {
  if (!transientOnly) {
  await quasiGroup({
    id: `static-land-matched:${electricalModel}`,
    geometryContract: "static-land-matched", rotation: "held-static", electricalModel,
    comparisonMeaning: "Static designs sized so instantaneous horizontal projection equals A_land.",
  });
  await quasiGroup({
    id: `swept-held-static:${electricalModel}`,
    geometryContract: "swept-rotation-envelope", rotation: "held-static", electricalModel,
    comparisonMeaning: "Pure-rotation baseline: rotating-envelope geometry held at 0 RPM.",
  });
  await quasiGroup({
    id: `controlled-kinematic:${electricalModel}`,
    geometryContract: "swept-rotation-envelope", rotation: "controlled-kinematic", electricalModel,
    comparisonMeaning: "Common controlled 2 RPM gross AC before an active motor demand is deducted.",
  });
  await quasiGroup({
    id: `controlled-motor-net:${electricalModel}`,
    geometryContract: "swept-rotation-envelope", rotation: "controlled-motor-net", electricalModel,
    comparisonMeaning: "Common controlled 2 RPM with active-motor demand deducted and net AC clipped at zero.",
    motor: true,
  });
  await quasiGroup({
    id: `natural-no-cq:${electricalModel}`,
    geometryContract: "static-land-matched", rotation: "natural-no-cq", electricalModel,
    comparisonMeaning: "Natural dynamics with absent C_Q; exact zero-RPM result reuses the identical static land-matched calculation.",
  });
}

}
if (quasiOnly) {
  console.log(JSON.stringify({
    quasiOnly: true,
    completedShapes: executionShapes,
    checkpointPath,
  }, null, 2));
  process.exit(0);
}
async function runTransient(shape: ComparisonShapeKind): Promise<TransientScalar> {
  const key = `transient-swept:${shape}`;
  const cached = checkpoint.transient[key];
  if (cached) return cached;
  console.log(`[annual-audit] ${key} started (synchronous full-year E00/E10/E01/E11)`);
  const startedAt = Date.now();
  const decomposition = simulateAnnualRotationDecomposition({
    surface: sweptSurfaces[shape],
    weather: weather.points,
    location,
    rpm: fixedRpm,
    referenceEfficiency: electrical.efficiency,
    gammaPerC: electrical.gammaPmpPerC,
    soilingLossFraction: 0.02,
    albedo: 0.2,
    iam: { model: "ashrae", b0: 0.05 },
    diffuseModel: "hay-davies",
    inverter,
    motorDrive: {
      requiredTorqueNm: motorDrive.requiredTorqueNm,
      motorEfficiency: motorDrive.motorEfficiency,
    },
    motorRpm: fixedRpm,
    thermalMesh: { targetNodeCount: transientResolution.thermalNodeCount },
    thermalConfig: { ...DEFAULT_THERMAL, maximumSubstepSeconds: transientResolution.maximumSubstepSeconds },
    warmup: transientResolution.warmup,
    opticalPhaseSamples: transientResolution.opticalPhaseSamples,
    convectionPhaseSamples: transientResolution.opticalPhaseSamples,
    reportingOffsetMinutes: offsetMinutes,
  });
  validateTransient(shape, decomposition);
  const scalar: TransientScalar = {
    e00DcWh: decomposition.e00.dcEnergyWh,
    e10DcWh: decomposition.e10.dcEnergyWh,
    e01DcWh: decomposition.e01.dcEnergyWh,
    e11DcWh: decomposition.e11.dcEnergyWh,
    e00Wh: decomposition.annual.e00Wh,
    e10Wh: decomposition.annual.e10Wh,
    e01Wh: decomposition.annual.e01Wh,
    e11Wh: decomposition.annual.e11Wh,
    e00GrossWh: decomposition.e00.grossAcEnergyWh,
    e11GrossWh: decomposition.e11.grossAcEnergyWh,
    e11MotorWh: decomposition.e11.motorEnergyWh,
    averageTemperatureCByCase: {
      e00: decomposition.e00.averageTemperatureC,
      e10: decomposition.e10.averageTemperatureC,
      e01: decomposition.e01.averageTemperatureC,
      e11: decomposition.e11.averageTemperatureC,
    },
    monthly: decomposition.monthly,
    closureResidualWh: decomposition.annual.closureResidualWh,
    heatResidualFraction: Math.max(
      decomposition.e00.energyAudit.relativeEnergyResidual, decomposition.e10.energyAudit.relativeEnergyResidual,
      decomposition.e01.energyAudit.relativeEnergyResidual, decomposition.e11.energyAudit.relativeEnergyResidual,
    ),
    warmupConverged: [decomposition.e00, decomposition.e10, decomposition.e01, decomposition.e11]
      .every((entry) => entry.warmup.converged),
    elapsedMs: Date.now() - startedAt,
  };
  checkpoint.transient[key] = scalar;
  saveCheckpoint();
  console.log(`[annual-audit] ${key} complete in ${(scalar.elapsedMs / 1000).toFixed(1)}s`);
  return scalar;
}
async function runStaticTransient(shape: ComparisonShapeKind): Promise<StaticTransientScalar> {
  const key = `transient-static:${shape}`;
  const cached = checkpoint.staticTransient[key];
  if (cached) return cached;
  console.log(`[annual-audit] ${key} started (actual full-year static geometry)`);
  const startedAt = Date.now();
  const result = simulateAnnualTransientSurface({
    surface: staticSurfaces[shape],
    weather: weather.points,
    location,
    rpm: 0,
    referenceEfficiency: electrical.efficiency,
    gammaPerC: electrical.gammaPmpPerC,
    soilingLossFraction: 0.02,
    albedo: 0.2,
    iam: { model: "ashrae", b0: 0.05 },
    diffuseModel: "hay-davies",
    inverter,
    motorRpm: 0,
    thermalMesh: { targetNodeCount: transientResolution.thermalNodeCount },
    thermalConfig: { ...DEFAULT_THERMAL, maximumSubstepSeconds: transientResolution.maximumSubstepSeconds },
    warmup: transientResolution.warmup,
    opticalPhaseSamples: 1,
    convectionPhaseSamples: 1,
    reportingOffsetMinutes: offsetMinutes,
  });
  if (result.coverage.intervals !== 8_760
    || result.coverage.durationHours !== 8_760
    || !result.coverage.closingEndpointPresent) {
    throw new Error(`${shape}: static transient annual clock is incomplete.`);
  }
  if (result.energyAudit.relativeEnergyResidual > 1e-8) {
    throw new Error(`${shape}: static transient heat residual exceeds tolerance.`);
  }
  if (!result.warmup.converged) {
    throw new Error(`${shape}: static transient warm-up did not converge.`);
  }
  const scalar: StaticTransientScalar = {
    dcEnergyWh: result.dcEnergyWh,
    grossAcEnergyWh: result.grossAcEnergyWh,
    acEnergyWh: result.acEnergyWh,
    motorEnergyWh: result.motorEnergyWh,
    averageTemperatureC: result.averageTemperatureC,
    heatResidualFraction: result.energyAudit.relativeEnergyResidual,
    warmupConverged: result.warmup.converged,
    monthly: result.monthly.map((entry) => ({
      month: entry.month,
      acEnergyWh: entry.acEnergyWh,
    })),
    elapsedMs: Date.now() - startedAt,
  };
  checkpoint.staticTransient[key] = scalar;
  saveCheckpoint();
  console.log(`[annual-audit] ${key} complete in ${(scalar.elapsedMs / 1_000).toFixed(1)}s`);
  return scalar;
}

function validateTransient(shape: ComparisonShapeKind, result: AnnualRotationDecompositionResult) {
  if (result.e11.coverage.intervals !== 8_760
    || result.e11.coverage.durationHours !== 8_760
    || !result.e11.coverage.closingEndpointPresent) {
    throw new Error(`${shape}: transient annual clock is incomplete.`);
  }
  if (Math.abs(result.annual.closureResidualWh) > 1e-8) {
    throw new Error(`${shape}: transient decomposition does not close.`);
  }
  if (result.e11.energyAudit.relativeEnergyResidual > 1e-8) {
    throw new Error(`${shape}: transient heat residual exceeds tolerance.`);
  }
  if (!result.e11.warmup.converged) throw new Error(`${shape}: transient warm-up did not converge.`);
}

const transientRows = [] as Array<{
  shape: ComparisonShapeKind;
  staticLandMatched: Row;
  staticSwept: Row;
  fixedMotorNet: Row;
  naturalNoCq: Row;
  decomposition: TransientScalar;
}>;
for (const shape of executionShapes) {
  const decomposition = await runTransient(shape);
  const staticResult = await runStaticTransient(shape);
  const baseFingerprint = `annual-transient:${configurationFingerprint}:${shape}`;
  const e00: ScalarResult = {
    dcEnergyWh: decomposition.e00DcWh,
    grossAcEnergyWh: decomposition.e00GrossWh,
    acEnergyWh: decomposition.e00Wh,
    motorEnergyWh: 0,
    requestFingerprint: baseFingerprint,
    elapsedMs: decomposition.elapsedMs,
  };
  const e11: ScalarResult = {
    dcEnergyWh: decomposition.e11DcWh,
    grossAcEnergyWh: decomposition.e11GrossWh,
    acEnergyWh: decomposition.e11Wh,
    motorEnergyWh: decomposition.e11MotorWh,
    requestFingerprint: baseFingerprint,
    elapsedMs: decomposition.elapsedMs,
  };
  const staticScalar: ScalarResult = {
    dcEnergyWh: staticResult.dcEnergyWh,
    grossAcEnergyWh: staticResult.grossAcEnergyWh,
    acEnergyWh: staticResult.acEnergyWh,
    motorEnergyWh: 0,
    requestFingerprint: `${baseFingerprint}:static-land-matched`,
    elapsedMs: staticResult.elapsedMs,
  };
  const thermalLabel = "annual actual-clock transient thermal history included";
  const surface = sweptSurfaces[shape];
  transientRows.push({
    shape,
    staticLandMatched: makeRow(shape, staticSurfaces[shape], staticScalar, "local-mpp-area-integral", thermalLabel, "static-land-matched", "held static 0 RPM"),
    staticSwept: makeRow(shape, surface, e00, "local-mpp-area-integral", thermalLabel, "swept-rotation-envelope", "held static 0 RPM"),
    fixedMotorNet: makeRow(shape, surface, e11, "local-mpp-area-integral", thermalLabel, "swept-rotation-envelope", `controlled ${fixedRpm} RPM; active motor net AC`),
    naturalNoCq: makeRow(shape, staticSurfaces[shape], { ...staticScalar, derivedFrom: `${baseFingerprint}:static-land-matched`, elapsedMs: 0 }, "local-mpp-area-integral", thermalLabel, "static-land-matched", "shape dynamics; no C_Q; exact 0 RPM"),
    decomposition,
  });
}
if (transientOnly || requestedShapesArgument !== undefined) {
  console.log(JSON.stringify({
    transientOnly,
    completedShapes: transientRows.map((entry) => entry.shape),
    checkpointPath,
  }, null, 2));
  process.exit(0);
}
for (const [id, selector, meaning, geometryContract, rotationMode] of [
  ["transient-static-land-matched:local-mpp-area-integral", (entry: (typeof transientRows)[number]) => entry.staticLandMatched, "Transient static designs sized to A_land.", "static-land-matched", "held-static"],
  ["transient-swept-held-static:local-mpp-area-integral", (entry: (typeof transientRows)[number]) => entry.staticSwept, "Transient pure-rotation E00 baseline on swept geometry.", "swept-rotation-envelope", "held-static"],
  ["transient-controlled-motor-net:local-mpp-area-integral", (entry: (typeof transientRows)[number]) => entry.fixedMotorNet, "Transient E11 with controlled 2 RPM and active motor net AC.", "swept-rotation-envelope", "controlled-motor-net"],
  ["transient-natural-no-cq:local-mpp-area-integral", (entry: (typeof transientRows)[number]) => entry.naturalNoCq, "Transient no-C_Q natural result; exact zero schedule reuses the static land-matched calculation.", "static-land-matched", "natural-no-cq"],
] as const) {
  groups.push({
    id,
    comparisonMeaning: meaning,
    geometryContract,
    rotationMode,
    electricalModel: "local-mpp-area-integral",
    thermalModel: "annual-transient-material-state",
    officialRankingEligible: true,
    rankingVerdict: "pass",
    calculationResolution: `optical phase=${transientResolution.opticalPhaseSamples}; thermal nodes=${transientResolution.thermalNodeCount}; maximum substep=${transientResolution.maximumSubstepSeconds}s`,
    rows: transientRows.map(selector).sort((left, right) => right.kWhPerLandM2Year - left.kWhPerLandM2Year),
  });
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  conditions: {
    year, landAreaM2, maximumHeightM, planeTiltDeg: 30, reflector: "none", albedo: 0.2,
    obstacles: "none", fixedRpm,
    motorDrive,
    configurationFingerprint,
    implementationFingerprint,
    implementationSourceFiles,
    naturalCq: "absent; symmetric shapes default to exactly 0 RPM",
    naturalRpmByShape: Object.fromEntries(shapes.map((shape) => [shape, {
      annualTimeWeightedMeanRpm: naturalHistories[shape].annual.timeWeightedMeanRpm,
      source: "C_Q absent; analytic geometry/inertia; user friction assumptions",
      confidence: "low",
    }])),
    weatherPoints: weather.points.length,
    intervals: weather.points.length - 1,
    durationHours: 8_760,
    transientPhaseConvergence,
    integration: "actual hourly full-year calculation, not representative-day scaling",
    electricalConnection: {
      ideal: "continuous local-MPP area integral upper bound",
      engineering: "0.01 m2 nominal cells; 2 parallel strings; 5 cells/bypass substring; explicit wiring resistance",
    },
    unsupportedCombination: "annual transient + explicit engineering circuit remains separate and is not reported as one model",
  },
  convergenceGate: { ...convergenceGate, elapsedMs: preflightElapsedMs },
  exactReductions: [
    "Natural no-C_Q schedules were integrated and verified pointwise zero; static-land-matched transient and quasi-steady rows are reused exactly.",
    "For axisymmetric ideal skins without obstacles or directional reflectors, vertical rotation permutes the 16-point azimuth mesh exactly; one phase is used. Engineering wiring is not permutation-invariant and retains four-phase quadrature.",
  ],
  groups,
  transientDecompositionByShape: Object.fromEntries(transientRows.map((entry) => [entry.shape, entry.decomposition])),
};
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!("officialIdealPass" in convergenceGate)
  || "skipped" in convergenceGate
  || "skipped" in transientPhaseConvergence) {
  throw new Error("Final report cannot be generated from a partial or skipped convergence execution.");
}
const sections = groups.flatMap((group) => [
  `## ${group.id}`,
  "",
  group.comparisonMeaning,
  "",
  group.officialRankingEligible
    ? "Official ranking eligible: yes."
    : `Official rank: not evaluated. Ordered exploratory output only. ${convergenceGate.engineeringReason}`,
  `Calculation resolution: ${group.calculationResolution}.`,
  "",
  `| ${group.officialRankingEligible ? "Rank" : "Exploratory order"} | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |`,
  "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|",
  ...group.rows.map((row, index) => `| ${index + 1} | ${row.shape} | ${row.landAreaM2.toFixed(4)} | ${row.activePvAreaM2.toFixed(4)} | ${row.pvLandRatio.toFixed(3)} | ${row.grossAcKWhYear.toFixed(6)} | ${row.motorKWhYear.toFixed(6)} | ${row.acKWhYear.toFixed(6)} | ${row.kWhPerLandM2Year.toFixed(6)} | ${row.kWhPerPvM2Year.toFixed(6)} | ${row.electricalModel} | ${row.thermalModel} | ${row.geometryContract} | ${row.rotationModel} |`),
  "",
]);
writeFileSync(markdownPath, [
  "# Actual full-year fair-comparison audit",
  "",
  "Every annual row uses 8,760 actual hourly intervals plus a non-integrated closing endpoint. No representative-day conversion, shape multiplier, or research-rank fitting is used.",
  "",
  "Static land-matched designs and swept-envelope rotation-effect baselines are intentionally separate. Controlled active rotation reports motor-net AC. Transient ideal and quasi-steady engineering results remain separate because their combined solver is unsupported.",
  "",
  `Official ideal convergence: ${convergenceGate.officialIdealPass ? "PASS" : "FAIL"}. Engineering official ranking: NOT EVALUATED (${convergenceGate.engineeringReason}). Preflight ${(preflightElapsedMs / 1000).toFixed(1)} s.`,
  "",
  ...sections,
].join("\n"), "utf8");
if (existsSync(checkpointPath)) unlinkSync(checkpointPath);
console.log(JSON.stringify({
  jsonPath, markdownPath, groupCount: groups.length,
  preflightElapsedMs,
  totalTaskElapsedMs: Object.values(checkpoint.tasks).reduce((sum, task) => sum + task.elapsedMs, 0)
    + Object.values(checkpoint.transient).reduce((sum, task) => sum + task.elapsedMs, 0)
    + Object.values(checkpoint.staticTransient).reduce((sum, task) => sum + task.elapsedMs, 0),
  ranks: Object.fromEntries(groups.map((group) => [group.id, group.rows.map((row) => row.shape)])),
}, null, 2));
