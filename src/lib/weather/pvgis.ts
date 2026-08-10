import { assertWeatherSeries, provenance, type WeatherPoint, type WeatherRangeRequest, type WeatherSeries } from "./types";

export const PVGIS_BROWSER_METADATA = {
  provider: "PVGIS JRC",
  browserDirectFetch: "best-effort" as const,
  corsCaveatKo:
    "PVGIS는 배포 출처·엔드포인트에 따라 브라우저 CORS 요청이 차단될 수 있습니다. URL을 제공하고 JSON 파일 가져오기를 공식 대체 경로로 지원합니다.",
};

export function buildPvgisTmyUrl(
  request: Pick<WeatherRangeRequest, "latitudeDeg" | "longitudeDeg">,
  endpoint = "https://re.jrc.ec.europa.eu/api/tmy",
): string {
  const url = new URL(endpoint);
  url.searchParams.set("lat", String(request.latitudeDeg));
  url.searchParams.set("lon", String(request.longitudeDeg));
  url.searchParams.set("outputformat", "json");
  return url.toString();
}

function parsePvgisTime(value: unknown): number {
  const text = String(value);
  const match = /^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/.exec(text);
  if (!match) throw new Error(`PVGIS 시각 형식이 잘못되었습니다: ${text}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
}

function pvgisNumber(row: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const number = Number(row[key]);
    if (Number.isFinite(number)) return number;
  }
  return fallback;
}

export function importPvgisJson(input: string | unknown, now = new Date()): WeatherSeries {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (typeof raw !== "object" || raw === null || !("outputs" in raw)) throw new Error("PVGIS JSON에 outputs가 없습니다.");
  const outputs = (raw as { outputs: unknown }).outputs;
  if (typeof outputs !== "object" || outputs === null) throw new Error("PVGIS outputs 형식이 잘못되었습니다.");
  const rows = (outputs as Record<string, unknown>).tmy_hourly ?? (outputs as Record<string, unknown>).hourly;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("PVGIS 시간별 데이터가 없습니다.");
  const points: WeatherPoint[] = rows.map((value) => {
    if (typeof value !== "object" || value === null) throw new Error("PVGIS 시간별 행 형식이 잘못되었습니다.");
    const row = value as Record<string, unknown>;
    return {
      timeUtcMs: parsePvgisTime(row.time),
      ghiWm2: Math.max(0, pvgisNumber(row, ["G(h)", "G(i)"])),
      dniWm2: Math.max(0, pvgisNumber(row, ["Gb(n)", "Gb(i)"])),
      dhiWm2: Math.max(0, pvgisNumber(row, ["Gd(h)", "Gd(i)"])),
      ambientC: pvgisNumber(row, ["T2m"], 20),
      windSpeedMs: Math.max(0, pvgisNumber(row, ["WS10m"])),
      windDirectionDeg: ((pvgisNumber(row, ["WD10m"]) % 360) + 360) % 360,
      gustMs: Math.max(0, pvgisNumber(row, ["WS10m"])),
      cloudFraction: 0,
      precipitationMm: 0,
    };
  }).sort((a, b) => a.timeUtcMs - b.timeUtcMs);
  return assertWeatherSeries({
    points,
    provenance: provenance("pvgis", "tmy", {
      fetchedAt: now.toISOString(),
      temporalResolution: "1 hour",
      spatialResolution: "PVGIS 선택 격자",
      corsCaveatKo: PVGIS_BROWSER_METADATA.corsCaveatKo,
    }),
  });
}

export const normalizePvgisResponse = importPvgisJson;
