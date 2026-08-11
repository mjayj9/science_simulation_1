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

function providerNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > -900 ? number : undefined;
}

function pvgisNumber(row: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const number = providerNumber(row[key]);
    if (number !== undefined) return number;
  }
  return fallback;
}

function requiredPvgisIrradiance(
  row: Record<string, unknown>,
  keys: string[],
  label: string,
): number {
  for (const key of keys) {
    const number = providerNumber(row[key]);
    if (number !== undefined) return number;
  }
  throw new Error(`PVGIS 핵심 일사량 ${label}(${keys.join("/")})이 결측 또는 sentinel입니다.`);
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
    const sourceTimeUtcMs = parsePvgisTime(row.time);
    const sourceTime = new Date(sourceTimeUtcMs);
    // A PVGIS TMY deliberately selects different source years for different
    // months. Put every row on one leap-year month/day clock and retain the
    // provider timestamp separately; sorting absolute source epochs would
    // scramble the synthetic year and make most months miss lookup.
    const timeUtcMs = Date.UTC(
      2000,
      sourceTime.getUTCMonth(),
      sourceTime.getUTCDate(),
      sourceTime.getUTCHours(),
      sourceTime.getUTCMinutes(),
    );
    return {
      timeUtcMs,
      sourceTimestamp: String(row.time),
      ghiWm2: Math.max(0, requiredPvgisIrradiance(row, ["G(h)", "G(i)"], "GHI")),
      dniWm2: Math.max(0, requiredPvgisIrradiance(row, ["Gb(n)", "Gb(i)"], "DNI")),
      dhiWm2: Math.max(0, requiredPvgisIrradiance(row, ["Gd(h)", "Gd(i)"], "DHI")),
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
