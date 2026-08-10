import { assertWeatherSeries, provenance, type WeatherPoint, type WeatherRangeRequest, type WeatherSeries } from "./types";

const NASA_PARAMETERS = ["ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DNI", "ALLSKY_SFC_SW_DIFF", "T2M", "WS10M", "WD10M", "PRECTOTCORR"] as const;

function compactDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("NASA POWER 요청 날짜가 올바르지 않습니다.");
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function buildNasaPowerHourlyUrl(
  request: WeatherRangeRequest,
  endpoint = "https://power.larc.nasa.gov/api/temporal/hourly/point",
): string {
  const url = new URL(endpoint);
  url.searchParams.set("parameters", NASA_PARAMETERS.join(","));
  url.searchParams.set("community", "RE");
  url.searchParams.set("longitude", String(request.longitudeDeg));
  url.searchParams.set("latitude", String(request.latitudeDeg));
  url.searchParams.set("start", compactDate(request.start));
  url.searchParams.set("end", compactDate(request.end));
  url.searchParams.set("format", "JSON");
  url.searchParams.set("time-standard", "UTC");
  return url.toString();
}

function nasaTime(key: string): number {
  if (!/^\d{10}$/.test(key)) throw new Error(`NASA POWER 시각 키가 잘못되었습니다: ${key}`);
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)), Number(key.slice(8, 10)));
}

export function normalizeNasaPowerResponse(raw: unknown, requestUrl?: string, now = new Date()): WeatherSeries {
  const parameter = (raw as { properties?: { parameter?: unknown } })?.properties?.parameter;
  if (typeof parameter !== "object" || parameter === null) throw new Error("NASA POWER 응답에 properties.parameter가 없습니다.");
  const values = parameter as Record<string, Record<string, unknown>>;
  const keys = Object.keys(values.ALLSKY_SFC_SW_DWN ?? {}).sort();
  if (keys.length === 0) throw new Error("NASA POWER 시간별 데이터가 없습니다.");
  const read = (field: string, key: string, fallback = 0) => {
    const value = Number(values[field]?.[key]);
    return Number.isFinite(value) && value > -900 ? value : fallback;
  };
  const points: WeatherPoint[] = keys.map((key) => ({
    timeUtcMs: nasaTime(key),
    // POWER hourly solar fields are Wh/m² over the hour, numerically equal to hourly mean W/m².
    ghiWm2: Math.max(0, read("ALLSKY_SFC_SW_DWN", key)),
    dniWm2: Math.max(0, read("ALLSKY_SFC_SW_DNI", key)),
    dhiWm2: Math.max(0, read("ALLSKY_SFC_SW_DIFF", key)),
    ambientC: read("T2M", key, 20),
    windSpeedMs: Math.max(0, read("WS10M", key)),
    windDirectionDeg: ((read("WD10M", key) % 360) + 360) % 360,
    gustMs: Math.max(0, read("WS10M", key)),
    cloudFraction: 0,
    precipitationMm: Math.max(0, read("PRECTOTCORR", key)),
  }));
  return assertWeatherSeries({
    points,
    provenance: provenance("nasa-power", "reanalysis", {
      fetchedAt: now.toISOString(),
      temporalResolution: "1 hour",
      spatialResolution: "NASA POWER 선택 격자",
      requestUrl,
    }),
  });
}

export async function fetchNasaPower(
  request: WeatherRangeRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; endpoint?: string; now?: Date } = {},
): Promise<WeatherSeries> {
  const url = buildNasaPowerHourlyUrl(request, options.endpoint);
  const response = await (options.fetchImpl ?? fetch)(url, { signal: options.signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`NASA POWER HTTP ${response.status}`);
  return normalizeNasaPowerResponse(await response.json(), url, options.now);
}
