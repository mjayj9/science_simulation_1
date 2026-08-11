import {
  PANEL_AREA_M2,
  type ContinuousSurfaceModel,
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
import type { TraceStage, Vec3 } from "./types";

export type ElectricalFairnessMode = "shared-circuit" | "independent-mppt";

export interface ContinuousSurfaceSimulationInput {
  surface: ContinuousSurfaceModel;
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
  rotationAngleRad?: number;
  albedo?: number;
  iam?: NonNullable<InstantSimulationInput["panel"]>["iam"];
  diffuseModel?: NonNullable<InstantSimulationInput["panel"]>["diffuseModel"];
  soilingLossFraction?: number;
  /** External-obstacle visibility only. Convex self-occlusion is n dot s. */
  visibilityAtSample?: (sample: SurfaceSample, sunDirection: Vec3) => number;
}

export interface ContinuousSurfaceSampleResult {
  sample: SurfaceSample;
  simulation: InstantSimulationResult;
  visibility: number;
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
  soilingLossW: number;
  temperatureAndModelLossW: number;
  mismatchLossW: number;
  bypassLossW: number;
  inverterLossW: number;
}

export interface ContinuousSurfaceSimulationResult {
  surface: ContinuousSurfaceModel;
  zones: ContinuousSurfaceZoneResult[];
  sharedCircuit: FairnessModeResult;
  independentMppt: FairnessModeResult;
  activeAreaM2: number;
  projectedAreaM2: number;
  maximumProjectedAreaM2: number;
  footprintM2: number;
  lossLedger: ContinuousSurfaceLossLedger;
  circuitPoints: IVPoint[];
}

function clamp01(value: number | undefined, fallback = 1): number {
  if (value === undefined) return fallback;
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Scale a 0.0025 m² zone nameplate to an equal-area integration sample. */
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

function optimizerBusVoltage(zones: readonly ContinuousSurfaceZoneResult[], inverter: InverterConfig): number {
  const natural = zones.reduce((sum, zone) => sum + zone.curve.mpp.voltageV, 0);
  const lower = Math.max(1e-6, inverter.mpptMinVoltageV);
  const upper = Math.max(lower, Math.min(inverter.mpptMaxVoltageV, inverter.maxDcVoltageV));
  return Math.min(upper, Math.max(lower, natural || lower));
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
  kind: ContinuousSurfaceModel["kind"],
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
    areaM2: PANEL_AREA_M2,
    u: 0,
    v: 0,
  };
  const rotated = rotateSurfaceSampleAroundY(representative, angleRad);
  return [rotated.position, rotated.normal];
}

export function simulateContinuousSurface(input: ContinuousSurfaceSimulationInput): ContinuousSurfaceSimulationResult {
  if (input.surface.zones.length !== 20) throw new RangeError("연속 PV 스킨은 정확히 20개 전기 구역이어야 합니다.");
  const angleRad = input.rotationAngleRad ?? 0;
  if (!Number.isFinite(angleRad)) throw new RangeError("곡면 회전각이 올바르지 않습니다.");

  const zones: ContinuousSurfaceZoneResult[] = input.surface.zones.map((zone) => {
    const samples = zone.samples.map((baseSample): ContinuousSurfaceSampleResult => {
      const sample = rotateSurfaceSampleAroundY(baseSample, angleRad);
      const sampleConfig = scaleElectricalConfigForArea(input.electricalConfig, sample.areaM2);
      const run = (visibility: number) => simulateInstant({
        timestamp: input.timestamp,
        location: input.location,
        solarOverride: input.solarOverride,
        irradiance: input.irradiance,
        panel: {
          normal: { x: sample.normal[0], y: sample.normal[1], z: sample.normal[2] },
          areaM2: sample.areaM2,
          efficiency: sampleConfig.efficiency,
          visibility,
          // Direct obstacle visibility cannot be reused as a sky-view factor.
          // A separate diffuse dome occlusion model is not supplied here.
          diffuseVisibility: 1,
          groundVisibility: 1,
          albedo: input.albedo,
          iam: input.iam,
          diffuseModel: input.diffuseModel,
          soilingLossFraction: input.soilingLossFraction,
          heightM: Math.max(0.01, sample.position[1]),
        },
        weather: input.weather,
        // Samples resolve POA, temperature and local DC. The electrical zone
        // receives one detailed I-V solve after area integration below.
        electrical: { mode: "simple", config: sampleConfig },
        inverter: false,
        thermal: input.thermal,
      });
      let simulation = run(1);
      const visibility = clamp01(input.visibilityAtSample?.(sample, simulation.sunDirection), 1);
      if (visibility !== 1) simulation = run(visibility);
      return { sample, simulation, visibility };
    });
    const integratedEffectivePoaWm2 = mean(samples, (sample) => sample.simulation.effectivePoaWm2);
    const integratedTemperatureC = mean(samples, (sample) => sample.simulation.moduleTemperatureC);
    const curve = singleDiodeCurve({
      irradianceWm2: integratedEffectivePoaWm2,
      cellTemperatureC: integratedTemperatureC,
      config: input.electricalConfig,
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
      independentMppPowerW: curve.mpp.powerW,
      operatingVoltageV: curve.mpp.voltageV,
      operatingCurrentA: curve.mpp.currentA,
      operatingPowerW: curve.mpp.powerW,
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

  const devices: CircuitDevice[] = zones.map((zone) => ({ id: zone.id, curve: zone.curve }));
  const circuit = calculateCircuit({ devices, topology: input.topology, bypassEnabled: input.bypassEnabled, bypassForwardVoltageV: 0.5 });
  const stateByZone = new Map<string, BypassState>(circuit.deviceStates.map((state) => [state.deviceId, state]));
  zones.forEach((zone) => {
    const state = stateByZone.get(zone.id);
    if (!state) return;
    zone.operatingVoltageV = state.voltageV;
    zone.operatingCurrentA = state.currentA;
    zone.operatingPowerW = Math.max(0, state.voltageV * state.currentA);
    zone.bypassActive = state.bypassConducting;
  });
  const independentDcW = zones.reduce((sum, zone) => sum + zone.independentMppPowerW, 0);
  const circuitLossW = Math.max(0, independentDcW - circuit.mpp.powerW);
  // Bypass is a subset attribution, not an extra loss. The residual is the
  // exclusive current-mismatch term so the ledger cannot double count.
  const bypassLossW = Math.min(circuitLossW, zones.reduce(
    (sum, zone) => sum + (zone.bypassActive ? zone.independentMppPowerW : 0),
    0,
  ));
  const mismatchLossW = Math.max(0, circuitLossW - bypassLossW);
  const sharedCircuit = modeResult("shared-circuit", circuit.mpp.powerW, circuit.mpp.voltageV, input.inverterConfig, mismatchLossW, bypassLossW, zones.filter((zone) => zone.bypassActive).length);
  const independentMppt = modeResult("independent-mppt", independentDcW, optimizerBusVoltage(zones, input.inverterConfig), input.inverterConfig, 0, 0, 0);

  const samples = zones.flatMap((zone) => zone.samples);
  const sunDirection = samples[0]?.simulation.sunDirection ?? { x: 0, y: 0, z: 0 };
  const direction: GeometryVec3 = [sunDirection.x, sunDirection.y, sunDirection.z];
  // These three skins are surfaces of revolution around Y. Their projected
  // area is therefore exactly invariant under a world-Y phase rotation. Use
  // the analytic integral here; the finite periodic optical quadrature is
  // independently convergence-tested and must not create a phase-dependent
  // runtime guard or a fake energy ripple.
  const projectedAreaM2 = projectedAreaForDirection(input.surface, direction);
  const efficiency = input.electricalConfig.efficiency;
  const dni = Math.max(0, samples[0]?.simulation.irradiance.dniWm2 ?? 0);
  const rawDirectDcW = dni * input.surface.dimensions.activeAreaM2 * efficiency;
  const projectedDirectDcW = dni * projectedAreaM2 * efficiency;
  const directAfterVisibilityDcW = samples.reduce((sum, sample) => sum + sample.simulation.poa.directPoaWm2 * sample.sample.areaM2 * efficiency, 0);
  const directBeforeVisibilityDcW = samples.reduce((sum, sample) => sum + dni * sample.simulation.poa.etaAngle * sample.sample.areaM2 * efficiency, 0);
  const diffuseAndGroundDcW = samples.reduce(
    (sum, sample) => sum + (sample.simulation.poa.diffusePoaWm2 + sample.simulation.poa.groundPoaWm2) * sample.sample.areaM2 * efficiency,
    0,
  );
  const beforeSoilingDcW = samples.reduce((sum, sample) => sum + sample.simulation.poa.totalWm2 * sample.sample.areaM2 * efficiency, 0);
  const afterSoilingDcW = samples.reduce((sum, sample) => sum + sample.simulation.effectivePoaWm2 * sample.sample.areaM2 * efficiency, 0);
  const lossLedger: ContinuousSurfaceLossLedger = {
    solarResourceDcW: rawDirectDcW + diffuseAndGroundDcW,
    projectionLossW: Math.max(0, rawDirectDcW - projectedDirectDcW),
    iamLossW: Math.max(0, projectedDirectDcW - directBeforeVisibilityDcW),
    externalOcclusionLossW: Math.max(0, directBeforeVisibilityDcW - directAfterVisibilityDcW),
    selfShadingLossW: 0,
    soilingLossW: Math.max(0, beforeSoilingDcW - afterSoilingDcW),
    // Keep this term signed: cold cells can outperform the reference-efficiency
    // resource baseline. Clamping that gain to zero breaks ledger closure.
    temperatureAndModelLossW: afterSoilingDcW - independentDcW,
    mismatchLossW,
    bypassLossW,
    inverterLossW: Math.max(0, circuit.mpp.powerW - sharedCircuit.acPowerW),
  };
  return {
    surface: input.surface,
    zones,
    sharedCircuit,
    independentMppt,
    activeAreaM2: input.surface.dimensions.activeAreaM2,
    projectedAreaM2,
    maximumProjectedAreaM2: input.surface.dimensions.maximumProjectedAreaM2,
    footprintM2: input.surface.dimensions.footprintM2,
    lossLedger,
    circuitPoints: circuit.points,
  };
}
