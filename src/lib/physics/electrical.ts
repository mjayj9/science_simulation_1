import {
  BOLTZMANN_EV_K,
  BOLTZMANN_J_K,
  ELEMENTARY_CHARGE_C,
  clamp,
} from "./types";

export interface ElectricalConfig {
  areaM2: number;
  efficiency: number;
  pmaxW: number;
  vocV: number;
  iscA: number;
  vmpV: number;
  impA: number;
  seriesResistanceOhm: number;
  shuntResistanceOhm: number;
  idealityFactor: number;
  cellsInSeries: number;
  referenceTemperatureC: number;
  referenceIrradianceWm2: number;
  alphaIscAperC: number;
  gammaPmpPerC: number;
  bandgapEv: number;
}

export const DEFAULT_ELECTRICAL: Readonly<ElectricalConfig> = Object.freeze({
  areaM2: 0.0025,
  efficiency: 0.2,
  pmaxW: 0.5,
  vocV: 0.62,
  iscA: 1.06,
  vmpV: 0.5,
  impA: 1,
  seriesResistanceOhm: 0.02,
  shuntResistanceOhm: 100,
  idealityFactor: 1,
  cellsInSeries: 1,
  referenceTemperatureC: 25,
  referenceIrradianceWm2: 1000,
  alphaIscAperC: 0.00053,
  gammaPmpPerC: -0.004,
  bandgapEv: 1.121,
});

export interface SingleDiodeParameters {
  photocurrentA: number;
  saturationCurrentA: number;
  seriesResistanceOhm: number;
  shuntResistanceOhm: number;
  idealityFactor: number;
  cellsInSeries: number;
  cellTemperatureC: number;
}

export interface SingleDiodeReference {
  parameters: SingleDiodeParameters;
  referenceIrradianceWm2: number;
  referenceTemperatureC: number;
  alphaIscAperC: number;
  bandgapEv: number;
}

export interface IVPoint {
  voltageV: number;
  currentA: number;
  powerW: number;
}

export interface IVCurve {
  points: IVPoint[];
  mpp: IVPoint;
  iscA: number;
  vocV: number;
  converged: boolean;
  parameters: SingleDiodeParameters;
}

function modifiedIdealityV(parameters: SingleDiodeParameters): number {
  return (
    parameters.idealityFactor *
    parameters.cellsInSeries *
    BOLTZMANN_J_K *
    (parameters.cellTemperatureC + 273.15) /
    ELEMENTARY_CHARGE_C
  );
}

function safeExpm1(value: number): number {
  return Math.expm1(clamp(value, -80, 80));
}

function residualAndDerivative(
  currentA: number,
  voltageV: number,
  parameters: SingleDiodeParameters,
): { residual: number; derivative: number } {
  const a = modifiedIdealityV(parameters);
  const junctionVoltage = voltageV + currentA * parameters.seriesResistanceOhm;
  const exponent = clamp(junctionVoltage / a, -80, 80);
  const diodeCurrent = parameters.saturationCurrentA * Math.expm1(exponent);
  const shuntCurrent = junctionVoltage / parameters.shuntResistanceOhm;
  return {
    residual: currentA - parameters.photocurrentA + diodeCurrent + shuntCurrent,
    derivative:
      1 +
      (parameters.saturationCurrentA * Math.exp(exponent) * parameters.seriesResistanceOhm) / a +
      parameters.seriesResistanceOhm / parameters.shuntResistanceOhm,
  };
}

export function solveSingleDiodeCurrent(
  voltageV: number,
  parameters: SingleDiodeParameters,
  toleranceA = 1e-10,
  maxIterations = 80,
): number {
  if (parameters.photocurrentA <= 0) return 0;
  if (!(parameters.saturationCurrentA >= 0) || !(parameters.shuntResistanceOhm > 0)) {
    throw new RangeError("Invalid single-diode parameters");
  }
  let lower = -Math.max(1, parameters.photocurrentA * 2 + Math.abs(voltageV) / parameters.shuntResistanceOhm);
  let upper = Math.max(1, parameters.photocurrentA * 1.5 + 0.1);
  let fLower = residualAndDerivative(lower, voltageV, parameters).residual;
  let fUpper = residualAndDerivative(upper, voltageV, parameters).residual;
  for (let expansion = 0; expansion < 24 && fLower * fUpper > 0; expansion += 1) {
    lower *= 2;
    upper *= 2;
    fLower = residualAndDerivative(lower, voltageV, parameters).residual;
    fUpper = residualAndDerivative(upper, voltageV, parameters).residual;
  }
  if (!(fLower <= 0 && fUpper >= 0)) {
    throw new Error("Unable to bracket the single-diode current root");
  }
  let current = clamp(parameters.photocurrentA - voltageV / parameters.shuntResistanceOhm, lower, upper);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const { residual, derivative } = residualAndDerivative(current, voltageV, parameters);
    if (Math.abs(residual) <= toleranceA * Math.max(1, Math.abs(current))) return current;
    if (residual > 0) {
      upper = current;
    } else {
      lower = current;
    }
    const newton = current - residual / derivative;
    current = Number.isFinite(newton) && newton > lower && newton < upper
      ? newton
      : 0.5 * (lower + upper);
  }
  const finalResidual = residualAndDerivative(current, voltageV, parameters).residual;
  if (Math.abs(finalResidual) > Math.max(1e-7, toleranceA * 100)) {
    throw new Error("Single-diode current solver did not converge");
  }
  return current;
}

export function solveOpenCircuitVoltage(parameters: SingleDiodeParameters): number {
  if (parameters.photocurrentA <= 0) return 0;
  const a = modifiedIdealityV(parameters);
  let lower = 0;
  let upper = Math.max(
    0.1,
    a * Math.log1p(parameters.photocurrentA / Math.max(parameters.saturationCurrentA, 1e-30)) * 1.25,
  );
  let upperCurrent = solveSingleDiodeCurrent(upper, parameters);
  for (let expansion = 0; expansion < 24 && upperCurrent > 0; expansion += 1) {
    upper *= 1.7;
    upperCurrent = solveSingleDiodeCurrent(upper, parameters);
  }
  if (upperCurrent > 0) throw new Error("Unable to bracket open-circuit voltage");
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = 0.5 * (lower + upper);
    const current = solveSingleDiodeCurrent(middle, parameters);
    if (Math.abs(current) < 1e-10 || upper - lower < 1e-10) return middle;
    if (current > 0) lower = middle;
    else upper = middle;
  }
  return 0.5 * (lower + upper);
}

function deriveParametersFromEndpoints(
  config: ElectricalConfig,
  seriesResistanceOhm: number,
  shuntResistanceOhm: number,
): SingleDiodeParameters | undefined {
  const parameters: SingleDiodeParameters = {
    photocurrentA: 0,
    saturationCurrentA: 0,
    seriesResistanceOhm,
    shuntResistanceOhm,
    idealityFactor: config.idealityFactor,
    cellsInSeries: config.cellsInSeries,
    cellTemperatureC: config.referenceTemperatureC,
  };
  const a = modifiedIdealityV(parameters);
  const denominator = safeExpm1(config.vocV / a) - safeExpm1(config.iscA * seriesResistanceOhm / a);
  const numerator =
    config.iscA * (1 + seriesResistanceOhm / shuntResistanceOhm) -
    config.vocV / shuntResistanceOhm;
  if (!(denominator > 0) || !(numerator > 0)) return undefined;
  parameters.saturationCurrentA = numerator / denominator;
  parameters.photocurrentA =
    parameters.saturationCurrentA * safeExpm1(config.vocV / a) +
    config.vocV / shuntResistanceOhm;
  return parameters;
}

function fitResidual(config: ElectricalConfig, rs: number, logRsh: number): { values: [number, number]; parameters?: SingleDiodeParameters } {
  const rsh = Math.exp(logRsh);
  const parameters = deriveParametersFromEndpoints(config, rs, rsh);
  if (!parameters) return { values: [1e3, 1e3] };
  let predictedCurrent: number;
  try {
    predictedCurrent = solveSingleDiodeCurrent(config.vmpV, parameters);
  } catch {
    return { values: [1e3, 1e3] };
  }
  const a = modifiedIdealityV(parameters);
  const junctionVoltage = config.vmpV + config.impA * rs;
  const exponential = Math.exp(clamp(junctionVoltage / a, -80, 80));
  const numerator = parameters.saturationCurrentA * exponential / a + 1 / rsh;
  const denominator = 1 + parameters.saturationCurrentA * exponential * rs / a + rs / rsh;
  const dIdV = -numerator / denominator;
  return {
    values: [
      (predictedCurrent - config.impA) / Math.max(config.iscA, 1e-9),
      (config.impA + config.vmpV * dIdV) / Math.max(config.iscA, 1e-9),
    ],
    parameters,
  };
}

/** Fits Rs/Rsh while holding the user-selected ideality factor fixed. */
export function fitSingleDiodeFromNameplate(config: ElectricalConfig = DEFAULT_ELECTRICAL): SingleDiodeReference {
  if (!(config.vmpV > 0 && config.vmpV < config.vocV && config.impA > 0 && config.impA < config.iscA)) {
    throw new RangeError("Nameplate values must satisfy 0<Vmp<Voc and 0<Imp<Isc");
  }
  let rs = clamp(config.seriesResistanceOhm, 1e-7, config.vocV / config.iscA * 0.95);
  let logRsh = Math.log(Math.max(config.shuntResistanceOhm, config.vocV / config.iscA));
  let best = fitResidual(config, rs, logRsh);
  let bestNorm = Math.hypot(...best.values);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    if (bestNorm < 1e-8) break;
    const hRs = Math.max(1e-7, rs * 1e-3);
    const hLog = 1e-3;
    const rRs = fitResidual(config, rs + hRs, logRsh).values;
    const rLog = fitResidual(config, rs, logRsh + hLog).values;
    const j00 = (rRs[0] - best.values[0]) / hRs;
    const j10 = (rRs[1] - best.values[1]) / hRs;
    const j01 = (rLog[0] - best.values[0]) / hLog;
    const j11 = (rLog[1] - best.values[1]) / hLog;
    const determinant = j00 * j11 - j01 * j10;
    let deltaRs = 0;
    let deltaLog = 0;
    if (Math.abs(determinant) > 1e-14) {
      deltaRs = (-best.values[0] * j11 + best.values[1] * j01) / determinant;
      deltaLog = (-j00 * best.values[1] + j10 * best.values[0]) / determinant;
    } else {
      deltaRs = -0.05 * Math.sign(best.values[0]) * Math.max(rs, 1e-3);
      deltaLog = -0.05 * Math.sign(best.values[1]);
    }
    deltaRs = clamp(deltaRs, -0.5 * rs, 0.5 * Math.max(rs, 1e-3));
    deltaLog = clamp(deltaLog, -0.75, 0.75);
    let accepted = false;
    for (let backtrack = 0; backtrack < 12; backtrack += 1) {
      const factor = 0.5 ** backtrack;
      const candidateRs = clamp(
        rs + factor * deltaRs,
        1e-8,
        config.vocV / config.iscA * 0.99,
      );
      const candidateLog = clamp(
        logRsh + factor * deltaLog,
        Math.log(config.vocV / config.iscA),
        Math.log(1e8),
      );
      const candidate = fitResidual(config, candidateRs, candidateLog);
      const norm = Math.hypot(...candidate.values);
      if (norm < bestNorm) {
        rs = candidateRs;
        logRsh = candidateLog;
        best = candidate;
        bestNorm = norm;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  const parameters = best.parameters ?? deriveParametersFromEndpoints(
    config,
    config.seriesResistanceOhm,
    config.shuntResistanceOhm,
  );
  if (!parameters) throw new Error("Unable to derive valid single-diode parameters");
  return {
    parameters,
    referenceIrradianceWm2: config.referenceIrradianceWm2,
    referenceTemperatureC: config.referenceTemperatureC,
    alphaIscAperC: config.alphaIscAperC,
    bandgapEv: config.bandgapEv,
  };
}

export function singleDiodeAtConditions(
  referenceModel: SingleDiodeReference,
  irradianceWm2: number,
  cellTemperatureC: number,
): SingleDiodeParameters {
  const irradiance = Math.max(0, irradianceWm2);
  const ratio = irradiance / referenceModel.referenceIrradianceWm2;
  const reference = referenceModel.parameters;
  const temperatureK = cellTemperatureC + 273.15;
  const referenceTemperatureK = reference.cellTemperatureC + 273.15;
  const temperatureDelta = cellTemperatureC - reference.cellTemperatureC;
  const photocurrent = ratio * Math.max(0, reference.photocurrentA + referenceModel.alphaIscAperC * temperatureDelta);
  const saturationCurrent =
    reference.saturationCurrentA *
    (temperatureK / referenceTemperatureK) ** 3 *
    Math.exp(
      (referenceModel.bandgapEv / BOLTZMANN_EV_K) *
        (1 / referenceTemperatureK - 1 / temperatureK),
    );
  return {
    photocurrentA: photocurrent,
    saturationCurrentA: Math.max(0, saturationCurrent),
    seriesResistanceOhm: reference.seriesResistanceOhm,
    shuntResistanceOhm:
      irradiance > 0
        ? reference.shuntResistanceOhm * referenceModel.referenceIrradianceWm2 / Math.max(irradiance, 1)
        : 1e12,
    idealityFactor: reference.idealityFactor,
    cellsInSeries: reference.cellsInSeries,
    cellTemperatureC,
  };
}

function maximizePower(parameters: SingleDiodeParameters, lower: number, upper: number): IVPoint {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = lower;
  let b = upper;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  const power = (voltage: number): number => voltage * Math.max(0, solveSingleDiodeCurrent(voltage, parameters));
  let pc = power(c);
  let pd = power(d);
  for (let iteration = 0; iteration < 60 && b - a > 1e-10; iteration += 1) {
    if (pc > pd) {
      b = d;
      d = c;
      pd = pc;
      c = b - ratio * (b - a);
      pc = power(c);
    } else {
      a = c;
      c = d;
      pc = pd;
      d = a + ratio * (b - a);
      pd = power(d);
    }
  }
  const voltageV = 0.5 * (a + b);
  const currentA = Math.max(0, solveSingleDiodeCurrent(voltageV, parameters));
  return { voltageV, currentA, powerW: voltageV * currentA };
}

export interface SingleDiodeCurveInput {
  irradianceWm2: number;
  cellTemperatureC: number;
  config?: ElectricalConfig;
  reference?: SingleDiodeReference;
  points?: number;
}

export function singleDiodeCurve(input: SingleDiodeCurveInput): IVCurve {
  const reference = input.reference ?? fitSingleDiodeFromNameplate(input.config ?? DEFAULT_ELECTRICAL);
  const parameters = singleDiodeAtConditions(reference, input.irradianceWm2, input.cellTemperatureC);
  if (parameters.photocurrentA <= 0) {
    const zero = { voltageV: 0, currentA: 0, powerW: 0 };
    return { points: [zero], mpp: zero, iscA: 0, vocV: 0, converged: true, parameters };
  }
  const vocV = solveOpenCircuitVoltage(parameters);
  const iscA = Math.max(0, solveSingleDiodeCurrent(0, parameters));
  const count = Math.round(clamp(input.points ?? 128, 16, 2048));
  const points: IVPoint[] = [];
  let bestIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const voltageV = vocV * index / (count - 1);
    const currentA = Math.max(0, solveSingleDiodeCurrent(voltageV, parameters));
    const point = { voltageV, currentA, powerW: voltageV * currentA };
    if (point.powerW > (points[bestIndex]?.powerW ?? -1)) bestIndex = index;
    points.push(point);
  }
  const lowerIndex = Math.max(0, bestIndex - 1);
  const upperIndex = Math.min(points.length - 1, bestIndex + 1);
  const mpp = maximizePower(parameters, points[lowerIndex].voltageV, points[upperIndex].voltageV);
  return { points, mpp, iscA, vocV, converged: true, parameters };
}

export function simpleDcPower(
  poaIrradianceWm2: number,
  cellTemperatureC: number,
  config: ElectricalConfig = DEFAULT_ELECTRICAL,
  aggregateLossFraction = 0,
): number {
  if (poaIrradianceWm2 <= 0) return 0;
  const irradiancePower = config.areaM2 * config.efficiency * poaIrradianceWm2;
  const temperatureFactor = Math.max(
    0,
    1 + config.gammaPmpPerC * (cellTemperatureC - config.referenceTemperatureC),
  );
  return Math.max(0, irradiancePower * temperatureFactor * (1 - clamp(aggregateLossFraction, 0, 1)));
}
