import {
  erbsDecomposition,
  extraterrestrialNormalIrradiance,
  solarPosition,
} from "../physics";
import {
  assertWeatherSeries,
  provenance,
  type OfflineWeatherPreset,
  type WeatherPoint,
  type WeatherRangeRequest,
  type WeatherSeries,
} from "./types";

function utcMs(value: Date | string | number, label: string): number {
  const result = value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError(`${label} 시각이 올바르지 않습니다.`);
  return result;
}

function hash32(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

function deterministicUnit(seed: string, timestamp: number, stream: string): number {
  return hash32(`${seed}|${Math.trunc(timestamp)}|${stream}`) / 0x1_0000_0000;
}

interface OfflineAtmosphere {
  /** Scenario transmittance applied to clear-sky GHI before Erbs decomposition. */
  globalTransmittance: number;
  cloud: number;
  rain: number;
}

function attenuation(
  preset: OfflineWeatherPreset,
  seed: string,
  timestamp: number,
): OfflineAtmosphere {
  const variation = deterministicUnit(seed, timestamp, "cloud");
  switch (preset) {
    case "clear":
      return { globalTransmittance: 1, cloud: 0.05, rain: 0 };
    case "partly-cloudy":
      return {
        globalTransmittance: 0.45 + variation * 0.45,
        cloud: 0.35 + variation * 0.45,
        rain: 0,
      };
    case "overcast":
      return { globalTransmittance: 0.18, cloud: 0.95, rain: 0 };
    case "rain":
      return { globalTransmittance: 0.08, cloud: 1, rain: 0.3 + 2 * variation };
    case "night":
      return { globalTransmittance: 0, cloud: 0, rain: 0 };
  }
}

/**
 * Haurwitz clear-sky global horizontal irradiance (W/m²).
 *
 * The model is evaluated from the shared solar-position result. DNI and DHI
 * then come from the shared Erbs decomposition, which keeps the generated
 * triplet closed as GHI = DNI cos(zenith) + DHI. Presets alter GHI through an
 * explicit scenario transmittance, never a time-of-day sine or square root.
 */
function haurwitzClearSkyGhi(cosineZenith: number): number {
  if (!(cosineZenith > 0)) return 0;
  return 1_098 * cosineZenith * Math.exp(-0.059 / cosineZenith);
}

export function getOfflineWeather(
  request: WeatherRangeRequest,
  options: { fallbackReason?: string; now?: Date } = {},
): WeatherSeries {
  if (!Number.isFinite(request.latitudeDeg) || request.latitudeDeg < -90 || request.latitudeDeg > 90) {
    throw new RangeError("위도는 -90°~90° 범위여야 합니다.");
  }
  if (!Number.isFinite(request.longitudeDeg) || request.longitudeDeg < -180 || request.longitudeDeg > 180) {
    throw new RangeError("경도는 -180°~180° 범위여야 합니다.");
  }
  const start = utcMs(request.start, "시작");
  const end = utcMs(request.end, "종료");
  if (end < start) throw new RangeError("종료 시각은 시작 시각보다 빠를 수 없습니다.");
  const stepMinutes = request.stepMinutes ?? 60;
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 1_440) {
    throw new RangeError("오프라인 시간 간격은 1~1440분의 정수여야 합니다.");
  }
  const stepMs = stepMinutes * 60_000;
  const count = Math.floor((end - start) / stepMs) + 1;
  if (count > 100_000) {
    throw new RangeError("오프라인 시계열은 한 번에 100,000행을 넘을 수 없습니다.");
  }

  const seed = request.seed ?? "solar-offline-v2-haurwitz-erbs";
  const preset = request.offlinePreset ?? "clear";
  const points: WeatherPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const timeUtcMs = start + index * stepMs;
    const solar = solarPosition({
      timestamp: timeUtcMs,
      latitudeDeg: request.latitudeDeg,
      longitudeDeg: request.longitudeDeg,
      elevationM: request.elevationM,
      applyRefraction: false,
    });
    const cosineZenith = solar.isDaylight
      ? Math.max(0, Math.cos(solar.zenithDeg * Math.PI / 180))
      : 0;
    const factors = attenuation(preset, seed, timeUtcMs);
    const ghiWm2 = preset === "night"
      ? 0
      : haurwitzClearSkyGhi(cosineZenith) * factors.globalTransmittance;
    const components = erbsDecomposition({
      ghiWm2,
      solarZenithDeg: solar.zenithDeg,
      extraterrestrialNormalWm2: extraterrestrialNormalIrradiance(solar),
    });
    const utcHour = new Date(timeUtcMs).getUTCHours() + request.longitudeDeg / 15;
    const temperatureCycle = Math.sin(((utcHour - 8) / 24) * Math.PI * 2);
    const windNoise = deterministicUnit(seed, timeUtcMs, "wind");
    points.push({
      timeUtcMs,
      ghiWm2: components.ghiWm2,
      dniWm2: components.dniWm2,
      dhiWm2: components.dhiWm2,
      ambientC: 18 + 7 * temperatureCycle - (preset === "rain" ? 3 : 0),
      windSpeedMs: Math.max(0, 1.5 + 3 * windNoise),
      windDirectionDeg: deterministicUnit(seed, timeUtcMs, "direction") * 360,
      gustMs: Math.max(0, 3 + 5 * deterministicUnit(seed, timeUtcMs, "gust")),
      cloudFraction: factors.cloud,
      precipitationMm: factors.rain,
    });
  }

  return assertWeatherSeries({
    points,
    provenance: provenance("offline", "model-estimate", {
      fetchedAt: (options.now ?? new Date()).toISOString(),
      temporalResolution: `${stepMinutes} min`,
      spatialResolution: "위치별 Haurwitz clear-sky + Erbs 분해 모델",
      fallbackReason: options.fallbackReason,
    }),
  });
}
