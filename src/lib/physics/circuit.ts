import { clamp } from "./types";
import type { IVCurve, IVPoint } from "./electrical";

export interface CircuitDevice {
  id: string;
  curve: Pick<IVCurve, "points" | "iscA" | "vocV" | "mpp">;
}

export interface BypassState {
  deviceId: string;
  bypassConducting: boolean;
  voltageV: number;
  currentA: number;
}

export interface CircuitInput {
  devices: readonly CircuitDevice[];
  topology: "series" | "parallel";
  bypassEnabled?: boolean;
  bypassForwardVoltageV?: number;
  samples?: number;
  wiringResistanceOhm?: number;
}

export interface CircuitResult {
  points: IVPoint[];
  mpp: IVPoint;
  iscA: number;
  vocV: number;
  deviceStates: BypassState[];
  topology: "series" | "parallel";
  mismatchLossFraction: number;
}

/**
 * I-V curves are generated in ascending-voltage order, so the sort is almost
 * always a no-op. Detecting that costs one linear scan and avoids copying and
 * sorting an array on every interpolation — and interpolation is the innermost
 * operation of the annual solve, running on the order of 10^9 times. Order is
 * still normalised when a caller supplies an unordered curve, so results are
 * unchanged either way.
 */
function pointsAscendingVoltage(curve: CircuitDevice["curve"]): readonly IVPoint[] {
  const points = curve.points;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1].voltageV > points[index].voltageV) {
      return [...points].sort((left, right) => left.voltageV - right.voltageV);
    }
  }
  return points;
}

/** Descending-current order, which is ascending-voltage reversed. */
function pointsDescendingCurrent(curve: CircuitDevice["curve"]): readonly IVPoint[] {
  const points = curve.points;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1].currentA < points[index].currentA) {
      return [...points].sort((left, right) => right.currentA - left.currentA);
    }
  }
  return points;
}

export function interpolateCurrentAtVoltage(curve: CircuitDevice["curve"], voltageV: number): number {
  if (curve.points.length === 0 || voltageV >= curve.vocV) return 0;
  if (voltageV <= 0) return Math.max(0, curve.iscA);
  const points = pointsAscendingVoltage(curve);
  let lower = 0;
  let upper = points.length - 1;
  while (upper - lower > 1) {
    const middle = (lower + upper) >>> 1;
    if (points[middle].voltageV <= voltageV) lower = middle;
    else upper = middle;
  }
  const a = points[lower];
  const b = points[upper];
  const fraction = (voltageV - a.voltageV) / Math.max(1e-15, b.voltageV - a.voltageV);
  return Math.max(0, a.currentA + (b.currentA - a.currentA) * fraction);
}

export function interpolateVoltageAtCurrent(curve: CircuitDevice["curve"], currentA: number): number {
  if (curve.points.length === 0) return 0;
  if (currentA <= 0) return curve.vocV;
  if (currentA >= curve.iscA) return 0;
  const points = pointsDescendingCurrent(curve);
  let lower = 0;
  let upper = points.length - 1;
  while (upper - lower > 1) {
    const middle = (lower + upper) >>> 1;
    if (points[middle].currentA >= currentA) lower = middle;
    else upper = middle;
  }
  const a = points[lower];
  const b = points[upper];
  const fraction = (a.currentA - currentA) / Math.max(1e-15, a.currentA - b.currentA);
  return Math.max(0, a.voltageV + (b.voltageV - a.voltageV) * fraction);
}

export function seriesVoltageAtCurrent(
  devices: readonly CircuitDevice[],
  currentA: number,
  options: { bypassEnabled?: boolean; bypassForwardVoltageV?: number; wiringResistanceOhm?: number } = {},
): { voltageV: number; states: BypassState[] } {
  const bypassEnabled = options.bypassEnabled ?? true;
  const bypassDrop = Math.max(0, options.bypassForwardVoltageV ?? 0.5);
  const states = devices.map((device): BypassState => {
    const bypassConducting = bypassEnabled && currentA > device.curve.iscA * (1 + 1e-9);
    const voltageV = bypassConducting
      ? -bypassDrop
      : interpolateVoltageAtCurrent(device.curve, Math.min(currentA, device.curve.iscA));
    return { deviceId: device.id, bypassConducting, voltageV, currentA };
  });
  const deviceVoltage = states.reduce((sum, state) => sum + state.voltageV, 0);
  return {
    voltageV: deviceVoltage - currentA * Math.max(0, options.wiringResistanceOhm ?? 0),
    states,
  };
}

export function parallelCurrentAtVoltage(
  devices: readonly CircuitDevice[],
  voltageV: number,
): { currentA: number; states: BypassState[] } {
  const states = devices.map((device): BypassState => ({
    deviceId: device.id,
    bypassConducting: false,
    voltageV,
    currentA: interpolateCurrentAtVoltage(device.curve, voltageV),
  }));
  return { currentA: states.reduce((sum, state) => sum + state.currentA, 0), states };
}

function goldenMaximum(
  evaluate: (x: number) => IVPoint,
  lower: number,
  upper: number,
): IVPoint {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = lower;
  let b = upper;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  let pc = evaluate(c);
  let pd = evaluate(d);
  for (let iteration = 0; iteration < 60 && b - a > 1e-10; iteration += 1) {
    if (pc.powerW > pd.powerW) {
      b = d;
      d = c;
      pd = pc;
      c = b - ratio * (b - a);
      pc = evaluate(c);
    } else {
      a = c;
      c = d;
      pc = pd;
      d = a + ratio * (b - a);
      pd = evaluate(d);
    }
  }
  return evaluate((a + b) / 2);
}

function idealMppSum(devices: readonly CircuitDevice[]): number {
  return devices.reduce((sum, device) => sum + Math.max(0, device.curve.mpp.powerW), 0);
}

export function calculateCircuit(input: CircuitInput): CircuitResult {
  if (input.devices.length === 0) throw new RangeError("Circuit requires at least one device");
  const samples = Math.round(clamp(input.samples ?? 512, 32, 4096));
  const points: IVPoint[] = [];
  let bestIndex = 0;
  let evaluate: (coordinate: number) => IVPoint;
  let maximumCoordinate: number;
  let iscA: number;
  let vocV: number;

  if (input.topology === "series") {
    const bypassEnabled = input.bypassEnabled ?? true;
    iscA = bypassEnabled
      ? Math.max(...input.devices.map((device) => device.curve.iscA))
      : Math.min(...input.devices.map((device) => device.curve.iscA));
    vocV = input.devices.reduce((sum, device) => sum + device.curve.vocV, 0);
    maximumCoordinate = iscA;
    evaluate = (currentA: number) => {
      const result = seriesVoltageAtCurrent(input.devices, currentA, input);
      const voltageV = Math.max(0, result.voltageV);
      return { voltageV, currentA, powerW: voltageV * currentA };
    };
  } else {
    iscA = input.devices.reduce((sum, device) => sum + device.curve.iscA, 0);
    vocV = Math.max(...input.devices.map((device) => device.curve.vocV));
    maximumCoordinate = vocV;
    evaluate = (voltageV: number) => {
      const result = parallelCurrentAtVoltage(input.devices, voltageV);
      const currentA = Math.max(0, result.currentA);
      const terminalVoltageV = Math.max(
        0,
        voltageV - currentA * Math.max(0, input.wiringResistanceOhm ?? 0),
      );
      return { voltageV: terminalVoltageV, currentA, powerW: terminalVoltageV * currentA };
    };
  }

  for (let index = 0; index < samples; index += 1) {
    const coordinate = maximumCoordinate * index / (samples - 1);
    const point = evaluate(coordinate);
    if (point.powerW > (points[bestIndex]?.powerW ?? -1)) bestIndex = index;
    points.push(point);
  }
  const lowerCoordinate = maximumCoordinate * Math.max(0, bestIndex - 1) / (samples - 1);
  const upperCoordinate = maximumCoordinate * Math.min(samples - 1, bestIndex + 1) / (samples - 1);
  const mpp = goldenMaximum(evaluate, lowerCoordinate, upperCoordinate);
  const deviceStates = input.topology === "series"
    ? seriesVoltageAtCurrent(input.devices, mpp.currentA, input).states
    : parallelCurrentAtVoltage(
        input.devices,
        mpp.voltageV + mpp.currentA * Math.max(0, input.wiringResistanceOhm ?? 0),
      ).states;
  const ideal = idealMppSum(input.devices);
  return {
    points,
    mpp,
    iscA,
    vocV,
    deviceStates,
    topology: input.topology,
    mismatchLossFraction: ideal > 0 ? clamp(1 - mpp.powerW / ideal, 0, 1) : 0,
  };
}
