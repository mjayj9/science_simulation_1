import { clamp } from "./types";

export type WeatherPreset = "clear" | "partly-cloudy" | "overcast" | "rain" | "windy";

export interface WeatherPresetInput {
  timestampsMs: readonly number[];
  clearGhiWm2: readonly number[];
  clearDniWm2: readonly number[];
  clearDhiWm2: readonly number[];
  ambientTemperatureC?: number | readonly number[];
  referenceWindSpeedMS?: number | readonly number[];
  preset: WeatherPreset;
  seed: string | number;
  correlationTimeSeconds?: number;
}

export interface WeatherSample {
  timestampMs: number;
  ghiWm2: number;
  dniWm2: number;
  dhiWm2: number;
  ambientTemperatureC: number;
  windSpeedMS: number;
  cloudFraction: number;
  precipitationMm: number;
  source: "estimated";
}

function hashString(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class DeterministicRandom {
  private state: number;
  private spareGaussian: number | undefined;

  constructor(seed: string | number) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashString(seed);
    if (this.state === 0) this.state = 0x6d2b79f5;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  gaussian(): number {
    if (this.spareGaussian !== undefined) {
      const value = this.spareGaussian;
      this.spareGaussian = undefined;
      return value;
    }
    const u = Math.max(Number.EPSILON, this.next());
    const v = this.next();
    const radius = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    this.spareGaussian = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  }
}

const PRESET_PARAMETERS: Record<WeatherPreset, { cloudMean: number; cloudSigma: number; opticalDepth: number; diffuseBoost: number; windMultiplier: number; rainMm: number }> = {
  clear: { cloudMean: 0.05, cloudSigma: 0.03, opticalDepth: 0.4, diffuseBoost: 0.1, windMultiplier: 1, rainMm: 0 },
  "partly-cloudy": { cloudMean: 0.45, cloudSigma: 0.2, opticalDepth: 1.4, diffuseBoost: 0.5, windMultiplier: 1.1, rainMm: 0 },
  overcast: { cloudMean: 0.95, cloudSigma: 0.03, opticalDepth: 3, diffuseBoost: 0.8, windMultiplier: 1.05, rainMm: 0 },
  rain: { cloudMean: 0.98, cloudSigma: 0.02, opticalDepth: 4, diffuseBoost: 0.9, windMultiplier: 1.2, rainMm: 1 },
  windy: { cloudMean: 0.2, cloudSigma: 0.08, opticalDepth: 0.7, diffuseBoost: 0.2, windMultiplier: 2, rainMm: 0 },
};

function at(value: number | readonly number[] | undefined, index: number, fallback: number): number {
  return typeof value === "number" ? value : value?.[index] ?? fallback;
}

export function generateWeatherPreset(input: WeatherPresetInput): WeatherSample[] {
  const count = input.timestampsMs.length;
  if (input.clearGhiWm2.length !== count || input.clearDniWm2.length !== count || input.clearDhiWm2.length !== count) {
    throw new RangeError("All clear-sky weather arrays must have the same length");
  }
  const random = new DeterministicRandom(`${String(input.seed)}:${input.preset}`);
  const parameters = PRESET_PARAMETERS[input.preset];
  const correlationTime = input.correlationTimeSeconds ?? 180;
  let state = 0;
  return input.timestampsMs.map((timestampMs, index) => {
    const previous = index === 0 ? timestampMs : input.timestampsMs[index - 1];
    const dtSeconds = Math.max(0, (timestampMs - previous) / 1000);
    const phi = Math.exp(-dtSeconds / Math.max(1e-6, correlationTime));
    state = phi * state + Math.sqrt(Math.max(0, 1 - phi * phi)) * random.gaussian();
    const cloud = clamp(parameters.cloudMean + parameters.cloudSigma * state, 0, 1);
    const clearGhi = Math.max(0, input.clearGhiWm2[index]);
    const clearDni = Math.max(0, input.clearDniWm2[index]);
    const clearDhi = Math.max(0, input.clearDhiWm2[index]);
    const clearBeamHorizontal = Math.max(0, clearGhi - clearDhi);
    const cosineZenith = clearDni > 0 ? clamp(clearBeamHorizontal / clearDni, 0.01, 1) : 1;
    const beamFactor = Math.exp(-parameters.opticalDepth * cloud / Math.max(cosineZenith, 0.15));
    const dni = clearDni * beamFactor;
    const dhiCandidate = clearDhi * (1 + parameters.diffuseBoost * cloud);
    const ghi = Math.max(0, dni * cosineZenith + dhiCandidate);
    const dhi = clamp(ghi - dni * cosineZenith, 0, ghi);
    const windNoise = 1 + 0.15 * random.gaussian();
    return {
      timestampMs,
      ghiWm2: ghi,
      dniWm2: dni,
      dhiWm2: dhi,
      ambientTemperatureC: at(input.ambientTemperatureC, index, 25),
      windSpeedMS: Math.max(0, at(input.referenceWindSpeedMS, index, 4) * parameters.windMultiplier * windNoise),
      cloudFraction: cloud,
      precipitationMm: parameters.rainMm > 0 ? parameters.rainMm * (0.5 + random.next()) : 0,
      source: "estimated",
    };
  });
}
