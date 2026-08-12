import {
  PANEL_AREA_M2,
  type IdealSurfaceModel,
  type SurfaceSample,
  type Vec3 as GeometryVec3,
  projectedAreaForDirection,
  rotateSurfaceSampleAroundY,
} from "../geometry";
import { calculateCircuit, interpolateCurrentAtVoltage, type BypassState, type CircuitDevice } from "./circuit";
import { singleDiodeCurve, type ElectricalConfig, type IVCurve, type IVPoint } from "./electrical";
import { calculateInverter, type InverterConfig, type InverterResult } from "./inverter";
import { simulateInstant, type InstantSimulationInput, type InstantSimulationResult } from "./pipeline";
import type { ThermalConfig } from "./thermal";
import { hemisphereViewFactors, type HemisphereViewFactors } from "./irradiance";
import type { TraceStage, Vec3 } from "./types";

export type ElectricalFairnessMode = "shared-circuit" | "independent-mppt";

export interface ContinuousSurfaceSimulationInput {
  surface: IdealSurfaceModel;
  timestamp: Date | string | number;
  solarOverride?: InstantSimulationInput["solarOverride"];
  location?: InstantSimulationInput["location"];
  irradiance: InstantSimulationInput["irradiance"];
  weather?: InstantSimulationInput["weather"];
  electricalConfig: ElectricalConfig;
  thermal?: ThermalConfig;
  inverterConfig: InverterConfig;
  topology: "series" | "parallel";
  bypassEnabled: boolean;
  /** Default is the ideal local-MPP area integral required for shape comparison. */
  electricalModel?: "ideal-continuous" | "distributed-circuit";
  rotationAngleRad?: number;
  albedo?: number;
  iam?: NonNullable<InstantSimulationInput["panel"]>["iam"];
  diffuseModel?: NonNullable<InstantSimulationInput["panel"]>["diffuseModel"];
  soilingLossFraction?: number;
  /**
   * Optional finite reflector/parcel area used to cap total ground-reflected
   * capture at rho * GHI * area. Omit for the legacy per-sample POA contract.
   */
  groundReflectorAreaM2?: number;
  /** External-obstacle visibility only. Convex self-occlusion is n dot s. */
  visibilityAtSample?: (sample: SurfaceSample, sunDirection: Vec3) => number;
}

export interface ContinuousSurfaceSampleResult {
  sample: SurfaceSample;
  simulation: InstantSimulationResult;
  visibility: number;
  /** Geometry-only isotropic factors; obstacle dome visibility is reported separately. */
  viewFactors: HemisphereViewFactors;
}

export interface ContinuousSurfaceZoneResult {
  id: string;
  label: string;
  index: number;
  areaM2: number;
  position: GeometryVec3;
  normal: GeometryVec3;
  samples: ContinuousSurfaceSampleResult[];
  curve: CircuitDevice["curve"];
  independentMppPowerW: number;
  operatingVoltageV: number;
  operatingCurrentA: number;
  operatingPowerW: number;
  bypassActive: boolean;
  averagePoaWm2: number;
  averageDirectPoaWm2: number;
  averageDiffusePoaWm2: number;
  averageGroundPoaWm2: number;
  averageEffectivePoaWm2: number;
  averageTemperatureC: number;
  averageAoiDeg: number;
  averageEtaCos: number;
  averageIam: number;
  averageEtaAngle: number;
  averageVisibility: number;
  trace: TraceStage[];
}

export interface FairnessModeResult {
  mode: ElectricalFairnessMode;
  dcPowerW: number;
  acPowerW: number;
  dcVoltageV: number;
  dcCurrentA: number;
  inverter: InverterResult;
  mismatchLossW: number;
  bypassLossW: number;
  bypassCount: number;
}

export interface ContinuousSurfaceLossLedger {
  solarResourceDcW: number;
  projectionLossW: number;
  iamLossW: number;
  externalOcclusionLossW: number;
  selfShadingLossW: number;
  groundReflectionCapLossW: number;
  soilingLossW: number;
  temperatureAndModelLossW: number;
  mismatchLossW: number;
  bypassLossW: number;
  inverterLossW: number;
}

export interface GroundReflectionBudget {
  /** Null preserves and explicitly identifies the legacy uncapped path. */
  reflectorAreaM2: number | null;
  /** Integral of F_ground dA over every surface sample. */
  rawGroundViewAreaM2: number;
  /** Integrated sample-level ground POA before the parcel-wide cap. */
  rawGroundCaptureW: number;
  /** rho * GHI * reflectorArea. Null when no cap was requested. */
  reflectorIncidentCapW: number | null;
  /** min(1, reflectorIncidentCapW / rawGroundCaptureW). */
  appliedScale: number;
  /** Integrated ground POA after the single global scale is applied. */
  boundedGroundCaptureW: number;
}

export interface SurfaceRegionBreakdown {
  id: "surface" | "top" | "lateral";
  labelKo: string;
  areaM2: number;
  directOpticalW: number;
  diffuseOpticalW: number;
  groundOpticalW: number;
  /** Zone MPP apportioned by sample effective-POA area; sums to independent DC. */
  independentMppDcW: number;
}

export interface ContinuousSurfaceSimulationResult {
  surface: IdealSurfaceModel;
  zones: ContinuousSurfaceZoneResult[];
  sharedCircuit: FairnessModeResult;
  independentMppt: FairnessModeResult;
  activeAreaM2: number;
  projectedAreaM2: number;
  maximumProjectedAreaM2: number;
  footprintM2: number;
  regionBreakdown: SurfaceRegionBreakdown[];
  groundReflectionBudget: GroundReflectionBudget;
  lossLedger: ContinuousSurfaceLossLedger;
  circuitPoints: IVPoint[];
}

function clamp01(value: number | undefined, fallback = 1): number {
  if (value === undefined) return fallback;
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Scale the reference-cell nameplate to an arbitrary electrical area. */
export function scaleElectricalConfigForArea(config: ElectricalConfig, areaM2: number): ElectricalConfig {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) throw new RangeError("전기 표본 면적이 올바르지 않습니다.");
  const ratio = areaM2 / PANEL_AREA_M2;
  return {
    ...config,
    areaM2,
    pmaxW: config.pmaxW * ratio,
    iscA: config.iscA * ratio,
    impA: config.impA * ratio,
    alphaIscAperC: config.alphaIscAperC * ratio,
    seriesResistanceOhm: config.seriesResistanceOhm / ratio,
    shuntResistanceOhm: config.shuntResistanceOhm / ratio,
  };
}

/** Parallel-integrates sub-area I-V curves into one electrical zone curve. */
export function combineParallelCurves(
  curves: readonly Pick<IVCurve, "points" | "iscA" | "vocV" | "mpp">[],
  points = 128,
): CircuitDevice["curve"] {
  if (curves.length === 0) throw new RangeError("결합할 I-V 곡선이 없습니다.");
  const vocV = Math.max(0, ...curves.map((curve) => curve.vocV));
  const iscA = curves.reduce((sum, curve) => sum + Math.max(0, curve.iscA), 0);
  if (!(vocV > 0) || !(iscA > 0)) {
    const zero: IVPoint = { voltageV: 0, currentA: 0, powerW: 0 };
    return { points: [zero], mpp: zero, iscA: 0, vocV: 0 };
  }
  const count = Math.max(32, Math.min(512, Math.round(points)));
  const combined: IVPoint[] = [];
  let mpp: IVPoint = { voltageV: 0, currentA: iscA, powerW: 0 };
  for (let index = 0; index < count; index += 1) {
    const voltageV = vocV * index / (count - 1);
    const currentA = curves.reduce((sum, curve) => sum + interpolateCurrentAtVoltage(curve, voltageV), 0);
    const point = { voltageV, currentA, powerW: voltageV * currentA };
    combined.push(point);
    if (point.powerW > mpp.powerW) mpp = point;
  }
  return { points: combined, mpp, iscA, vocV };
}

function mean(
  samples: readonly ContinuousSurfaceSampleResult[],
  selector: (sample: ContinuousSurfaceSampleResult) => number,
): number {
  const area = samples.reduce((sum, sample) => sum + sample.sample.areaM2, 0);
  return area > 0
    ? samples.reduce((sum, sample) => sum + selector(sample) * sample.sample.areaM2, 0) / area
    : 0;
}

export function validateContinuousSurfaceQuadrature(
  surface: Pick<IdealSurfaceModel, "dimensions" | "zones">,
): number {
  const activeAreaM2 = surface.dimensions.activeAreaM2;
  if (!Number.isFinite(activeAreaM2) || activeAreaM2 <= 0 || surface.zones.length < 1) {
    throw new RangeError("연속 PV 스킨의 활성면적과 표면 영역이 올바르지 않습니다.");
  }
  let integratedAreaM2 = 0;
  surface.zones.forEach((zone, zoneIndex) => {
    if (!Number.isFinite(zone.areaM2) || zone.areaM2 <= 0 || zone.samples.length < 1) {
      throw new RangeError(`연속 PV 표면 영역 ${zoneIndex}의 면적 또는 적분 샘플이 올바르지 않습니다.`);
    }
    const sampleAreaM2 = zone.samples.reduce((sum, sample, sampleIndex) => {
      if (
        !Number.isFinite(sample.areaM2) ||
        sample.areaM2 <= 0 ||
        [...sample.position, ...sample.normal].some((value) => !Number.isFinite(value)) ||
        Math.hypot(...sample.normal) < 1e-12
      ) {
        throw new RangeError(`연속 PV 표면 영역 ${zoneIndex}의 샘플 ${sampleIndex}가 올바르지 않습니다.`);
      }
      return sum + sample.areaM2;
    }, 0);
    const zoneTolerance = Math.max(1e-10, zone.areaM2 * 1e-8);
    if (Math.abs(sampleAreaM2 - zone.areaM2) > zoneTolerance) {
      throw new RangeError(`연속 PV 표면 영역 ${zoneIndex}의 샘플 면적 합이 영역 면적과 다릅니다.`);
    }
    integratedAreaM2 += sampleAreaM2;
  });
  const surfaceTolerance = Math.max(1e-10, activeAreaM2 * 1e-8);
  if (Math.abs(integratedAreaM2 - activeAreaM2) > surfaceTolerance) {
    throw new RangeError("연속 PV 스킨의 적분 샘플 면적 합이 해석적 활성면적과 다릅니다.");
  }
  return integratedAreaM2;
}

/** Integrates the geometry-only isotropic ground view factor over a surface. */
export function integratedGroundViewAreaM2(
  surface: Pick<IdealSurfaceModel, "zones">,
): number {
  return surface.zones.reduce(
    (zoneSum, zone) => zoneSum + zone.samples.reduce(
      (sampleSum, sample) => sampleSum + sample.areaM2 * hemisphereViewFactors({
        x: sample.normal[0],
        y: sample.normal[1],
        z: sample.normal[2],
      }).ground,
      0,
    ),
    0,
  );
}

/**
 * Parcel-wide multiplier for sample `groundVisibility`. Irradiance and
 * reflectance cancel from rho*GHI*A_reflector / (rho*GHI*integral(F_ground dA)),
 * so this pure geometry helper is shared by instant and worker paths.
 */
export function groundReflectionVisibilityScale(
  surface: Pick<IdealSurfaceModel, "zones">,
  reflectorAreaM2: number,
): number {
  if (!Number.isFinite(reflectorAreaM2) || reflectorAreaM2 <= 0) {
    throw new RangeError("Ground reflector area must be finite and greater than zero.");
  }
  const rawGroundViewAreaM2 = integratedGroundViewAreaM2(surface);
  return rawGroundViewAreaM2 > 0
    ? Math.min(1, reflectorAreaM2 / rawGroundViewAreaM2)
    : 1;
}

function idealContinuousBusVoltage(
  dcPowerW: number,
  electrical: ElectricalConfig,
  inverter: InverterConfig,
): number {
  const lower = Math.max(1e-6, inverter.mpptMinVoltageV);
  const upper = Math.max(lower, Math.min(inverter.mpptMaxVoltageV, inverter.maxDcVoltageV));
  const currentCompatible = inverter.maxInputCurrentA > 0
    ? dcPowerW / inverter.maxInputCurrentA
    : upper;
  return Math.min(upper, Math.max(lower, electrical.vmpV, currentCompatible));
}

function modeResult(
  mode: ElectricalFairnessMode,
  dcPowerW: number,
  dcVoltageV: number,
  inverterConfig: InverterConfig,
  mismatchLossW: number,
  bypassLossW: number,
  bypassCount: number,
): FairnessModeResult {
  const dcCurrentA = dcVoltageV > 0 ? dcPowerW / dcVoltageV : 0;
  const inverter = calculateInverter({ dcPowerW, dcVoltageV, dcCurrentA, config: inverterConfig });
  return { mode, dcPowerW: inverter.acceptedDcPowerW, acPowerW: inverter.acPowerW, dcVoltageV, dcCurrentA, inverter, mismatchLossW, bypassLossW, bypassCount };
}

function representativeRotated(
  kind: IdealSurfaceModel["kind"],
  index: number,
  position: GeometryVec3,
  normal: GeometryVec3,
  angleRad: number,
): readonly [GeometryVec3, GeometryVec3] {
  const representative: SurfaceSample = {
    zoneId: `${kind}-zone-${index + 1}`,
    zoneIndex: index,
    position,
    normal,
    areaM2: 1,
    u: 0,
    v: 0,
  };
  const rotated = rotateSurfaceSampleAroundY(representative, angleRad);
  return [rotated.position, rotated.normal];
}

export function simulateContinuousSurface(input: ContinuousSurfaceSimulationInput): ContinuousSurfaceSimulationResult {
  validateContinuousSurfaceQuadrature(input.surface);
  const defaultIdealContinuous = input.electricalModel !== "distributed-circuit";
  const angleRad = input.rotationAngleRad ?? 0;
  const reflectorAreaM2 = input.groundReflectorAreaM2;
  if (reflectorAreaM2 !== undefined && (!Number.isFinite(reflectorAreaM2) || reflectorAreaM2 <= 0)) {
    throw new RangeError("Ground reflector area must be finite and greater than zero.");
  }
  const albedo = clamp01(input.albedo, 0.2);
  const rawGroundViewAreaM2 = integratedGroundViewAreaM2(input.surface);
  const reflectorIncidentCapW = reflectorAreaM2 === undefined
    ? null
    : Math.max(0, input.irradiance.ghiWm2) * albedo * reflectorAreaM2;
  const groundReflectionScale = reflectorAreaM2 === undefined
    ? 1
    : groundReflectionVisibilityScale(input.surface, reflectorAreaM2);
  if (!Number.isFinite(angleRad)) throw new RangeError("곡면 회전각이 올바르지 않습니다.");

  const zones: ContinuousSurfaceZoneResult[] = input.surface.zones.map((zone) => {
    const samples = zone.samples.map((baseSample): ContinuousSurfaceSampleResult => {
      const sample = rotateSurfaceSampleAroundY(baseSample, angleRad);
      const run = (visibility: number) => simulateInstant({
        timestamp: input.timestamp,
        location: input.location,
        solarOverride: input.solarOverride,
        irradiance: input.irradiance,
        panel: {
          normal: { x: sample.normal[0], y: sample.normal[1], z: sample.normal[2] },
          areaM2: sample.areaM2,
          efficiency: input.electricalConfig.efficiency,
          visibility,
          // Direct obstacle visibility cannot be reused as a sky-view factor.
          // A separate diffuse dome occlusion model is not supplied here.
          diffuseVisibility: 1,
          groundVisibility: groundReflectionScale,
          albedo: input.albedo,
          iam: input.iam,
          diffuseModel: input.diffuseModel,
          soilingLossFraction: input.soilingLossFraction,
          heightM: Math.max(0.01, sample.position[1]),
        },
        weather: input.weather,
        // Samples resolve POA, temperature and local DC. The electrical zone
        // receives one detailed I-V solve after area integration below.
        electrical: { mode: "simple", config: input.electricalConfig },
        inverter: false,
        thermal: input.thermal,
      });
      let simulation = run(1);
      const visibility = clamp01(input.visibilityAtSample?.(sample, simulation.sunDirection), 1);
      if (visibility !== 1) simulation = run(visibility);
      return {
        sample,
        simulation,
        visibility,
        viewFactors: {
          sky: simulation.poa.skyViewFactor,
          ground: simulation.poa.groundViewFactor,
        },
      };
    });
    const localMppPowerW = samples.reduce(
      (sum, sample) => sum + sample.simulation.dcPowerW,
      0,
    );
    const integratedEffectivePoaWm2 = mean(samples, (sample) => sample.simulation.effectivePoaWm2);
    const integratedTemperatureC = mean(samples, (sample) => sample.simulation.moduleTemperatureC);
    // The ideal continuous-skin result is an absolute-area integral, so its
    // diagnostic I-V envelope must not inherit the legacy 5 cm x 5 cm cell
    // nameplate. Area scaling is reserved for the opt-in distributed circuit.
    const zoneConfig = defaultIdealContinuous
      ? input.electricalConfig
      : scaleElectricalConfigForArea(input.electricalConfig, zone.areaM2);
    const curve = defaultIdealContinuous
      ? (() => {
          const voltageV = Math.max(1e-6, zoneConfig.vmpV);
          const currentA = localMppPowerW / voltageV;
          const vocV = Math.max(voltageV, zoneConfig.vocV);
          const mpp = { voltageV, currentA, powerW: localMppPowerW };
          return {
            points: [
              { voltageV: 0, currentA, powerW: 0 },
              mpp,
              { voltageV: vocV, currentA: 0, powerW: 0 },
            ],
            mpp,
            iscA: currentA,
            vocV,
          };
        })()
      : singleDiodeCurve({
          irradianceWm2: integratedEffectivePoaWm2,
          cellTemperatureC: integratedTemperatureC,
          config: zoneConfig,
          points: 64,
        });
    const [position, normal] = representativeRotated(input.surface.kind, zone.index, zone.representativePosition, zone.representativeNormal, angleRad);
    return {
      id: zone.id,
      label: `Z-${String(zone.index + 1).padStart(2, "0")}`,
      index: zone.index,
      areaM2: zone.areaM2,
      position,
      normal,
      samples,
      curve,
      independentMppPowerW: localMppPowerW,
      operatingVoltageV: curve.mpp.voltageV,
      operatingCurrentA: curve.mpp.currentA,
      operatingPowerW: localMppPowerW,
      bypassActive: false,
      averagePoaWm2: mean(samples, (sample) => sample.simulation.poa.totalWm2),
      averageDirectPoaWm2: mean(samples, (sample) => sample.simulation.poa.directPoaWm2),
      averageDiffusePoaWm2: mean(samples, (sample) => sample.simulation.poa.diffusePoaWm2),
      averageGroundPoaWm2: mean(samples, (sample) => sample.simulation.poa.groundPoaWm2),
      averageEffectivePoaWm2: mean(samples, (sample) => sample.simulation.effectivePoaWm2),
      averageTemperatureC: mean(samples, (sample) => sample.simulation.moduleTemperatureC),
      averageAoiDeg: mean(samples, (sample) => sample.simulation.poa.angleOfIncidenceDeg),
      averageEtaCos: mean(samples, (sample) => sample.simulation.poa.etaCos),
      averageIam: mean(samples, (sample) => sample.simulation.poa.iamFactor),
      averageEtaAngle: mean(samples, (sample) => sample.simulation.poa.etaAngle),
      averageVisibility: mean(samples, (sample) => sample.visibility),
      trace: samples[0]?.simulation.trace ?? [],
    };
  });

  const circuit = defaultIdealContinuous
    ? null
    : calculateCircuit({
        devices: zones.map((zone): CircuitDevice => ({ id: zone.id, curve: zone.curve })),
        topology: input.topology,
        bypassEnabled: input.bypassEnabled,
        bypassForwardVoltageV: 0.5,
      });
  const stateByZone = new Map<string, BypassState>(
    circuit?.deviceStates.map((state) => [state.deviceId, state]) ?? [],
  );
  if (circuit) zones.forEach((zone) => {
    const state = stateByZone.get(zone.id);
    if (!state) return;
    zone.operatingVoltageV = state.voltageV;
    zone.operatingCurrentA = state.currentA;
    zone.operatingPowerW = Math.max(0, state.voltageV * state.currentA);
    zone.bypassActive = state.bypassConducting;
  });
  // The comparison result is the direct surface integral of local ideal-MPP
  // power. Regions/zones are reporting partitions only and never constrain one
  // another electrically.
  const independentDcW = zones.reduce(
    (zoneSum, zone) => zoneSum + zone.samples.reduce(
      (sampleSum, sample) => sampleSum + sample.simulation.dcPowerW,
      0,
    ),
    0,
  );
  const circuitLossW = circuit ? Math.max(0, independentDcW - circuit.mpp.powerW) : 0;
  // Bypass is a subset attribution, not an extra loss. The residual is the
  // exclusive current-mismatch term so the ledger cannot double count.
  const bypassLossW = Math.min(circuitLossW, zones.reduce(
    (sum, zone) => sum + (zone.bypassActive ? zone.independentMppPowerW : 0),
    0,
  ));
  const mismatchLossW = Math.max(0, circuitLossW - bypassLossW);
  const independentMppt = modeResult(
    "independent-mppt",
    independentDcW,
    idealContinuousBusVoltage(independentDcW, input.electricalConfig, input.inverterConfig),
    input.inverterConfig,
    0,
    0,
    0,
  );
  const sharedCircuit = circuit
    ? modeResult("shared-circuit", circuit.mpp.powerW, circuit.mpp.voltageV, input.inverterConfig, mismatchLossW, bypassLossW, zones.filter((zone) => zone.bypassActive).length)
    : independentMppt;
  const primaryResult = defaultIdealContinuous ? independentMppt : sharedCircuit;

  const cylinderTopFraction = input.surface.kind === "cylinder"
    && input.surface.dimensions.includesTopDisk
    && input.surface.dimensions.radiusM !== undefined
    ? Math.PI * input.surface.dimensions.radiusM ** 2 / input.surface.dimensions.activeAreaM2
    : null;
  const regionMap = new Map<SurfaceRegionBreakdown["id"], SurfaceRegionBreakdown>();
  const ensureRegion = (id: SurfaceRegionBreakdown["id"]) => {
    const existing = regionMap.get(id);
    if (existing) return existing;
    const created: SurfaceRegionBreakdown = {
      id,
      labelKo: id === "top" ? "윗면" : id === "lateral" ? "옆면" : "전체 표면",
      areaM2: 0,
      directOpticalW: 0,
      diffuseOpticalW: 0,
      groundOpticalW: 0,
      independentMppDcW: 0,
    };
    regionMap.set(id, created);
    return created;
  };
  zones.forEach((zone) => {
    zone.samples.forEach((sample) => {
      const regionId: SurfaceRegionBreakdown["id"] = cylinderTopFraction === null
        ? "surface"
        : sample.sample.u < cylinderTopFraction
          ? "top"
          : "lateral";
      const region = ensureRegion(regionId);
      const areaM2 = sample.sample.areaM2;
      region.areaM2 += areaM2;
      region.directOpticalW += sample.simulation.poa.directPoaWm2 * areaM2;
      region.diffuseOpticalW += sample.simulation.poa.diffusePoaWm2 * areaM2;
      region.groundOpticalW += sample.simulation.poa.groundPoaWm2 * areaM2;
      region.independentMppDcW += sample.simulation.dcPowerW;
    });
  });
  const regionBreakdown = [...regionMap.values()];
  const acceptedScale = independentDcW > 0
    ? independentMppt.dcPowerW / independentDcW
    : 0;
  regionBreakdown.forEach((region) => {
    region.independentMppDcW *= acceptedScale;
  });

  const samples = zones.flatMap((zone) => zone.samples);
  const boundedGroundCaptureW = samples.reduce(
    (sum, sample) => sum + sample.simulation.poa.groundPoaWm2 * sample.sample.areaM2,
    0,
  );
  const rawGroundCaptureW = groundReflectionScale > 0
    ? boundedGroundCaptureW / groundReflectionScale
    : 0;
  const groundReflectionBudget: GroundReflectionBudget = {
    reflectorAreaM2: reflectorAreaM2 ?? null,
    rawGroundViewAreaM2,
    rawGroundCaptureW,
    reflectorIncidentCapW,
    appliedScale: groundReflectionScale,
    boundedGroundCaptureW,
  };
  const sunDirection = samples[0]?.simulation.sunDirection ?? { x: 0, y: 0, z: 0 };
  const direction: GeometryVec3 = [sunDirection.x, sunDirection.y, sunDirection.z];
  // projectedAreaForDirection operates in the model's unrotated frame.
  // R(n)·s = n·R^-1(s), so rotate the sun direction by -angle here. This is
  // essential for the asymmetric plane/cube and harmless for Y-axis skins.
  const cosineAngle = Math.cos(angleRad);
  const sineAngle = Math.sin(angleRad);
  const directionInSurfaceFrame: GeometryVec3 = [
    cosineAngle * direction[0] - sineAngle * direction[2],
    direction[1],
    sineAngle * direction[0] + cosineAngle * direction[2],
  ];
  // These three skins are surfaces of revolution around Y. Their projected
  // area is therefore exactly invariant under a world-Y phase rotation. Use
  // the analytic integral here; the finite periodic optical quadrature is
  // independently convergence-tested and must not create a phase-dependent
  // runtime guard or a fake energy ripple.
  const projectedAreaM2 = projectedAreaForDirection(input.surface, directionInSurfaceFrame);
  const efficiency = input.electricalConfig.efficiency;
  const dni = Math.max(0, samples[0]?.simulation.irradiance.dniWm2 ?? 0);
  const rawDirectDcW = dni * input.surface.dimensions.activeAreaM2 * efficiency;
  const projectedDirectDcW = dni * projectedAreaM2 * efficiency;
  const directAfterVisibilityDcW = samples.reduce((sum, sample) => sum + sample.simulation.poa.directPoaWm2 * sample.sample.areaM2 * efficiency, 0);
  const directBeforeVisibilityDcW = samples.reduce((sum, sample) => sum + dni * sample.simulation.poa.etaAngle * sample.sample.areaM2 * efficiency, 0);
  const diffuseDcW = samples.reduce(
    (sum, sample) => sum + sample.simulation.poa.diffusePoaWm2 * sample.sample.areaM2 * efficiency,
    0,
  );
  const beforeSoilingDcW = samples.reduce((sum, sample) => sum + sample.simulation.poa.totalWm2 * sample.sample.areaM2 * efficiency, 0);
  const afterSoilingDcW = samples.reduce((sum, sample) => sum + sample.simulation.effectivePoaWm2 * sample.sample.areaM2 * efficiency, 0);
  const lossLedger: ContinuousSurfaceLossLedger = {
    solarResourceDcW: rawDirectDcW + diffuseDcW + rawGroundCaptureW * efficiency,
    projectionLossW: Math.max(0, rawDirectDcW - projectedDirectDcW),
    iamLossW: Math.max(0, projectedDirectDcW - directBeforeVisibilityDcW),
    externalOcclusionLossW: Math.max(0, directBeforeVisibilityDcW - directAfterVisibilityDcW),
    selfShadingLossW: 0,
    groundReflectionCapLossW: Math.max(0, rawGroundCaptureW - boundedGroundCaptureW) * efficiency,
    soilingLossW: Math.max(0, beforeSoilingDcW - afterSoilingDcW),
    // Keep this term signed: cold cells can outperform the reference-efficiency
    // resource baseline. Clamping that gain to zero breaks ledger closure.
    temperatureAndModelLossW: afterSoilingDcW - independentDcW,
    mismatchLossW: defaultIdealContinuous ? 0 : mismatchLossW,
    bypassLossW: defaultIdealContinuous ? 0 : bypassLossW,
    inverterLossW: Math.max(0, independentDcW - primaryResult.acPowerW),
  };
  return {
    surface: input.surface,
    zones,
    // Backward-compatible field name: the default comparison contract is now
    // the ideal continuous result. The distributed-circuit model remains an
    // explicit advanced option.
    sharedCircuit: defaultIdealContinuous ? independentMppt : sharedCircuit,
    independentMppt,
    activeAreaM2: input.surface.dimensions.activeAreaM2,
    projectedAreaM2,
    maximumProjectedAreaM2: input.surface.dimensions.maximumProjectedAreaM2,
    footprintM2: input.surface.dimensions.footprintM2,
    regionBreakdown,
    groundReflectionBudget,
    lossLedger,
    circuitPoints: circuit?.points ?? (() => {
      const mpp: IVPoint = {
        voltageV: independentMppt.dcVoltageV,
        currentA: independentMppt.dcCurrentA,
        powerW: independentMppt.dcPowerW,
      };
      return [
        { voltageV: 0, currentA: mpp.currentA, powerW: 0 },
        mpp,
        { voltageV: Math.max(mpp.voltageV, input.electricalConfig.vocV), currentA: 0, powerW: 0 },
      ];
    })(),
  };
}
