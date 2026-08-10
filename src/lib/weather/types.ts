export type WeatherProvider = "open-meteo" | "pvgis" | "nasa-power" | "offline" | "manual";
export type WeatherDataKind = "observation" | "forecast" | "reanalysis" | "tmy" | "model-estimate" | "manual";
export type OfflineWeatherPreset = "clear" | "partly-cloudy" | "overcast" | "rain" | "night";

export interface WeatherProvenance {
  provider: WeatherProvider;
  kind: WeatherDataKind;
  labelKo: string;
  fetchedAt: string;
  temporalResolution: string;
  spatialResolution?: string;
  requestUrl?: string;
  fallbackReason?: string;
  corsCaveatKo?: string;
}

export interface WeatherPoint {
  timeUtcMs: number;
  ghiWm2: number;
  dniWm2: number;
  dhiWm2: number;
  ambientC: number;
  windSpeedMs: number;
  windDirectionDeg: number;
  gustMs: number;
  cloudFraction: number;
  precipitationMm: number;
}

export interface WeatherSeries {
  points: WeatherPoint[];
  provenance: WeatherProvenance;
}

export interface WeatherRangeRequest {
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM?: number;
  start: Date | string | number;
  end: Date | string | number;
  stepMinutes?: number;
  timezone?: string;
  seed?: string;
  offlinePreset?: OfflineWeatherPreset;
}

export const WEATHER_PROVENANCE_LABELS: Readonly<Record<WeatherDataKind, string>> = {
  observation: "관측 자료",
  forecast: "예보 자료",
  reanalysis: "재분석 자료",
  tmy: "대표 기상년(TMY)",
  "model-estimate": "모델 추정값",
  manual: "사용자 입력",
};

export function provenance(
  provider: WeatherProvider,
  kind: WeatherDataKind,
  patch: Partial<Omit<WeatherProvenance, "provider" | "kind" | "labelKo">> = {},
): WeatherProvenance {
  return {
    provider,
    kind,
    labelKo: WEATHER_PROVENANCE_LABELS[kind],
    fetchedAt: patch.fetchedAt ?? new Date().toISOString(),
    temporalResolution: patch.temporalResolution ?? "unknown",
    ...(patch.spatialResolution ? { spatialResolution: patch.spatialResolution } : {}),
    ...(patch.requestUrl ? { requestUrl: patch.requestUrl } : {}),
    ...(patch.fallbackReason ? { fallbackReason: patch.fallbackReason } : {}),
    ...(patch.corsCaveatKo ? { corsCaveatKo: patch.corsCaveatKo } : {}),
  };
}

export function assertWeatherSeries(series: WeatherSeries): WeatherSeries {
  if (series.points.length === 0) throw new Error("기상 시계열이 비어 있습니다.");
  let previous = -Infinity;
  series.points.forEach((point, index) => {
    const numeric = Object.entries(point).filter(([, value]) => typeof value === "number");
    if (numeric.some(([, value]) => !Number.isFinite(value))) {
      throw new Error(`기상 시계열 ${index}번째 행에 비유한 값이 있습니다.`);
    }
    if (point.timeUtcMs <= previous) throw new Error("기상 시각은 중복 없이 오름차순이어야 합니다.");
    if (point.ghiWm2 < 0 || point.dniWm2 < 0 || point.dhiWm2 < 0 || point.windSpeedMs < 0) {
      throw new Error(`기상 시계열 ${index}번째 행에 음수 물리량이 있습니다.`);
    }
    previous = point.timeUtcMs;
  });
  return series;
}
