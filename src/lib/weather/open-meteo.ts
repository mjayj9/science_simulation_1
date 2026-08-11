import { getOfflineWeather } from "./offline";
import {
  assertWeatherSeries,
  provenance,
  type WeatherPoint,
  type WeatherRangeRequest,
  type WeatherSeries,
} from "./types";

export const OPEN_METEO_HOURLY_FIELDS = [
  "shortwave_radiation",
  "direct_normal_irradiance",
  "diffuse_radiation",
  "temperature_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "precipitation",
] as const;

export class WeatherFetchError extends Error {
  constructor(message: string, readonly status?: number, readonly causeValue?: unknown) {
    super(message);
    this.name = "WeatherFetchError";
  }
}

function dateOnly(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Open-Meteo 요청 날짜가 올바르지 않습니다.");
  return date.toISOString().slice(0, 10);
}

export function buildOpenMeteoUrl(
  request: WeatherRangeRequest,
  endpoint = "https://api.open-meteo.com/v1/forecast",
): string {
  const url = new URL(endpoint);
  url.searchParams.set("latitude", String(request.latitudeDeg));
  url.searchParams.set("longitude", String(request.longitudeDeg));
  if (request.elevationM !== undefined) url.searchParams.set("elevation", String(request.elevationM));
  url.searchParams.set("start_date", dateOnly(request.start));
  url.searchParams.set("end_date", dateOnly(request.end));
  url.searchParams.set("hourly", OPEN_METEO_HOURLY_FIELDS.join(","));
  url.searchParams.set("timezone", "UTC");
  return url.toString();
}

function numericArray(hourly: Record<string, unknown>, key: string, count: number, fallback?: number): number[] {
  const value = hourly[key];
  if (value === undefined) {
    if (fallback === undefined) throw new WeatherFetchError(`Open-Meteo hourly.${key}가 없습니다.`);
    return Array(count).fill(fallback);
  }
  if (!Array.isArray(value) || value.length !== count) throw new WeatherFetchError(`Open-Meteo hourly.${key} 길이가 time과 다릅니다.`);
  return value.map((entry, index) => {
    if (entry === null) {
      if (fallback === undefined) throw new WeatherFetchError(`Open-Meteo hourly.${key}[${index}]가 누락되었습니다.`);
      return fallback;
    }
    const number = Number(entry);
    if (!Number.isFinite(number)) throw new WeatherFetchError(`Open-Meteo hourly.${key}[${index}]가 숫자가 아닙니다.`);
    return number;
  });
}

export function normalizeOpenMeteoResponse(raw: unknown, requestUrl?: string, now = new Date()): WeatherSeries {
  if (typeof raw !== "object" || raw === null || !("hourly" in raw)) throw new WeatherFetchError("Open-Meteo 응답에 hourly가 없습니다.");
  const root = raw as Record<string, unknown>;
  if (typeof root.hourly !== "object" || root.hourly === null) throw new WeatherFetchError("Open-Meteo hourly 형식이 잘못되었습니다.");
  const hourly = root.hourly as Record<string, unknown>;
  if (!Array.isArray(hourly.time) || hourly.time.length === 0) throw new WeatherFetchError("Open-Meteo hourly.time이 비어 있습니다.");
  const count = hourly.time.length;
  const ghi = numericArray(hourly, "shortwave_radiation", count);
  const dni = numericArray(hourly, "direct_normal_irradiance", count);
  const dhi = numericArray(hourly, "diffuse_radiation", count);
  const ambient = numericArray(hourly, "temperature_2m", count, 20);
  const wind = numericArray(hourly, "wind_speed_10m", count, 0);
  const direction = numericArray(hourly, "wind_direction_10m", count, 0);
  const gust = numericArray(hourly, "wind_gusts_10m", count, 0);
  const cloud = numericArray(hourly, "cloud_cover", count, 0);
  const precipitation = numericArray(hourly, "precipitation", count, 0);
  const points: WeatherPoint[] = hourly.time.map((value, index) => {
    const normalizedTime = typeof value === "string" && !/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? `${value}Z` : String(value);
    const timeUtcMs = Date.parse(normalizedTime);
    if (!Number.isFinite(timeUtcMs)) throw new WeatherFetchError(`Open-Meteo hourly.time[${index}]가 올바르지 않습니다.`);
    return {
      timeUtcMs,
      sourceTimestamp: String(value),
      ghiWm2: Math.max(0, ghi[index]),
      dniWm2: Math.max(0, dni[index]),
      dhiWm2: Math.max(0, dhi[index]),
      ambientC: ambient[index],
      windSpeedMs: Math.max(0, wind[index]),
      windDirectionDeg: ((direction[index] % 360) + 360) % 360,
      gustMs: Math.max(0, gust[index]),
      cloudFraction: Math.min(1, Math.max(0, cloud[index] / 100)),
      precipitationMm: Math.max(0, precipitation[index]),
    };
  });
  return assertWeatherSeries({
    points,
    provenance: provenance("open-meteo", "forecast", {
      fetchedAt: now.toISOString(),
      temporalResolution: "1 hour",
      spatialResolution: "Open-Meteo 선택 격자",
      requestUrl,
    }),
  });
}

function isExternalAbort(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export async function fetchOpenMeteo(
  request: WeatherRangeRequest,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    endpoint?: string;
    fallback?: boolean;
    now?: Date;
  } = {},
): Promise<WeatherSeries> {
  const url = buildOpenMeteoUrl(request, options.endpoint);
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutMs = options.timeoutMs ?? 10_000;
  const timeout = setTimeout(() => controller.abort(new DOMException("Open-Meteo timeout", "TimeoutError")), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new WeatherFetchError(`Open-Meteo HTTP ${response.status}`, response.status);
    return normalizeOpenMeteoResponse(await response.json(), url, options.now ?? new Date());
  } catch (error) {
    if (isExternalAbort(options.signal)) throw new DOMException("기상 조회가 취소되었습니다.", "AbortError");
    const wrapped = error instanceof WeatherFetchError
      ? error
      : new WeatherFetchError(error instanceof Error ? error.message : String(error), undefined, error);
    if (options.fallback === false) throw wrapped;
    return getOfflineWeather(request, { fallbackReason: `Open-Meteo 실패: ${wrapped.message}`, now: options.now });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
