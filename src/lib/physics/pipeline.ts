import type { ElectricalConfig, IVCurve } from "./electrical";
import {
  DEFAULT_ELECTRICAL,
  simpleDcPower,
  singleDiodeCurve,
} from "./electrical";
import type { InverterConfig, InverterResult } from "./inverter";
import { DEFAULT_INVERTER, calculateInverter } from "./inverter";
import type { IAMConfig, IrradianceComponents, POAResult } from "./irradiance";
import { calculatePOA, checkGHIClosure, erbsDecomposition } from "./irradiance";
import { integrateTrapezoid } from "./integration";
import type { SolarPositionInput, SolarPositionResult } from "./solar";
import {
  extraterrestrialNormalIrradiance,
  solarPosition,
  sunVector,
} from "./solar";
import type { ThermalConfig } from "./thermal";
import { DEFAULT_THERMAL, faimanTemperature } from "./thermal";
import type { TraceStage, Vec3 } from "./types";
import { clamp } from "./types";
import { logWindSpeed } from "./environment";
import type { PanelFrame } from "./rotation";
import { createPanelFrame, fixedRotation, rotatePanelFrameAroundY } from "./rotation";

export interface InstantSimulationInput {
  timestamp: Date | string | number;
  location?: Omit<SolarPositionInput, "timestamp">;
  solarOverride?: { azimuthDeg: number; elevationDeg: number };
  irradiance: {
    ghiWm2: number;
    dniWm2?: number;
    dhiWm2?: number;
  };
  panel?: {
    /** Body-frame front normal when rotation is supplied; otherwise world normal. */
    normal?: Vec3;
    /** Optional local in-plane ray-sampling axis; rotated with the normal. */
    sampleAxisU?: Vec3;
    areaM2?: number;
    efficiency?: number;
    visibility?: number;
    diffuseVisibility?: number;
    groundVisibility?: number;
    albedo?: number;
    iam?: IAMConfig;
    diffuseModel?: "hay-davies" | "isotropic";
    soilingLossFraction?: number;
    heightM?: number;
  };
  weather?: {
    ambientTemperatureC?: number;
    referenceWindSpeedMS?: number;
    referenceWindHeightM?: number;
    roughnessLengthM?: number;
    displacementHeightM?: number;
    pressurePa?: number;
  };
  electrical?: {
    mode?: "simple" | "single-diode";
    config?: ElectricalConfig;
    aggregateLossFraction?: number;
  };
  inverter?: InverterConfig | false;
  thermal?: ThermalConfig;
  rotation?:
    | { mode: "static"; angleRad?: number }
    | { mode: "fixed"; rpm: number; initialAngleRad?: number; referenceTimestamp?: Date | string | number };
}

export interface InstantSimulationResult {
  timestampMs: number;
  solar: SolarPositionResult;
  sunDirection: Vec3;
  irradiance: IrradianceComponents;
  poa: POAResult;
  panelNormal: Vec3;
  panelFrame: PanelFrame;
  moduleWindSpeedMS: number;
  moduleTemperatureC: number;
  /** POA after soiling only; angle loss is already included in poa.totalWm2. */
  effectivePoaWm2: number;
  dcPowerW: number;
  dcVoltageV: number;
  dcCurrentA: number;
  ivCurve?: IVCurve;
  inverter: InverterResult;
  trace: TraceStage[];
}

function timestampMs(value: Date | string | number): number {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(result)) throw new RangeError("Invalid simulation timestamp");
  return result;
}

function makeManualSolar(
  timestamp: Date | string | number,
  override: { azimuthDeg: number; elevationDeg: number },
): SolarPositionResult {
  return {
    azimuthDeg: ((override.azimuthDeg % 360) + 360) % 360,
    elevationDeg: clamp(override.elevationDeg, -90, 90),
    geometricElevationDeg: clamp(override.elevationDeg, -90, 90),
    zenithDeg: 90 - clamp(override.elevationDeg, -90, 90),
    declinationDeg: 0,
    hourAngleDeg: 0,
    equationOfTimeMinutes: 0,
    sunEarthDistanceAu: 1,
    julianDay: timestampMs(timestamp) / 86_400_000 + 2_440_587.5,
    isDaylight: override.elevationDeg > 0,
  };
}

type SolarContextInput = Pick<
  InstantSimulationInput,
  "location" | "solarOverride" | "weather"
>;

function resolveSolar(
  timestamp: Date | string | number,
  input: SolarContextInput,
): SolarPositionResult {
  if (input.solarOverride) return makeManualSolar(timestamp, input.solarOverride);
  const ambientTemperatureC = input.weather?.ambientTemperatureC ?? 25;
  return solarPosition({
    timestamp,
    latitudeDeg: input.location?.latitudeDeg ?? 37.5665,
    longitudeDeg: input.location?.longitudeDeg ?? 126.978,
    elevationM: input.location?.elevationM ?? 38,
    pressureHPa:
      input.location?.pressureHPa ??
      (input.weather?.pressurePa === undefined ? undefined : input.weather.pressurePa / 100),
    temperatureC: input.location?.temperatureC ?? ambientTemperatureC,
    deltaTSeconds: input.location?.deltaTSeconds,
    deltaUt1Seconds: input.location?.deltaUt1Seconds,
    applyRefraction: input.location?.applyRefraction,
  });
}

/**
 * Deterministic no-network fallback for daily-series generation.
 *
 * Haurwitz supplies clear-sky GHI from solar zenith, then the shared Erbs
 * implementation derives a horizontally closed DNI/DHI pair. This replaces
 * the former hard-coded irradiance triplet; no time-of-day scale factors are
 * applied. Formula references:
 * https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.haurwitz.html
 * https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.erbs.html
 */
function defaultDailyClearSkyIrradiance(
  solar: SolarPositionResult,
): InstantSimulationInput["irradiance"] {
  const cosineZenith = solar.isDaylight
    ? Math.max(0, Math.cos(solar.zenithDeg * Math.PI / 180))
    : 0;
  if (!(cosineZenith > 0)) {
    return { ghiWm2: 0, dniWm2: 0, dhiWm2: 0 };
  }
  const ghiWm2 = 1_098 * cosineZenith * Math.exp(-0.059 / cosineZenith);
  const components = erbsDecomposition({
    ghiWm2,
    solarZenithDeg: solar.zenithDeg,
    extraterrestrialNormalWm2: extraterrestrialNormalIrradiance(solar),
  });
  return {
    ghiWm2: components.ghiWm2,
    dniWm2: components.dniWm2,
    dhiWm2: components.dhiWm2,
  };
}

function normalizeIrradiance(
  input: InstantSimulationInput["irradiance"],
  solar: SolarPositionResult,
): IrradianceComponents {
  if (!solar.isDaylight) {
    return {
      ghiWm2: 0,
      dniWm2: 0,
      dhiWm2: 0,
      clearnessIndex: 0,
      diffuseFraction: 0,
      ghiClosure: checkGHIClosure({ ghiWm2: 0, dniWm2: 0, dhiWm2: 0, solarZenithDeg: solar.zenithDeg }),
    };
  }
  const ghi = Math.max(0, input.ghiWm2);
  const cosineZenith = Math.max(0, Math.cos(solar.zenithDeg * Math.PI / 180));
  if (input.dniWm2 === undefined && input.dhiWm2 === undefined) {
    return erbsDecomposition({
      ghiWm2: ghi,
      solarZenithDeg: solar.zenithDeg,
      extraterrestrialNormalWm2: extraterrestrialNormalIrradiance(solar),
    });
  }
  const dni = input.dniWm2 === undefined
    ? cosineZenith > 1e-6
      ? Math.max(0, (ghi - Math.max(0, input.dhiWm2 ?? 0)) / cosineZenith)
      : 0
    : Math.max(0, input.dniWm2);
  const dhi = input.dhiWm2 === undefined
    ? clamp(ghi - dni * cosineZenith, 0, ghi)
    : Math.max(0, input.dhiWm2);
  return {
    ghiWm2: ghi,
    dniWm2: dni,
    dhiWm2: dhi,
    clearnessIndex: 0,
    diffuseFraction: ghi > 0 ? dhi / ghi : 0,
    ghiClosure: checkGHIClosure({
      ghiWm2: ghi,
      dniWm2: dni,
      dhiWm2: dhi,
      solarZenithDeg: solar.zenithDeg,
    }),
  };
}

function worldPanelFrame(input: InstantSimulationInput, nowMs: number): PanelFrame {
  const base = createPanelFrame({
    normal: input.panel?.normal ?? { x: 0, y: 1, z: 0 },
    sampleAxisU: input.panel?.sampleAxisU,
  });
  const rotation = input.rotation;
  if (!rotation) return base;
  if (rotation.mode === "static") return rotatePanelFrameAroundY(base, rotation.angleRad ?? 0);
  const referenceMs = rotation.referenceTimestamp === undefined
    ? nowMs
    : timestampMs(rotation.referenceTimestamp);
  const state = fixedRotation(
    rotation.initialAngleRad ?? 0,
    rotation.rpm,
    (nowMs - referenceMs) / 1000,
  );
  return rotatePanelFrameAroundY(base, state.angleRad);
}

function offInverter(config: InverterConfig): InverterResult {
  return calculateInverter({ dcPowerW: 0, config });
}

export function simulateInstant(input: InstantSimulationInput): InstantSimulationResult {
  const nowMs = timestampMs(input.timestamp);
  const ambientTemperatureC = input.weather?.ambientTemperatureC ?? 25;
  const solar = resolveSolar(input.timestamp, input);
  const sunDirection = sunVector(solar);
  const irradiance = normalizeIrradiance(input.irradiance, solar);
  const panelFrame = worldPanelFrame(input, nowMs);
  const panelNormal = panelFrame.normal;
  const poa = calculatePOA({
    ...irradiance,
    solarZenithDeg: solar.zenithDeg,
    sunDirection,
    panelNormal,
    visibility: input.panel?.visibility,
    diffuseVisibility: input.panel?.diffuseVisibility,
    groundVisibility: input.panel?.groundVisibility,
    albedo: input.panel?.albedo,
    iam: input.panel?.iam,
    diffuseModel: input.panel?.diffuseModel,
    extraterrestrialNormalWm2: extraterrestrialNormalIrradiance(solar),
  });

  const referenceWindSpeedMS = Math.max(0, input.weather?.referenceWindSpeedMS ?? 4);
  let moduleWindSpeedMS = referenceWindSpeedMS;
  try {
    moduleWindSpeedMS = logWindSpeed({
      referenceWindSpeedMS,
      heightM: input.panel?.heightM ?? 1,
      referenceHeightM: input.weather?.referenceWindHeightM ?? 10,
      roughnessLengthM: input.weather?.roughnessLengthM ?? 0.03,
      displacementHeightM: input.weather?.displacementHeightM ?? 0,
    });
  } catch {
    // A low panel can be outside the neutral log layer. Keeping the supplied
    // reference wind is explicit and finite; callers can surface the trace.
    moduleWindSpeedMS = referenceWindSpeedMS;
  }
  const moduleTemperatureC = faimanTemperature(
    ambientTemperatureC,
    poa.totalWm2,
    moduleWindSpeedMS,
    input.thermal ?? DEFAULT_THERMAL,
  );
  const baseElectrical = input.electrical?.config ?? DEFAULT_ELECTRICAL;
  const electrical: ElectricalConfig = {
    ...baseElectrical,
    areaM2: input.panel?.areaM2 ?? baseElectrical.areaM2,
    efficiency: input.panel?.efficiency ?? baseElectrical.efficiency,
  };
  // POA already contains η_cos and IAM. Downstream electrical models consume
  // this value directly and must not multiply either angle factor again.
  const effectivePoa = poa.totalWm2 * (1 - clamp(input.panel?.soilingLossFraction ?? 0, 0, 1));
  let dcPowerW = 0;
  let dcVoltageV = 0;
  let dcCurrentA = 0;
  let ivCurve: IVCurve | undefined;
  const electricalMode = input.electrical?.mode ?? "simple";
  if (solar.isDaylight && effectivePoa > 0) {
    if (electricalMode === "single-diode") {
      ivCurve = singleDiodeCurve({
        irradianceWm2: effectivePoa,
        cellTemperatureC: moduleTemperatureC,
        config: electrical,
      });
      dcPowerW = ivCurve.mpp.powerW;
      dcVoltageV = ivCurve.mpp.voltageV;
      dcCurrentA = ivCurve.mpp.currentA;
    } else {
      dcPowerW = simpleDcPower(
        effectivePoa,
        moduleTemperatureC,
        electrical,
        input.electrical?.aggregateLossFraction,
      );
      const irradianceRatio = effectivePoa / electrical.referenceIrradianceWm2;
      dcVoltageV = dcPowerW > 0 ? Math.max(1e-6, electrical.vmpV * (1 - 0.002 * (moduleTemperatureC - electrical.referenceTemperatureC))) : 0;
      dcCurrentA = dcVoltageV > 0 ? dcPowerW / dcVoltageV : electrical.impA * irradianceRatio;
    }
  }
  const inverterConfig = input.inverter === false ? { ...DEFAULT_INVERTER, ratedAcPowerW: Number.MAX_VALUE, nominalEfficiency: 1 } : input.inverter ?? DEFAULT_INVERTER;
  const inverter = input.inverter === false
    ? {
        acceptedDcPowerW: dcPowerW,
        acPowerW: dcPowerW,
        grossAcPowerW: dcPowerW,
        efficiency: dcPowerW > 0 ? 1 : 0,
        clippingLossW: 0,
        wiringLossW: 0,
        standbyConsumptionW: 0,
        status: dcPowerW > 0 ? "running" as const : "off" as const,
      }
    : solar.isDaylight
      ? calculateInverter({ dcPowerW, dcVoltageV, dcCurrentA, config: inverterConfig })
      : offInverter(inverterConfig);

  const trace: TraceStage[] = [
    {
      modelId: "solar.noaa-spa-compatible",
      inputs: { timestampMs: nowMs },
      outputs: { elevationDeg: solar.elevationDeg, azimuthDeg: solar.azimuthDeg },
    },
    {
      modelId: "poa.hay-davies",
      inputs: {
        ghiWm2: irradiance.ghiWm2,
        dniWm2: irradiance.dniWm2,
        dhiWm2: irradiance.dhiWm2,
        ghiClosureResidualWm2: irradiance.ghiClosure.residualWm2,
      },
      outputs: {
        etaCos: poa.etaCos,
        iamFactor: poa.iamFactor,
        etaAngle: poa.etaAngle,
        solarZenithMismatchDeg: poa.solarZenithMismatchDeg,
        directPoaWm2: poa.directPoaWm2,
        diffusePoaWm2: poa.diffusePoaWm2,
        groundPoaWm2: poa.groundPoaWm2,
        totalWm2: poa.totalWm2,
        ghiClosureOk: irradiance.ghiClosure.isClosed,
      },
    },
    {
      modelId: "wind.log-profile",
      inputs: { referenceWindSpeedMS },
      outputs: { moduleWindSpeedMS },
    },
    {
      modelId: "thermal.faiman",
      inputs: { ambientTemperatureC, poaWm2: poa.totalWm2, moduleWindSpeedMS },
      outputs: { moduleTemperatureC },
    },
    {
      modelId: electricalMode === "single-diode" ? "pv.single-diode-desoto" : "pv.simple",
      inputs: { effectivePoaWm2: effectivePoa, moduleTemperatureC },
      outputs: { dcPowerW, dcVoltageV, dcCurrentA },
    },
    {
      modelId: "inverter.pvwatts-v5",
      inputs: { dcPowerW },
      outputs: { acPowerW: inverter.acPowerW, efficiency: inverter.efficiency, clippingLossW: inverter.clippingLossW },
    },
  ];
  return {
    timestampMs: nowMs,
    solar,
    sunDirection,
    irradiance,
    poa,
    panelNormal,
    panelFrame,
    moduleWindSpeedMS,
    moduleTemperatureC,
    effectivePoaWm2: effectivePoa,
    dcPowerW,
    dcVoltageV,
    dcCurrentA,
    ivCurve,
    inverter,
    trace,
  };
}

export interface DailySeriesInput {
  startTimestamp: Date | string | number;
  baseInput: Omit<InstantSimulationInput, "timestamp" | "irradiance"> & {
    irradiance?: InstantSimulationInput["irradiance"];
  };
  stepMinutes?: number;
  durationHours?: number;
  irradianceAt?: (
    timestampMs: number,
    solar: SolarPositionResult,
  ) => InstantSimulationInput["irradiance"];
}

export interface DailySeriesResult {
  samples: InstantSimulationResult[];
  dcEnergyWh: number;
  acEnergyWh: number;
}

export function generateDailySeries(input: DailySeriesInput): DailySeriesResult {
  const start = timestampMs(input.startTimestamp);
  const durationMs = (input.durationHours ?? 24) * 3_600_000;
  const stepMs = clamp(input.stepMinutes ?? 5, 1, 60) * 60_000;
  const samples: InstantSimulationResult[] = [];
  for (let elapsed = 0; elapsed <= durationMs + 1e-6; elapsed += stepMs) {
    const timestamp = start + elapsed;
    const solar = resolveSolar(timestamp, input.baseInput);
    const irradiance = input.irradianceAt?.(timestamp, solar)
      ?? input.baseInput.irradiance
      ?? defaultDailyClearSkyIrradiance(solar);
    samples.push(simulateInstant({ ...input.baseInput, timestamp, irradiance }));
  }
  const relativeTimesSeconds = samples.map((sample) => (sample.timestampMs - start) / 1000);
  return {
    samples,
    dcEnergyWh: integrateTrapezoid(relativeTimesSeconds, samples.map((sample) => sample.dcPowerW)),
    acEnergyWh: integrateTrapezoid(relativeTimesSeconds, samples.map((sample) => sample.inverter.acPowerW)),
  };
}
