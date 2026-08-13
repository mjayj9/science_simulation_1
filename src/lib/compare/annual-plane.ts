import type { WeatherPoint } from "../weather";
import type { ElectricalConfig } from "../physics/electrical";
import { simpleDcPower } from "../physics/electrical";
import type { InverterConfig } from "../physics/inverter";
import { calculateInverter } from "../physics/inverter";
import type { IAMConfig } from "../physics/irradiance";
import { calculatePOA } from "../physics/irradiance";
import { integrateTrapezoid } from "../physics/integration";
import type { SolarPositionInput } from "../physics/solar";
import {
  extraterrestrialNormalIrradiance,
  solarPosition,
  sunVector,
} from "../physics/solar";
import type { ThermalConfig } from "../physics/thermal";
import { faimanTemperature } from "../physics/thermal";
import type { Vec3 } from "../physics/types";
import { optimizeAnnualFixedPlaneTilt } from "./performance";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export type AnnualPlaneLocation = Omit<
  SolarPositionInput,
  "timestamp" | "temperatureC"
>;

export interface AnnualPlaneOpticsConfig {
  albedo: number;
  iam: IAMConfig;
  soilingLossFraction: number;
  diffuseModel?: "hay-davies" | "isotropic";
}

export interface WeatherDrivenPlaneTiltInput {
  /** Strictly increasing absolute weather samples; adjacent AC powers are trapezoidally integrated. */
  weather: readonly WeatherPoint[];
  location: AnnualPlaneLocation;
  /** Horizontal square footprint reserved for the plane. */
  landAreaM2: number;
  /** Maximum permitted height of support plus the tilted plane's vertical rise. */
  maximumHeightM: number;
  /** Ground clearance/support height, counted inside maximumHeightM. */
  supportHeightM?: number;
  /** Clockwise from north in the shared ENU convention. South is 180 degrees. */
  planeAzimuthDeg?: number;
  optics: AnnualPlaneOpticsConfig;
  electrical: ElectricalConfig;
  thermal: ThermalConfig;
  inverter: InverterConfig;
  minimumTiltDeg?: number;
  maximumTiltDeg?: number;
  coarseStepDeg?: number;
  toleranceDeg?: number;
}

export interface WeatherDrivenPlaneTiltResult {
  tiltDeg: number;
  annualAcEnergyWh: number;
  activeAreaM2: number;
  projectedSideM: number;
  verticalRiseM: number;
  totalHeightM: number;
  physicalMaximumTiltDeg: number;
  evaluations: number;
  searchRangeDeg: readonly [number, number];
  method: "bounded-grid-golden-section";
}

interface PreparedWeatherPoint {
  timeSeconds: number;
  weather: WeatherPoint;
  solarZenithDeg: number;
  sunDirection: Vec3;
  extraterrestrialNormalWm2: number;
  daylight: boolean;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (!(value > 0)) throw new RangeError(`${label} must be positive.`);
  return value;
}

function fraction(value: number, label: string): number {
  finite(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1.`);
  return value;
}

function validateWeather(points: readonly WeatherPoint[]): void {
  if (points.length < 2) {
    throw new RangeError("Annual plane optimization requires at least two weather samples.");
  }
  let previous = -Infinity;
  for (const [index, point] of points.entries()) {
    const values = [
      point.timeUtcMs,
      point.ghiWm2,
      point.dniWm2,
      point.dhiWm2,
      point.ambientC,
      point.windSpeedMs,
    ];
    if (!values.every(Number.isFinite)) {
      throw new RangeError(`Weather sample ${index} contains a non-finite required value.`);
    }
    if (point.timeUtcMs <= previous) {
      throw new RangeError("Weather timestamps must be strictly increasing.");
    }
    if (point.ghiWm2 < 0 || point.dniWm2 < 0 || point.dhiWm2 < 0 || point.windSpeedMs < 0) {
      throw new RangeError(`Weather sample ${index} contains a negative irradiance or wind speed.`);
    }
    previous = point.timeUtcMs;
  }
}

function validateModels(input: WeatherDrivenPlaneTiltInput): void {
  fraction(input.optics.albedo, "Ground albedo");
  fraction(input.optics.soilingLossFraction, "Soiling loss fraction");
  fraction(input.electrical.efficiency, "PV efficiency");
  positive(input.electrical.referenceIrradianceWm2, "Reference irradiance");
  positive(input.electrical.vmpV, "Electrical Vmp");
  finite(input.electrical.gammaPmpPerC, "Pmax temperature coefficient");
  positive(input.thermal.u0Wm2K, "Faiman u0");
  finite(input.thermal.u1WsM3K, "Faiman u1");
  if (input.thermal.u1WsM3K < 0) throw new RangeError("Faiman u1 must be nonnegative.");
  positive(input.inverter.ratedAcPowerW, "Inverter rated AC power");
  const nominalEfficiency = fraction(input.inverter.nominalEfficiency, "Inverter nominal efficiency");
  if (!(nominalEfficiency > 0)) throw new RangeError("Inverter nominal efficiency must be positive.");
  positive(input.inverter.maxInputCurrentA, "Inverter maximum input current");
  fraction(input.inverter.wiringLossFraction, "Inverter wiring loss fraction");
}

function panelNormal(tiltDeg: number, azimuthDeg: number): Vec3 {
  const tilt = tiltDeg * DEG2RAD;
  const azimuth = azimuthDeg * DEG2RAD;
  return {
    x: Math.sin(azimuth) * Math.sin(tilt),
    y: Math.cos(tilt),
    z: Math.cos(azimuth) * Math.sin(tilt),
  };
}

function prepareWeather(input: WeatherDrivenPlaneTiltInput): PreparedWeatherPoint[] {
  const startSeconds = input.weather[0].timeUtcMs / 1000;
  return input.weather.map((weather) => {
    const solar = solarPosition({
      ...input.location,
      timestamp: weather.timeUtcMs,
      temperatureC: weather.ambientC,
    });
    return {
      timeSeconds: weather.timeUtcMs / 1000 - startSeconds,
      weather,
      solarZenithDeg: solar.zenithDeg,
      sunDirection: sunVector(solar),
      extraterrestrialNormalWm2: extraterrestrialNormalIrradiance(solar),
      daylight: solar.isDaylight,
    };
  });
}

function annualAcAtTiltWh(
  prepared: readonly PreparedWeatherPoint[],
  input: WeatherDrivenPlaneTiltInput,
  tiltDeg: number,
): number {
  const normal = panelNormal(tiltDeg, input.planeAzimuthDeg ?? 180);
  const activeAreaM2 = input.landAreaM2 / Math.cos(tiltDeg * DEG2RAD);
  const electrical: ElectricalConfig = { ...input.electrical, areaM2: activeAreaM2 };
  const soilingTransmission = 1 - input.optics.soilingLossFraction;

  return integrateTrapezoid(prepared.map((point) => {
    let acPowerW = 0;
    if (point.daylight) {
      const poa = calculatePOA({
        ghiWm2: point.weather.ghiWm2,
        dniWm2: point.weather.dniWm2,
        dhiWm2: point.weather.dhiWm2,
        solarZenithDeg: point.solarZenithDeg,
        sunDirection: point.sunDirection,
        panelNormal: normal,
        albedo: input.optics.albedo,
        iam: input.optics.iam,
        diffuseModel: input.optics.diffuseModel,
        extraterrestrialNormalWm2: point.extraterrestrialNormalWm2,
      });
      const moduleTemperatureC = faimanTemperature(
        point.weather.ambientC,
        poa.totalWm2,
        point.weather.windSpeedMs,
        input.thermal,
      );
      const effectivePoaWm2 = poa.totalWm2 * soilingTransmission;
      const dcPowerW = simpleDcPower(effectivePoaWm2, moduleTemperatureC, electrical, 0);
      // The plane is represented as a parallel area-scaled device, matching the
      // shared simple-DC pipeline: configured Vmp is retained and current scales
      // with active area. Temperature dependence is already applied to DC power.
      const dcVoltageV = dcPowerW > 0 ? electrical.vmpV : 0;
      const dcCurrentA = dcVoltageV > 0 ? dcPowerW / dcVoltageV : 0;
      acPowerW = calculateInverter({
        dcPowerW,
        dcVoltageV,
        dcCurrentA,
        config: input.inverter,
      }).acPowerW;
    }
    return { timeSeconds: point.timeSeconds, powerW: acPowerW };
  }));
}

/**
 * Finds the weather-driven annual-AC optimum of one south-facing fixed plane.
 *
 * The horizontal footprint is an L x L square, L=sqrt(A_land). Its north-south
 * slant length is L/cos(beta), so active area is A_land/cos(beta) and vertical
 * rise is L*tan(beta). No empirical shape or generation multiplier is used.
 */
export function optimizeWeatherDrivenAnnualPlaneTilt(
  input: WeatherDrivenPlaneTiltInput,
): WeatherDrivenPlaneTiltResult {
  validateWeather(input.weather);
  validateModels(input);
  const landAreaM2 = positive(input.landAreaM2, "Land area");
  const maximumHeightM = positive(input.maximumHeightM, "Maximum height");
  const supportHeightM = input.supportHeightM ?? 0;
  finite(supportHeightM, "Support height");
  if (supportHeightM < 0 || supportHeightM >= maximumHeightM) {
    throw new RangeError("Support height must satisfy 0 <= supportHeightM < maximumHeightM.");
  }
  const azimuthDeg = input.planeAzimuthDeg ?? 180;
  finite(azimuthDeg, "Plane azimuth");

  const projectedSideM = Math.sqrt(landAreaM2);
  const physicalMaximumTiltDeg = Math.atan(
    (maximumHeightM - supportHeightM) / projectedSideM,
  ) * RAD2DEG;
  const requestedMinimum = input.minimumTiltDeg ?? 0;
  const requestedMaximum = input.maximumTiltDeg ?? 90;
  finite(requestedMinimum, "Minimum tilt");
  finite(requestedMaximum, "Maximum tilt");
  const maximumTiltDeg = Math.min(requestedMaximum, physicalMaximumTiltDeg);
  if (requestedMinimum < 0 || requestedMaximum > 90 || requestedMaximum <= requestedMinimum) {
    throw new RangeError("Tilt request must satisfy 0 <= minimum < maximum <= 90 degrees.");
  }
  if (requestedMinimum >= maximumTiltDeg) {
    throw new RangeError("The requested minimum tilt is outside the maximum-height envelope.");
  }

  const prepared = prepareWeather(input);
  const searchWidth = maximumTiltDeg - requestedMinimum;
  const optimized = optimizeAnnualFixedPlaneTilt({
    evaluateAnnualEnergyWh: (tiltDeg) => annualAcAtTiltWh(prepared, input, tiltDeg),
    minimumTiltDeg: requestedMinimum,
    maximumTiltDeg,
    coarseStepDeg: Math.min(input.coarseStepDeg ?? 5, searchWidth),
    toleranceDeg: Math.min(input.toleranceDeg ?? 0.05, searchWidth),
  });
  const tiltRad = optimized.tiltDeg * DEG2RAD;
  const verticalRiseM = projectedSideM * Math.tan(tiltRad);
  return {
    tiltDeg: optimized.tiltDeg,
    annualAcEnergyWh: optimized.annualEnergyWh,
    activeAreaM2: landAreaM2 / Math.cos(tiltRad),
    projectedSideM,
    verticalRiseM,
    totalHeightM: supportHeightM + verticalRiseM,
    physicalMaximumTiltDeg,
    evaluations: optimized.evaluations,
    searchRangeDeg: optimized.searchRangeDeg,
    method: optimized.method,
  };
}
