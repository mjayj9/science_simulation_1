export interface PerformanceSeriesPoint {
  /** Local wall-clock minute from the start of the reporting day. */
  minute: number;
  acPowerW: number;
  /** Optical component powers on the active PV skin before electrical losses. */
  directOpticalW: number;
  diffuseOpticalW: number;
  groundOpticalW: number;
}

export interface OpticalEnergyShares {
  direct: number;
  diffuse: number;
  ground: number;
}

export interface DailyPerformanceSummary {
  energyWh: number;
  energyWhPerLandM2: number;
  energyWhPerPvM2: number;
  maximumPowerW: number;
  maximumPowerWPerLandM2: number;
  coefficientOfVariation: number;
  generationStartMinute: number | null;
  generationEndMinute: number | null;
  morningEnergyWh: number;
  afternoonEnergyWh: number;
  opticalEnergyWh: {
    direct: number;
    diffuse: number;
    ground: number;
  };
  opticalShares: OpticalEnergyShares;
}

function finiteNonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label}은(는) 0 이상의 유한수여야 합니다.`);
  }
  return value;
}

function positiveArea(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label}은(는) 0보다 큰 유한수여야 합니다.`);
  }
  return value;
}

function validateSeries(points: readonly PerformanceSeriesPoint[]): void {
  let previousMinute = -Infinity;
  for (const [index, point] of points.entries()) {
    if (!Number.isFinite(point.minute) || point.minute <= previousMinute) {
      throw new RangeError(`성능 시계열 ${index}번 시각은 엄격한 오름차순이어야 합니다.`);
    }
    previousMinute = point.minute;
    finiteNonnegative(point.acPowerW, `성능 시계열 ${index}번 AC 출력`);
    finiteNonnegative(point.directOpticalW, `성능 시계열 ${index}번 직달 성분`);
    finiteNonnegative(point.diffuseOpticalW, `성능 시계열 ${index}번 확산 성분`);
    finiteNonnegative(point.groundOpticalW, `성능 시계열 ${index}번 지면반사 성분`);
  }
}

export function integrateSeriesWh(
  points: readonly PerformanceSeriesPoint[],
  selector: (point: PerformanceSeriesPoint) => number,
  range: { startMinute?: number; endMinute?: number } = {},
): number {
  validateSeries(points);
  const startMinute = range.startMinute ?? -Infinity;
  const endMinute = range.endMinute ?? Infinity;
  let energyWh = 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const intervalStart = Math.max(left.minute, startMinute);
    const intervalEnd = Math.min(right.minute, endMinute);
    if (!(intervalEnd > intervalStart)) continue;
    const span = right.minute - left.minute;
    const leftFraction = (intervalStart - left.minute) / span;
    const rightFraction = (intervalEnd - left.minute) / span;
    const leftValue = selector(left);
    const rightValue = selector(right);
    const valueAtStart = leftValue + (rightValue - leftValue) * leftFraction;
    const valueAtEnd = leftValue + (rightValue - leftValue) * rightFraction;
    energyWh += (valueAtStart + valueAtEnd) / 2 * (intervalEnd - intervalStart) / 60;
  }
  return energyWh;
}

function opticalShares(direct: number, diffuse: number, ground: number): OpticalEnergyShares {
  const total = direct + diffuse + ground;
  if (!(total > 0)) return { direct: 0, diffuse: 0, ground: 0 };
  return { direct: direct / total, diffuse: diffuse / total, ground: ground / total };
}

/**
 * Summarises a local reporting day without smoothing or resampling. The output
 * variation coefficient uses only strictly-generating samples so night length
 * does not masquerade as daytime instability.
 */
export function summarizeDailyPerformance(
  points: readonly PerformanceSeriesPoint[],
  landAreaM2: number,
  activeAreaM2: number,
): DailyPerformanceSummary {
  validateSeries(points);
  const landArea = positiveArea(landAreaM2, "토지 점유면적");
  const pvArea = positiveArea(activeAreaM2, "PV 활성면적");
  const energyWh = integrateSeriesWh(points, (point) => point.acPowerW);
  const direct = integrateSeriesWh(points, (point) => point.directOpticalW);
  const diffuse = integrateSeriesWh(points, (point) => point.diffuseOpticalW);
  const ground = integrateSeriesWh(points, (point) => point.groundOpticalW);
  const generating = points.filter((point) => point.acPowerW > 1e-12);
  const mean = generating.length
    ? generating.reduce((sum, point) => sum + point.acPowerW, 0) / generating.length
    : 0;
  const standardDeviation = mean > 0
    ? Math.sqrt(generating.reduce((sum, point) => sum + (point.acPowerW - mean) ** 2, 0) / generating.length)
    : 0;
  const maximumPowerW = Math.max(0, ...points.map((point) => point.acPowerW));
  return {
    energyWh,
    energyWhPerLandM2: energyWh / landArea,
    energyWhPerPvM2: energyWh / pvArea,
    maximumPowerW,
    maximumPowerWPerLandM2: maximumPowerW / landArea,
    coefficientOfVariation: mean > 0 ? standardDeviation / mean : 0,
    generationStartMinute: generating[0]?.minute ?? null,
    generationEndMinute: generating.at(-1)?.minute ?? null,
    morningEnergyWh: integrateSeriesWh(points, (point) => point.acPowerW, { endMinute: 720 }),
    afternoonEnergyWh: integrateSeriesWh(points, (point) => point.acPowerW, { startMinute: 720 }),
    opticalEnergyWh: { direct, diffuse, ground },
    opticalShares: opticalShares(direct, diffuse, ground),
  };
}

export function normalizedAnnualEnergy(
  annualEnergyWh: number,
  landAreaM2: number,
  activeAreaM2: number,
): { kWh: number; kWhPerLandM2: number; kWhPerPvM2: number } {
  const energyWh = finiteNonnegative(annualEnergyWh, "연간 AC 발전량");
  const landArea = positiveArea(landAreaM2, "토지 점유면적");
  const pvArea = positiveArea(activeAreaM2, "PV 활성면적");
  return {
    kWh: energyWh / 1000,
    kWhPerLandM2: energyWh / 1000 / landArea,
    kWhPerPvM2: energyWh / 1000 / pvArea,
  };
}
