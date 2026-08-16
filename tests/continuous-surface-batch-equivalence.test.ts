import { describe, expect, it } from "vitest";
import { createComparisonSurface, createContinuousSurface } from "../src/lib/geometry";
import {
  DEFAULT_ELECTRICAL,
  compareEngineeringSurfaceSpatialAddress,
  engineeringSurfaceSpatialKey,
  normalize,
  quaternionBetween,
  rotateAroundY,
  rotateVector,
  simulateInstant,
  solveEngineeringSurfaceElectrical,
  sunVector,
  type ElectricalConfig,
  type EngineeringSurfaceElectricalSample,
  type Vec3,
} from "../src/lib/physics";
import {
  computePhysicsStep,
  createContinuousSurfaceWorkItem,
  planeTrackingNormal,
  rotationIntervalSamples,
  type SimulationContinuousSurfaceSample,
  type SimulationKernelInput,
  type SimulationObstacleBounds,
  type SimulationPhysicsStepResult,
  type SimulationStepContext,
  type SimulationSurfaceRegionResult,
} from "../src/workers";

const HOUR_MS = 3_600_000;
const CONNECTION = {
  nominalCellAreaM2: 0.005,
  parallelStrings: 2,
  cellsPerBypassSubstring: 4,
  bypassForwardVoltageV: 0.5,
  stringWiringResistanceOhm: 0.013,
  arrayWiringResistanceOhm: 0.021,
  cellIvModel: "piecewise-nameplate" as const,
  circuitSamples: 512,
};

function referenceCellConfig(
  config: ElectricalConfig,
  nominalCellAreaM2: number,
  efficiency: number,
): ElectricalConfig {
  const scale = nominalCellAreaM2 * efficiency * config.referenceIrradianceWm2
    / Math.max(config.pmaxW, 1e-12);
  return {
    ...config,
    areaM2: nominalCellAreaM2,
    efficiency,
    pmaxW: nominalCellAreaM2 * efficiency * config.referenceIrradianceWm2,
    iscA: config.iscA * scale,
    impA: config.impA * scale,
    alphaIscAperC: config.alphaIscAperC * scale,
    seriesResistanceOhm: config.seriesResistanceOhm / scale,
    shuntResistanceOhm: config.shuntResistanceOhm / scale,
    cellsInSeries: 1,
  };
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

function transformedSample(
  sample: SimulationContinuousSurfaceSample,
  angleRad: number,
  context: SimulationStepContext,
  sunDirection: Vec3,
): { positionM: Vec3; normal: Vec3 } {
  const tracking = context.variant.planeTracking;
  if (!tracking) {
    return {
      positionM: rotateAroundY(sample.positionM, angleRad),
      normal: normalize(rotateAroundY(sample.normal, angleRad)),
    };
  }
  const target = planeTrackingNormal(tracking.mode, sunDirection);
  const rotation = quaternionBetween({ x: 0, y: 1, z: 0 }, target);
  const relative = {
    x: sample.positionM.x - tracking.centreM.x,
    y: sample.positionM.y - tracking.centreM.y,
    z: sample.positionM.z - tracking.centreM.z,
  };
  const rotated = rotateVector(rotation, relative);
  return {
    positionM: {
      x: tracking.centreM.x + rotated.x,
      y: tracking.centreM.y + rotated.y,
      z: tracking.centreM.z + rotated.z,
    },
    normal: normalize(rotateVector(rotation, sample.normal)),
  };
}

function scalarAngleReference(
  context: SimulationStepContext,
  angleRad: number,
): SimulationPhysicsStepResult {
  const { input, variant, weather, stepIndex } = context;
  const surface = variant.continuousSurface!;
  const scale = variant.irradianceScaleByStep?.[stepIndex] ?? variant.irradianceScale ?? 1;
  const irradiance = {
    ghiWm2: Math.max(0, weather.ghiWm2 * scale),
    dniWm2: Math.max(0, weather.dniWm2 * scale),
    dhiWm2: Math.max(0, weather.dhiWm2 * scale),
  };
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
  const override = input.physics?.solarOverride;
  if (!override) throw new Error("The scalar equivalence fixture requires solarOverride.");
  const sunDirection = sunVector(override.azimuthDeg, override.elevationDeg);
  const aggregateAvailability = 1 - Math.min(
    1,
    Math.max(0, electrical.aggregateLossFraction ?? 0),
  );
  const regions: Record<string, SimulationSurfaceRegionResult> = {};
  const engineeringSamples: EngineeringSurfaceElectricalSample[] = [];
  let idealDcPowerW = 0;
  let poaAreaW = 0;
  let temperatureAreaC = 0;
  let closure: ReturnType<typeof simulateInstant>["irradiance"]["ghiClosure"] | undefined;
  const ordered = [...surface.samples].sort(compareEngineeringSurfaceSpatialAddress);

  for (const baseSample of ordered) {
    const sample = transformedSample(baseSample, angleRad, context, sunDirection);
    const baseVisibility = surfaceOptions.visibility ?? 1;
    const blocked = variant.obstacleBounds?.some((bounds) =>
      rayIntersectsAabb(sample.positionM, sunDirection, bounds),
    ) ?? false;
    const visibility = variant.obstacleBounds?.length
      ? baseVisibility * (blocked ? 0 : 1)
      : baseVisibility;
    // This is deliberately the former scalar implementation: every material
    // sample independently resolves solar, irradiance, wind, POA and Faiman.
    const result = simulateInstant({
      timestamp: weather.timeUtcMs,
      location: input.physics?.location,
      solarOverride: override,
      irradiance,
      panel: {
        ...surfaceOptions,
        normal: sample.normal,
        areaM2: baseSample.areaM2,
        efficiency: variant.referenceEfficiency,
        heightM: surfaceOptions.heightM ?? Math.max(0.01, sample.positionM.y),
        visibility,
      },
      weather: simulationWeather,
      electrical,
      inverter: false,
      thermal: input.physics?.thermal,
    });
    closure ??= result.irradiance.ghiClosure;
    idealDcPowerW += result.dcPowerW;
    poaAreaW += result.poa.totalWm2 * baseSample.areaM2;
    temperatureAreaC += result.moduleTemperatureC * baseSample.areaM2;
    engineeringSamples.push({
      id: `${variant.variantId}:${engineeringSurfaceSpatialKey(baseSample)}`,
      areaM2: baseSample.areaM2,
      zoneId: baseSample.zoneId,
      zoneIndex: baseSample.zoneIndex,
      u: baseSample.u,
      v: baseSample.v,
      positionM: baseSample.positionM,
      poaWm2: result.solar.isDaylight
        ? result.effectivePoaWm2 * aggregateAvailability
        : 0,
      cellTemperatureC: result.moduleTemperatureC,
    });
    const regionId = baseSample.regionId ?? (surface.shape === "cylinder"
      ? (normalize(sample.normal).y > 0.5 ? "top" : "lateral")
      : "surface");
    const region = regions[regionId] ??= {
      areaM2: 0,
      directOpticalW: 0,
      diffuseOpticalW: 0,
      groundOpticalW: 0,
      dcPowerW: 0,
      acPowerW: 0,
    };
    region.areaM2 += baseSample.areaM2;
    region.directOpticalW += result.poa.directPoaWm2 * baseSample.areaM2;
    region.diffuseOpticalW += result.poa.diffusePoaWm2 * baseSample.areaM2;
    region.groundOpticalW += result.poa.groundPoaWm2 * baseSample.areaM2;
    region.dcPowerW += result.dcPowerW;
  }

  const engineering = surface.electricalModel === "explicit-series-parallel-bypass"
    && idealDcPowerW > 0
    ? solveEngineeringSurfaceElectrical(
        engineeringSamples,
        referenceCellConfig(
          electricalConfig,
          surface.engineeringConnection.nominalCellAreaM2,
          variant.referenceEfficiency,
        ),
        surface.engineeringConnection,
      )
    : undefined;
  const dcPowerW = engineering?.dcPowerW ?? idealDcPowerW;
  const parentScale = idealDcPowerW > 0 ? dcPowerW / idealDcPowerW : 0;
  Object.values(regions).forEach((region) => {
    region.dcPowerW *= parentScale;
    region.acPowerW = region.dcPowerW;
  });
  const fallbackClosure = closure ?? {
    residualWm2: 0,
    relativeResidual: 0,
    toleranceWm2: 0,
    isClosed: true,
  };
  return {
    dcPowerW,
    acPowerW: dcPowerW,
    motorPowerW: 0,
    poaWm2: poaAreaW / surface.activeAreaM2,
    moduleTemperatureC: temperatureAreaC / surface.activeAreaM2,
    mismatchLossFraction: engineering?.mismatchAndWiringLossFraction ?? 0,
    bypassActiveCount: engineering?.bypassActiveCount ?? 0,
    inverterStatus: "disabled",
    ghiClosure: { ...fallbackClosure, policy: "preserve-source-and-warn" },
    rotationIntervalAveraged: false,
    surfaceRegions: regions,
  };
}

function scalarStepReference(context: SimulationStepContext): SimulationPhysicsStepResult {
  const phases = rotationIntervalSamples(context);
  const results = phases.map((phase) => scalarAngleReference(context, phase.angleRad));
  const average = (selector: (result: SimulationPhysicsStepResult) => number) =>
    results.reduce((sum, result, index) => sum + selector(result) * phases[index].weight, 0);
  if (phases.length === 1) {
    return { ...results[0], rotationIntervalAveraged: phases[0].intervalAveraged };
  }
  const regionIds = new Set(results.flatMap((result) => Object.keys(result.surfaceRegions ?? {})));
  const surfaceRegions = Object.fromEntries([...regionIds].map((regionId) => {
    const weighted = (field: keyof SimulationSurfaceRegionResult) => results.reduce(
      (sum, result, index) =>
        sum + (result.surfaceRegions?.[regionId]?.[field] ?? 0) * phases[index].weight,
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
    motorPowerW: 0,
    poaWm2: average((result) => result.poaWm2),
    moduleTemperatureC: average((result) => result.moduleTemperatureC),
    mismatchLossFraction: average((result) => result.mismatchLossFraction),
    bypassActiveCount: average((result) => result.bypassActiveCount),
    inverterStatus: "disabled",
    ghiClosure: {
      residualWm2: average((result) => result.ghiClosure.residualWm2),
      relativeResidual: average((result) => result.ghiClosure.relativeResidual),
      toleranceWm2: average((result) => result.ghiClosure.toleranceWm2),
      isClosed: results.every((result) => result.ghiClosure.isClosed),
      policy: "preserve-source-and-warn",
    },
    rotationIntervalAveraged: true,
    surfaceRegions,
  };
}

function expectMachineClose(actual: number, expected: number): void {
  const tolerance = 128 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectEquivalent(
  actual: SimulationPhysicsStepResult,
  expected: SimulationPhysicsStepResult,
): void {
  for (const field of [
    "dcPowerW",
    "acPowerW",
    "poaWm2",
    "moduleTemperatureC",
    "mismatchLossFraction",
    "bypassActiveCount",
  ] as const) expectMachineClose(actual[field], expected[field]);
  for (const field of ["residualWm2", "relativeResidual", "toleranceWm2"] as const) {
    expectMachineClose(actual.ghiClosure[field], expected.ghiClosure[field]);
  }
  expect(actual.ghiClosure.isClosed).toBe(expected.ghiClosure.isClosed);
  expect(actual.rotationIntervalAveraged).toBe(expected.rotationIntervalAveraged);
  expect(actual.inverterStatus).toBe(expected.inverterStatus);
  expect(Object.keys(actual.surfaceRegions ?? {})).toEqual(Object.keys(expected.surfaceRegions ?? {}));
  for (const [regionId, expectedRegion] of Object.entries(expected.surfaceRegions ?? {})) {
    const actualRegion = actual.surfaceRegions?.[regionId];
    expect(actualRegion).toBeDefined();
    for (const field of Object.keys(expectedRegion) as Array<keyof SimulationSurfaceRegionResult>) {
      expectMachineClose(actualRegion![field], expectedRegion[field]);
    }
  }
}

function contextFor(
  shape: "sphere" | "plane",
  electricalModel: "local-mpp-area-integral" | "explicit-series-parallel-bypass",
  tracking = false,
): SimulationStepContext {
  const surface = shape === "plane"
    ? createComparisonSurface("plane", {
        landAreaM2: 0.05,
        maxHeightM: 0.5,
        planeTiltDeg: 0,
        planeTrackingMode: "dual-axis",
        footprintMode: "swept",
        groundClearanceM: 0,
        maximumActiveAreaM2: 1,
        maximumAspectRatio: 4,
        azimuthSamples: 16,
        meridionalSegments: 4,
      })
    : createContinuousSurface("sphere", 16);
  const continuousSurface = createContinuousSurfaceWorkItem(surface, {
    landAreaM2: surface.dimensions.footprintM2,
    surfaceOptions: {
      visibility: 0.93,
      diffuseVisibility: 0.81,
      groundVisibility: 0.64,
      albedo: 0.27,
      iam: { model: "ashrae", b0: 0.047 },
      diffuseModel: "hay-davies",
      soilingLossFraction: 0.021,
    },
    ...(electricalModel === "explicit-series-parallel-bypass"
      ? { electricalModel, engineeringConnection: CONNECTION }
      : { electricalModel }),
  });
  const start = Date.UTC(2026, 4, 17, 3);
  const weather = [0, 1].map((index) => ({
    timeUtcMs: start + index * HOUR_MS,
    ghiWm2: 713,
    dniWm2: 624,
    dhiWm2: 177,
    ambientC: 17.5,
    windSpeedMs: 3.2,
    windDirectionDeg: 238,
    gustMs: 4.1,
    cloudFraction: 0.17,
    precipitationMm: 0,
  }));
  const input: SimulationKernelInput = {
    mode: "annual",
    maximumGapHours: 2,
    weather,
    variants: [{
      variantId: `${shape}-${electricalModel}`,
      referenceEfficiency: 0.203,
      inverter: false,
      continuousSurface,
      ...(tracking
        ? { planeTracking: { mode: "dual-axis" as const, centreM: { x: 0, y: 0, z: 0 } } }
        : {
            rotation: { mode: "fixed" as const, rpm: 1, initialAngleRad: 0.37 },
            rotationPhaseSamples: 5,
            obstacleBounds: [{
              min: { x: -0.04, y: 0.02, z: -0.4 },
              max: { x: 0.04, y: 0.35, z: 0.4 },
            }],
          }),
    }],
    physics: {
      solarOverride: { azimuthDeg: 270, elevationDeg: 30 },
      electrical: {
        mode: "simple",
        config: DEFAULT_ELECTRICAL,
        aggregateLossFraction: 0.013,
      },
      weather: {
        referenceWindHeightM: 10,
        roughnessLengthM: 0.03,
        displacementHeightM: 0,
      },
      inverter: false,
    },
  };
  return { input, variant: input.variants[0], weather: weather[0], stepIndex: 0 };
}

describe("continuous-surface prepared batch equivalence", () => {
  it.each(["local-mpp-area-integral", "explicit-series-parallel-bypass"] as const)(
    "matches the former scalar sample pipeline at machine tolerance: %s",
    (electricalModel) => {
      const context = contextFor("sphere", electricalModel);
      const actual = computePhysicsStep(context) as SimulationPhysicsStepResult;
      expectEquivalent(actual, scalarStepReference(context));
    },
  );

  it("preserves plane tracking POA, height-dependent wind and Faiman semantics", () => {
    const context = contextFor("plane", "local-mpp-area-integral", true);
    const actual = computePhysicsStep(context) as SimulationPhysicsStepResult;
    expectEquivalent(actual, scalarStepReference(context));
  });
});
