export interface TimePowerPoint {
  timeSeconds: number;
  powerW: number;
}

export function integrateTrapezoid(timesSeconds: readonly number[], powersW: readonly number[]): number;
export function integrateTrapezoid(points: readonly TimePowerPoint[]): number;
export function integrateTrapezoid(
  timesOrPoints: readonly number[] | readonly TimePowerPoint[],
  powers?: readonly number[],
): number {
  const times = powers === undefined
    ? (timesOrPoints as readonly TimePowerPoint[]).map((point) => point.timeSeconds)
    : (timesOrPoints as readonly number[]);
  const values = powers === undefined
    ? (timesOrPoints as readonly TimePowerPoint[]).map((point) => point.powerW)
    : powers;
  if (times.length !== values.length) throw new RangeError("Time and power arrays must have equal length");
  if (times.length < 2) return 0;
  let wattSeconds = 0;
  for (let index = 0; index < times.length - 1; index += 1) {
    const dt = times[index + 1] - times[index];
    if (!(dt >= 0) || !Number.isFinite(dt)) throw new RangeError("Times must be finite and nondecreasing");
    if (!Number.isFinite(values[index]) || !Number.isFinite(values[index + 1])) {
      throw new RangeError("Powers must be finite");
    }
    wattSeconds += 0.5 * (values[index] + values[index + 1]) * dt;
  }
  return wattSeconds / 3600;
}
