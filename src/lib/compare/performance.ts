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

export interface PlaneTiltOptimizationInput {
  /** Annual AC energy evaluator for one fixed, south-facing plane tilt. */
  evaluateAnnualEnergyWh: (tiltDeg: number) => number;
  minimumTiltDeg?: number;
  maximumTiltDeg?: number;
  /** First-pass grid spacing. The optimum is then refined locally. */
  coarseStepDeg?: number;
  /** Stop once the local search interval is no wider than this value. */
  toleranceDeg?: number;
}

export interface PlaneTiltOptimizationResult {
  tiltDeg: number;
  annualEnergyWh: number;
  evaluations: number;
  searchRangeDeg: readonly [number, number];
  method: "bounded-grid-golden-section";
}

/**
 * Numerically finds the best fixed plane tilt from the caller's authoritative
 * annual-energy model. No latitude rule or empirical shape multiplier is
 * hidden in this helper; weather, optics, temperature and inverter behaviour
 * all enter through `evaluateAnnualEnergyWh`.
 */
export function optimizeAnnualFixedPlaneTilt(
  input: PlaneTiltOptimizationInput,
): PlaneTiltOptimizationResult {
  const minimum = input.minimumTiltDeg ?? 0;
  const maximum = input.maximumTiltDeg ?? 75;
  const coarseStep = input.coarseStepDeg ?? 5;
  const tolerance = input.toleranceDeg ?? 0.05;
  if (![minimum, maximum, coarseStep, tolerance].every(Number.isFinite)) {
    throw new RangeError("Plane-tilt search inputs must be finite.");
  }
  if (minimum < 0 || maximum > 90 || maximum <= minimum) {
    throw new RangeError("Plane-tilt search must satisfy 0 <= minimum < maximum <= 90 degrees.");
  }
  if (coarseStep <= 0 || coarseStep > maximum - minimum || tolerance <= 0) {
    throw new RangeError("Plane-tilt search steps must be positive and bounded by the search range.");
  }

  let evaluations = 0;
  const cache = new Map<number, number>();
  const evaluate = (tiltDeg: number): number => {
    const bounded = Math.min(maximum, Math.max(minimum, tiltDeg));
    const key = Math.round(bounded * 1e9) / 1e9;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const energy = input.evaluateAnnualEnergyWh(key);
    if (!Number.isFinite(energy) || energy < 0) {
      throw new RangeError("Plane-tilt annual energy must be a finite nonnegative value.");
    }
    cache.set(key, energy);
    evaluations += 1;
    return energy;
  };

  const grid: number[] = [];
  for (let tilt = minimum; tilt < maximum; tilt += coarseStep) grid.push(tilt);
  grid.push(maximum);
  let bestTilt = grid[0];
  let bestEnergy = evaluate(bestTilt);
  for (let index = 1; index < grid.length; index += 1) {
    const energy = evaluate(grid[index]);
    if (energy > bestEnergy) {
      bestTilt = grid[index];
      bestEnergy = energy;
    }
  }

  const bestIndex = grid.indexOf(bestTilt);
  let lower = grid[Math.max(0, bestIndex - 1)];
  let upper = grid[Math.min(grid.length - 1, bestIndex + 1)];
  // A boundary optimum is already bracketed by the domain boundary and its
  // closest grid neighbour. Golden-section refinement remains valid there.
  const ratio = (Math.sqrt(5) - 1) / 2;
  let left = upper - ratio * (upper - lower);
  let right = lower + ratio * (upper - lower);
  let leftEnergy = evaluate(left);
  let rightEnergy = evaluate(right);
  while (upper - lower > tolerance) {
    if (leftEnergy < rightEnergy) {
      lower = left;
      left = right;
      leftEnergy = rightEnergy;
      right = lower + ratio * (upper - lower);
      rightEnergy = evaluate(right);
    } else {
      upper = right;
      right = left;
      rightEnergy = leftEnergy;
      left = upper - ratio * (upper - lower);
      leftEnergy = evaluate(left);
    }
  }
  const candidates = [
    [bestTilt, bestEnergy] as const,
    [lower, evaluate(lower)] as const,
    [left, leftEnergy] as const,
    [right, rightEnergy] as const,
    [upper, evaluate(upper)] as const,
  ].sort((first, second) => second[1] - first[1] || first[0] - second[0]);

  return {
    tiltDeg: candidates[0][0],
    annualEnergyWh: candidates[0][1],
    evaluations,
    searchRangeDeg: [minimum, maximum],
    method: "bounded-grid-golden-section",
  };
}
