import type { WeatherPoint } from "../weather";

export type SeasonalPeriodId =
  | "annual"
  | "summer"
  | "summer-solstice"
  | "hottest-day"
  | "clear-calm-hot"
  | "clear-windy-hot"
  | "cloudy-windy";

export interface DailyWeatherProfile {
  localDate: string;
  points: readonly WeatherPoint[];
  averageAmbientC: number;
  maximumAmbientC: number;
  averageWindSpeedMS: number;
  averageCloudFraction: number;
  dailyGhiWhM2: number;
}

export interface SelectedSeasonalPeriod {
  id: SeasonalPeriodId;
  labelKo: string;
  startLocalDate: string;
  endLocalDate: string;
  representativeDay?: DailyWeatherProfile;
  exactCriteriaMatch: boolean;
  selectionReasonKo: string;
}

const LABELS: Readonly<Record<SeasonalPeriodId, string>> = Object.freeze({
  annual: "연간",
  summer: "6~8월",
  "summer-solstice": "하지 대표일",
  "hottest-day": "연중 최고기온 대표일",
  "clear-calm-hot": "맑고 무풍인 고온일",
  "clear-windy-hot": "맑고 바람이 있는 고온일",
  "cloudy-windy": "흐리고 바람이 있는 날",
});

function localDate(timeUtcMs: number, offsetMinutes: number): string {
  return new Date(timeUtcMs + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function integrateDailyGhi(points: readonly WeatherPoint[]): number {
  let energy = 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const hours = (right.timeUtcMs - left.timeUtcMs) / 3_600_000;
    energy += (left.ghiWm2 + right.ghiWm2) / 2 * Math.max(0, hours);
  }
  return energy;
}

export function dailyWeatherProfiles(
  points: readonly WeatherPoint[],
  reportingOffsetMinutes = 540,
): DailyWeatherProfile[] {
  if (points.length === 0 || !Number.isFinite(reportingOffsetMinutes)) {
    throw new RangeError("Weather points and a finite reporting offset are required.");
  }
  const grouped = new Map<string, WeatherPoint[]>();
  let previous = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.timeUtcMs) || point.timeUtcMs <= previous) {
      throw new RangeError("Weather timestamps must be finite and strictly increasing.");
    }
    previous = point.timeUtcMs;
    const key = localDate(point.timeUtcMs, reportingOffsetMinutes);
    const bucket = grouped.get(key) ?? [];
    bucket.push(point);
    grouped.set(key, bucket);
  }
  return [...grouped.entries()].map(([date, dayPoints]) => ({
    localDate: date,
    points: dayPoints,
    averageAmbientC: dayPoints.reduce((sum, point) => sum + point.ambientC, 0) / dayPoints.length,
    maximumAmbientC: Math.max(...dayPoints.map((point) => point.ambientC)),
    averageWindSpeedMS: dayPoints.reduce((sum, point) => sum + point.windSpeedMs, 0) / dayPoints.length,
    averageCloudFraction: dayPoints.reduce((sum, point) => sum + point.cloudFraction, 0) / dayPoints.length,
    dailyGhiWhM2: integrateDailyGhi(dayPoints),
  }));
}

function nearestDay(days: readonly DailyWeatherProfile[], monthDay: string): DailyWeatherProfile {
  return [...days].sort((left, right) => {
    const leftDelta = Math.abs(Date.parse(`${left.localDate}T00:00:00Z`) - Date.parse(`${left.localDate.slice(0, 4)}-${monthDay}T00:00:00Z`));
    const rightDelta = Math.abs(Date.parse(`${right.localDate}T00:00:00Z`) - Date.parse(`${right.localDate.slice(0, 4)}-${monthDay}T00:00:00Z`));
    return leftDelta - rightDelta || left.localDate.localeCompare(right.localDate);
  })[0];
}

function hottest(days: readonly DailyWeatherProfile[]): DailyWeatherProfile {
  return [...days].sort((left, right) => right.maximumAmbientC - left.maximumAmbientC
    || right.dailyGhiWhM2 - left.dailyGhiWhM2
    || left.localDate.localeCompare(right.localDate))[0];
}

function selectByCriteria(
  days: readonly DailyWeatherProfile[],
  predicate: (day: DailyWeatherProfile) => boolean,
  fallbackScore: (day: DailyWeatherProfile) => number,
): { day: DailyWeatherProfile; exact: boolean } {
  const matches = days.filter(predicate);
  if (matches.length > 0) return { day: hottest(matches), exact: true };
  return {
    day: [...days].sort((left, right) => fallbackScore(right) - fallbackScore(left)
      || left.localDate.localeCompare(right.localDate))[0],
    exact: false,
  };
}

export function selectSeoulSeasonalPeriods(
  points: readonly WeatherPoint[],
  reportingOffsetMinutes = 540,
): SelectedSeasonalPeriod[] {
  const days = dailyWeatherProfiles(points, reportingOffsetMinutes);
  const summer = days.filter((day) => {
    const month = Number(day.localDate.slice(5, 7));
    return month >= 6 && month <= 8;
  });
  if (summer.length === 0) throw new RangeError("The weather series has no June-August reporting days.");
  const solstice = nearestDay(days, "06-21");
  const hottestDay = hottest(days);
  const clearCalm = selectByCriteria(
    summer,
    (day) => day.averageCloudFraction <= 0.2 && day.averageWindSpeedMS <= 2,
    (day) => day.maximumAmbientC + day.dailyGhiWhM2 / 2_000 - day.averageCloudFraction * 8 - day.averageWindSpeedMS * 2,
  );
  const clearWindy = selectByCriteria(
    summer,
    (day) => day.averageCloudFraction <= 0.2 && day.averageWindSpeedMS >= 3,
    (day) => day.maximumAmbientC + day.dailyGhiWhM2 / 2_000 - day.averageCloudFraction * 8 + day.averageWindSpeedMS,
  );
  const cloudyWindy = selectByCriteria(
    summer,
    (day) => day.averageCloudFraction >= 0.7 && day.averageWindSpeedMS >= 3,
    (day) => day.averageCloudFraction * 10 + day.averageWindSpeedMS - day.dailyGhiWhM2 / 4_000,
  );
  const first = days[0].localDate;
  const last = days.at(-1)!.localDate;
  const summerFirst = summer[0].localDate;
  const summerLast = summer.at(-1)!.localDate;
  const representative = (
    id: SeasonalPeriodId,
    selection: { day: DailyWeatherProfile; exact: boolean },
    criteria: string,
  ): SelectedSeasonalPeriod => ({
    id,
    labelKo: LABELS[id],
    startLocalDate: selection.day.localDate,
    endLocalDate: selection.day.localDate,
    representativeDay: selection.day,
    exactCriteriaMatch: selection.exact,
    selectionReasonKo: selection.exact
      ? criteria
      : `${criteria} 조건을 만족한 날이 없어 가장 가까운 실제 기상일을 표시합니다.`,
  });
  return [
    {
      id: "annual",
      labelKo: LABELS.annual,
      startLocalDate: first,
      endLocalDate: last,
      exactCriteriaMatch: true,
      selectionReasonKo: "입력 기상 시계열 전체를 사용합니다.",
    },
    {
      id: "summer",
      labelKo: LABELS.summer,
      startLocalDate: summerFirst,
      endLocalDate: summerLast,
      exactCriteriaMatch: true,
      selectionReasonKo: "현지시각 기준 6월 1일~8월 31일 자료를 사용합니다.",
    },
    representative("summer-solstice", { day: solstice, exact: solstice.localDate.endsWith("06-21") }, "6월 21일 또는 가장 가까운 실제 기상일"),
    representative("hottest-day", { day: hottestDay, exact: true }, "입력 자료에서 일 최고기온이 가장 높은 날"),
    representative("clear-calm-hot", clearCalm, "6~8월 평균 운량 ≤20%, 평균풍속 ≤2 m/s 중 최고기온 우선"),
    representative("clear-windy-hot", clearWindy, "6~8월 평균 운량 ≤20%, 평균풍속 ≥3 m/s 중 최고기온 우선"),
    representative("cloudy-windy", cloudyWindy, "6~8월 평균 운량 ≥70%, 평균풍속 ≥3 m/s"),
  ];
}
