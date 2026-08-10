import { DEG2RAD, RAD2DEG, clamp, mod } from "./types";
import type { Vec3 } from "./types";

export interface SolarPositionInput {
  timestamp: Date | string | number;
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM?: number;
  pressureHPa?: number;
  temperatureC?: number;
  deltaTSeconds?: number;
  deltaUt1Seconds?: number;
  applyRefraction?: boolean;
}

export interface SolarPositionResult {
  azimuthDeg: number;
  elevationDeg: number;
  geometricElevationDeg: number;
  zenithDeg: number;
  declinationDeg: number;
  hourAngleDeg: number;
  equationOfTimeMinutes: number;
  sunEarthDistanceAu: number;
  julianDay: number;
  isDaylight: boolean;
}

function asDate(timestamp: Date | string | number): Date {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("timestamp must be a valid absolute date/time");
  }
  return date;
}

function atmosphericRefractionDeg(elevationDeg: number, pressureHPa: number, temperatureC: number): number {
  if (elevationDeg < -1 || elevationDeg > 90) return 0;
  const denominatorAngle = (elevationDeg + 10.3 / (elevationDeg + 5.11)) * DEG2RAD;
  const tangent = Math.tan(denominatorAngle);
  if (Math.abs(tangent) < 1e-12) return 0;
  const standardArcMinutes = 1.02 / tangent;
  return (pressureHPa / 1010) * (283 / (273 + temperatureC)) * standardArcMinutes / 60;
}

/**
 * Dependency-free Meeus/NOAA solar ephemeris with SPA-compatible conventions.
 * It includes observer parallax, pressure/temperature refraction and ΔT/ΔUT1.
 * It is intended for browser simulation; full multi-millennial SPA periodic
 * series remain the validation authority.
 */
export function solarPosition(input: SolarPositionInput): SolarPositionResult {
  const date = asDate(input.timestamp);
  const latitudeDeg = input.latitudeDeg;
  const longitudeDeg = input.longitudeDeg;
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) {
    throw new RangeError("latitudeDeg must be between -90 and 90");
  }
  if (!Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180) {
    throw new RangeError("longitudeDeg must be between -180 and 180");
  }

  const deltaT = input.deltaTSeconds ?? 69;
  const deltaUt1 = input.deltaUt1Seconds ?? 0;
  const jdUtc = date.getTime() / 86_400_000 + 2_440_587.5;
  const jdUt1 = jdUtc + deltaUt1 / 86_400;
  const jde = jdUt1 + deltaT / 86_400;
  const t = (jde - 2_451_545) / 36_525;

  const geometricMeanLongitudeDeg = mod(280.46646 + t * (36_000.76983 + 0.0003032 * t), 360);
  const meanAnomalyDeg = mod(357.52911 + t * (35_999.05029 - 0.0001537 * t), 360);
  const meanAnomalyRad = meanAnomalyDeg * DEG2RAD;
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const equationOfCenterDeg =
    Math.sin(meanAnomalyRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomalyRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomalyRad) * 0.000289;
  const trueLongitudeDeg = geometricMeanLongitudeDeg + equationOfCenterDeg;
  const trueAnomalyRad = (meanAnomalyDeg + equationOfCenterDeg) * DEG2RAD;
  const omegaDeg = 125.04 - 1934.136 * t;
  const apparentLongitudeRad =
    (trueLongitudeDeg - 0.00569 - 0.00478 * Math.sin(omegaDeg * DEG2RAD)) * DEG2RAD;
  const meanObliquityDeg =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - 0.001813 * t))) / 60) / 60;
  const obliquityRad =
    (meanObliquityDeg + 0.00256 * Math.cos(omegaDeg * DEG2RAD)) * DEG2RAD;
  const declinationRad = Math.asin(Math.sin(obliquityRad) * Math.sin(apparentLongitudeRad));

  const y = Math.tan(obliquityRad / 2) ** 2;
  const l0Rad = geometricMeanLongitudeDeg * DEG2RAD;
  const equationOfTimeMinutes =
    4 * RAD2DEG *
    (y * Math.sin(2 * l0Rad) -
      2 * eccentricity * Math.sin(meanAnomalyRad) +
      4 * eccentricity * y * Math.sin(meanAnomalyRad) * Math.cos(2 * l0Rad) -
      0.5 * y * y * Math.sin(4 * l0Rad) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomalyRad));

  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000 +
    deltaUt1 / 60;
  const trueSolarMinutes = mod(utcMinutes + equationOfTimeMinutes + 4 * longitudeDeg, 1440);
  const geocentricHourAngleDeg = trueSolarMinutes / 4 - 180;
  const geocentricHourAngleRad = geocentricHourAngleDeg * DEG2RAD;

  // SPA/Meeus observer parallax correction. The horizontal solar parallax is
  // 8.794 arcsec at 1 AU.
  const sunEarthDistanceAu =
    (1.000001018 * (1 - eccentricity * eccentricity)) /
    (1 + eccentricity * Math.cos(trueAnomalyRad));
  const horizontalParallaxRad = (8.794 / 3600 / sunEarthDistanceAu) * DEG2RAD;
  const latitudeRad = latitudeDeg * DEG2RAD;
  const elevationM = input.elevationM ?? 0;
  const u = Math.atan(0.99664719 * Math.tan(latitudeRad));
  const x = Math.cos(u) + (elevationM / 6_378_140) * Math.cos(latitudeRad);
  const yObserver = 0.99664719 * Math.sin(u) + (elevationM / 6_378_140) * Math.sin(latitudeRad);
  const deltaRightAscensionRad = Math.atan2(
    -x * Math.sin(horizontalParallaxRad) * Math.sin(geocentricHourAngleRad),
    Math.cos(declinationRad) -
      x * Math.sin(horizontalParallaxRad) * Math.cos(geocentricHourAngleRad),
  );
  const topocentricDeclinationRad = Math.atan2(
    (Math.sin(declinationRad) - yObserver * Math.sin(horizontalParallaxRad)) *
      Math.cos(deltaRightAscensionRad),
    Math.cos(declinationRad) -
      x * Math.sin(horizontalParallaxRad) * Math.cos(geocentricHourAngleRad),
  );
  const topocentricHourAngleRad = geocentricHourAngleRad - deltaRightAscensionRad;

  const geometricElevationRad = Math.asin(
    clamp(
      Math.sin(latitudeRad) * Math.sin(topocentricDeclinationRad) +
        Math.cos(latitudeRad) *
          Math.cos(topocentricDeclinationRad) *
          Math.cos(topocentricHourAngleRad),
      -1,
      1,
    ),
  );
  const geometricElevationDeg = geometricElevationRad * RAD2DEG;
  const refractionDeg =
    input.applyRefraction === false
      ? 0
      : atmosphericRefractionDeg(
          geometricElevationDeg,
          input.pressureHPa ?? 1013.25,
          input.temperatureC ?? 15,
        );
  const elevationDeg = clamp(geometricElevationDeg + refractionDeg, -90, 90);
  const azimuthDeg = mod(
    Math.atan2(
      Math.sin(topocentricHourAngleRad),
      Math.cos(topocentricHourAngleRad) * Math.sin(latitudeRad) -
        Math.tan(topocentricDeclinationRad) * Math.cos(latitudeRad),
    ) *
      RAD2DEG +
      180,
    360,
  );

  return {
    azimuthDeg,
    elevationDeg,
    geometricElevationDeg,
    zenithDeg: 90 - elevationDeg,
    declinationDeg: topocentricDeclinationRad * RAD2DEG,
    hourAngleDeg: topocentricHourAngleRad * RAD2DEG,
    equationOfTimeMinutes,
    sunEarthDistanceAu,
    julianDay: jdUt1,
    isDaylight: elevationDeg > 0,
  };
}

/** Three.js ENU convention: +X east, +Y up, +Z north. */
export function sunVector(position: Pick<SolarPositionResult, "azimuthDeg" | "elevationDeg">): Vec3;
export function sunVector(azimuthDeg: number, elevationDeg: number): Vec3;
export function sunVector(
  positionOrAzimuth: Pick<SolarPositionResult, "azimuthDeg" | "elevationDeg"> | number,
  elevationArg?: number,
): Vec3 {
  const azimuthDeg =
    typeof positionOrAzimuth === "number" ? positionOrAzimuth : positionOrAzimuth.azimuthDeg;
  const elevationDeg =
    typeof positionOrAzimuth === "number" ? (elevationArg ?? 0) : positionOrAzimuth.elevationDeg;
  const azimuth = azimuthDeg * DEG2RAD;
  const elevation = elevationDeg * DEG2RAD;
  const cosElevation = Math.cos(elevation);
  return {
    x: Math.sin(azimuth) * cosElevation,
    y: Math.sin(elevation),
    z: Math.cos(azimuth) * cosElevation,
  };
}

export function extraterrestrialNormalIrradiance(position: Pick<SolarPositionResult, "sunEarthDistanceAu">): number {
  return 1361 / (position.sunEarthDistanceAu * position.sunEarthDistanceAu);
}
