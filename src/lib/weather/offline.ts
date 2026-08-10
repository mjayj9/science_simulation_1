import {
  assertWeatherSeries,
  provenance,
  type OfflineWeatherPreset,
  type WeatherPoint,
  type WeatherRangeRequest,
  type WeatherSeries,
} from "./types";

function utcMs(value: Date | string | number, label: string): number {
  const result = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError(`${label} 시각이 올바르지 않습니다.`);
  return result;
}

function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
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

function solarElevationApprox(latitudeDeg: number, longitudeDeg: number, timeUtcMs: number): number {
  const date = new Date(timeUtcMs);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((timeUtcMs - start) / 86_400_000);
  const fractionalUtcHour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = (2 * Math.PI / 365) * (day - 1 + (fractionalUtcHour - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = ((fractionalUtcHour * 60 + equationOfTime + 4 * longitudeDeg) % 1440 + 1440) % 1440;
  const hourAngle = ((trueSolarMinutes / 4 - 180) * Math.PI) / 180;
  const latitude = (latitudeDeg * Math.PI) / 180;
  return Math.asin(
    Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  );
}

function attenuation(preset: OfflineWeatherPreset, seed: string, timestamp: number): { beam: number; diffuse: number; cloud: number; rain: number } {
  const variation = deterministicUnit(seed, timestamp, "cloud");
  switch (preset) {
    case "clear": return { beam: 1, diffuse: 1, cloud: 0.05, rain: 0 };
    case "partly-cloudy": return { beam: 0.35 + variation * 0.55, diffuse: 1.15, cloud: 0.35 + variation * 0.45, rain: 0 };
    case "overcast": return { beam: 0.08, diffuse: 1.5, cloud: 0.95, rain: 0 };
    case "rain": return { beam: 0.03, diffuse: 1.1, cloud: 1, rain: 0.3 + 2 * variation };
    case "night": return { beam: 0, diffuse: 0, cloud: 0, rain: 0 };
  }
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
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 1440) {
    throw new RangeError("오프라인 시간 간격은 1~1440분의 정수여야 합니다.");
  }
  const stepMs = stepMinutes * 60_000;
  const count = Math.floor((end - start) / stepMs) + 1;
  if (count > 100_000) throw new RangeError("오프라인 시계열은 한 번에 100,000행을 넘을 수 없습니다.");

  const seed = request.seed ?? "solar-offline-v1";
  const preset = request.offlinePreset ?? "clear";
  const points: WeatherPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const timeUtcMs = start + index * stepMs;
    const elevation = preset === "night" ? -Math.PI / 2 : solarElevationApprox(request.latitudeDeg, request.longitudeDeg, timeUtcMs);
    const sineElevation = Math.max(0, Math.sin(elevation));
    const factors = attenuation(preset, seed, timeUtcMs);
    const airMassAttenuation = Math.exp(-0.14 / Math.max(0.08, sineElevation));
    const clearDni = sineElevation > 0 ? 1000 * airMassAttenuation : 0;
    const dniWm2 = Math.max(0, clearDni * factors.beam);
    const clearDiffuse = sineElevation > 0 ? 70 + 50 * (1 - sineElevation) : 0;
    const dhiWm2 = Math.max(0, clearDiffuse * factors.diffuse * (preset === "night" ? 0 : 1));
    const ghiWm2 = Math.max(0, dniWm2 * sineElevation + dhiWm2);
    const utcHour = new Date(timeUtcMs).getUTCHours() + request.longitudeDeg / 15;
    const temperatureCycle = Math.sin(((utcHour - 8) / 24) * Math.PI * 2);
    const windNoise = deterministicUnit(seed, timeUtcMs, "wind");
    points.push({
      timeUtcMs,
      ghiWm2,
      dniWm2,
      dhiWm2,
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
      spatialResolution: "위치별 맑은 하늘·날씨 프리셋 근사",
      fallbackReason: options.fallbackReason,
    }),
  });
}
