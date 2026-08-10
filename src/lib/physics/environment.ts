export interface LogWindInput {
  referenceWindSpeedMS: number;
  heightM: number;
  referenceHeightM?: number;
  roughnessLengthM?: number;
  displacementHeightM?: number;
}

export function logWindSpeed(input: LogWindInput): number {
  const referenceHeight = input.referenceHeightM ?? 10;
  const roughness = input.roughnessLengthM ?? 0.03;
  const displacement = input.displacementHeightM ?? 0;
  if (!(roughness > 0)) throw new RangeError("roughnessLengthM must be positive");
  if (!(input.heightM > displacement + roughness)) {
    throw new RangeError("heightM must be greater than displacementHeightM + roughnessLengthM");
  }
  if (!(referenceHeight > displacement + roughness)) {
    throw new RangeError("referenceHeightM must be greater than displacementHeightM + roughnessLengthM");
  }
  const ratio =
    Math.log((input.heightM - displacement) / roughness) /
    Math.log((referenceHeight - displacement) / roughness);
  return Math.max(0, input.referenceWindSpeedMS) * ratio;
}

export function powerLawWindSpeed(
  referenceWindSpeedMS: number,
  heightM: number,
  referenceHeightM = 10,
  exponent = 0.16,
): number {
  if (!(heightM > 0) || !(referenceHeightM > 0)) {
    throw new RangeError("Wind heights must be positive");
  }
  return Math.max(0, referenceWindSpeedMS) * (heightM / referenceHeightM) ** exponent;
}

export interface AirDensityInput {
  ambientTemperatureC: number;
  pressurePa?: number;
  elevationM?: number;
}

export function airDensity(input: AirDensityInput): number {
  const rd = 287.05;
  const temperatureK = input.ambientTemperatureC + 273.15;
  if (!(temperatureK > 0)) throw new RangeError("ambientTemperatureC is below absolute zero");
  let pressurePa = input.pressurePa;
  if (pressurePa === undefined) {
    const elevation = input.elevationM ?? 0;
    if (elevation < -500 || elevation > 11_000) {
      throw new RangeError("Standard-atmosphere approximation is limited to -500..11000 m");
    }
    const tStandard = 288.15 - 0.0065 * elevation;
    pressurePa = 101_325 * (tStandard / 288.15) ** (9.80665 / (rd * 0.0065));
  }
  if (!(pressurePa > 0)) throw new RangeError("pressurePa must be positive");
  return pressurePa / (rd * temperatureK);
}

export interface EnvironmentPreset {
  roughnessLengthM: number;
  displacementHeightM: number;
  turbulenceIntensity: number;
  albedo: number;
}

export const ENVIRONMENT_PRESETS = {
  desert: { roughnessLengthM: 0.001, displacementHeightM: 0, turbulenceIntensity: 0.11, albedo: 0.35 },
  coast: { roughnessLengthM: 0.001, displacementHeightM: 0, turbulenceIntensity: 0.11, albedo: 0.2 },
  plain: { roughnessLengthM: 0.03, displacementHeightM: 0, turbulenceIntensity: 0.17, albedo: 0.2 },
  suburban: { roughnessLengthM: 0.3, displacementHeightM: 3, turbulenceIntensity: 0.26, albedo: 0.2 },
  urban: { roughnessLengthM: 0.7, displacementHeightM: 8, turbulenceIntensity: 0.34, albedo: 0.18 },
} as const satisfies Record<string, EnvironmentPreset>;
