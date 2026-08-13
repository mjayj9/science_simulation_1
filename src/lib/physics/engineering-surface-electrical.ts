import {
  calculateCircuit,
  interpolateCurrentAtVoltage,
  seriesVoltageAtCurrent,
  type CircuitDevice,
  type CircuitResult,
} from "./circuit";
import {
  DEFAULT_ELECTRICAL,
  singleDiodeCurve,
  type ElectricalConfig,
  type IVCurve,
  type IVPoint,
} from "./electrical";
import { clamp } from "./types";

export type EngineeringCellIvModel = "piecewise-nameplate" | "single-diode";

export interface EngineeringSurfaceElectricalSample {
  id: string;
  areaM2: number;
  poaWm2: number;
  cellTemperatureC: number;
}

export interface EngineeringSurfaceConnectionConfig {
  /** Nominal manufactured cell area. The final boundary cell may be partial. */
  nominalCellAreaM2?: number;
  parallelStrings?: number;
  cellsPerBypassSubstring?: number;
  bypassForwardVoltageV?: number;
  stringWiringResistanceOhm?: number;
  arrayWiringResistanceOhm?: number;
  cellIvModel?: EngineeringCellIvModel;
  cellCurveSamples?: number;
  circuitSamples?: number;
}

export interface EngineeringStringResult {
  id: string;
  cellCount: number;
  bypassSubstringCount: number;
  operatingCurrentA: number;
  bypassActiveCount: number;
  standaloneMppPowerW: number;
}

export interface EngineeringSurfaceElectricalResult {
  connectionModel: "explicit-series-parallel-bypass";
  cellIvModel: EngineeringCellIvModel;
  dcPowerW: number;
  dcVoltageV: number;
  dcCurrentA: number;
  idealLocalMppDcPowerW: number;
  mismatchAndWiringLossW: number;
  mismatchAndWiringLossFraction: number;
  bypassActiveCount: number;
  activeAreaM2: number;
  nominalCellAreaM2: number;
  nominalCellDensityPerM2: number;
  cellCount: number;
  partialBoundaryCellAreaM2: number;
  parallelStringCount: number;
  seriesCellCountByString: readonly number[];
  bypassSubstringCount: number;
  strings: readonly EngineeringStringResult[];
}

interface AggregatedCellCondition {
  id: string;
  areaM2: number;
  poaWm2: number;
  cellTemperatureC: number;
}

interface StringNetwork {
  id: string;
  cells: readonly CircuitDevice[];
  substrings: readonly CircuitDevice[];
  result: CircuitResult;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`);
  return value;
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative and finite.`);
  return value;
}

function integerInRange(value: number, lower: number, upper: number, label: string): number {
  if (!Number.isInteger(value) || value < lower || value > upper) {
    throw new RangeError(`${label} must be an integer in [${lower}, ${upper}].`);
  }
  return value;
}

/**
 * Converts area quadrature into equal manufactured cells without changing the
 * area integral. A single final boundary cell is allowed to be smaller than
 * the nominal cell; its nameplate currents and power scale with its area.
 */
export function aggregateSurfaceSamplesIntoCells(
  samples: readonly EngineeringSurfaceElectricalSample[],
  nominalCellAreaM2: number,
): AggregatedCellCondition[] {
  positiveFinite(nominalCellAreaM2, "Nominal cell area");
  if (samples.length === 0) throw new RangeError("At least one surface sample is required.");
  const cells: AggregatedCellCondition[] = [];
  let cellArea = 0;
  let poaArea = 0;
  let temperatureArea = 0;

  const flush = () => {
    if (cellArea <= 1e-15) return;
    cells.push({
      id: `cell-${cells.length + 1}`,
      areaM2: cellArea,
      poaWm2: poaArea / cellArea,
      cellTemperatureC: temperatureArea / cellArea,
    });
    cellArea = 0;
    poaArea = 0;
    temperatureArea = 0;
  };

  for (const [index, sample] of samples.entries()) {
    const areaM2 = positiveFinite(sample.areaM2, `Sample ${index} area`);
    const poaWm2 = nonNegativeFinite(sample.poaWm2, `Sample ${index} POA`);
    if (!Number.isFinite(sample.cellTemperatureC)) {
      throw new RangeError(`Sample ${index} temperature must be finite.`);
    }
    let remaining = areaM2;
    while (remaining > 1e-15) {
      const capacity = nominalCellAreaM2 - cellArea;
      const take = Math.min(capacity, remaining);
      cellArea += take;
      poaArea += poaWm2 * take;
      temperatureArea += sample.cellTemperatureC * take;
      remaining -= take;
      if (cellArea >= nominalCellAreaM2 - 1e-12 * nominalCellAreaM2) flush();
    }
  }
  flush();
  return cells;
}

function scaledCellConfig(reference: ElectricalConfig, areaM2: number): ElectricalConfig {
  if (reference.cellsInSeries !== 1) {
    throw new RangeError("Engineering surface wiring requires a per-cell reference with cellsInSeries=1.");
  }
  const scale = areaM2 / positiveFinite(reference.areaM2, "Reference cell area");
  return {
    ...reference,
    areaM2,
    pmaxW: reference.pmaxW * scale,
    iscA: reference.iscA * scale,
    impA: reference.impA * scale,
    seriesResistanceOhm: reference.seriesResistanceOhm / Math.max(scale, 1e-12),
    shuntResistanceOhm: reference.shuntResistanceOhm / Math.max(scale, 1e-12),
  };
}

function piecewiseNameplateCurve(
  condition: AggregatedCellCondition,
  reference: ElectricalConfig,
): IVCurve {
  const config = scaledCellConfig(reference, condition.areaM2);
  const irradianceRatio = condition.poaWm2 / positiveFinite(config.referenceIrradianceWm2, "Reference irradiance");
  const deltaC = condition.cellTemperatureC - config.referenceTemperatureC;
  if (irradianceRatio <= 0) {
    const zero: IVPoint = { voltageV: 0, currentA: 0, powerW: 0 };
    return {
      points: [zero], mpp: zero, iscA: 0, vocV: 0, converged: true,
      parameters: {
        photocurrentA: 0, saturationCurrentA: 0,
        seriesResistanceOhm: config.seriesResistanceOhm,
        shuntResistanceOhm: config.shuntResistanceOhm,
        idealityFactor: config.idealityFactor,
        cellsInSeries: 1,
        cellTemperatureC: condition.cellTemperatureC,
      },
    };
  }
  const currentTemperatureFactor = Math.max(
    0,
    1 + config.alphaIscAperC / Math.max(config.iscA, 1e-12) * deltaC,
  );
  const powerTemperatureFactor = Math.max(0, 1 + config.gammaPmpPerC * deltaC);
  const iscA = Math.max(0, config.iscA * irradianceRatio * currentTemperatureFactor);
  const impA = Math.min(iscA, Math.max(0, config.impA * irradianceRatio * currentTemperatureFactor));
  const targetPowerW = Math.max(0, config.pmaxW * irradianceRatio * powerTemperatureFactor);
  const vmpV = impA > 0 ? targetPowerW / impA : 0;
  const referenceFillVoltage = config.vmpV / Math.max(config.vocV, 1e-12);
  const vocV = vmpV / Math.max(referenceFillVoltage, 1e-6);
  const mpp = { voltageV: vmpV, currentA: impA, powerW: vmpV * impA };
  return {
    points: [
      { voltageV: 0, currentA: iscA, powerW: 0 },
      mpp,
      { voltageV: vocV, currentA: 0, powerW: 0 },
    ],
    mpp,
    iscA,
    vocV,
    converged: true,
    parameters: {
      photocurrentA: iscA,
      saturationCurrentA: 0,
      seriesResistanceOhm: config.seriesResistanceOhm,
      shuntResistanceOhm: config.shuntResistanceOhm,
      idealityFactor: config.idealityFactor,
      cellsInSeries: 1,
      cellTemperatureC: condition.cellTemperatureC,
    },
  };
}

function cellCurve(
  condition: AggregatedCellCondition,
  reference: ElectricalConfig,
  model: EngineeringCellIvModel,
  samples: number,
): IVCurve {
  if (model === "piecewise-nameplate") return piecewiseNameplateCurve(condition, reference);
  return singleDiodeCurve({
    irradianceWm2: condition.poaWm2,
    cellTemperatureC: condition.cellTemperatureC,
    config: scaledCellConfig(reference, condition.areaM2),
    points: samples,
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function partitionContiguous<T>(items: readonly T[], count: number): T[][] {
  const groups: T[][] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const length = Math.floor(items.length / count) + (index < items.length % count ? 1 : 0);
    groups.push(items.slice(offset, offset + length));
    offset += length;
  }
  return groups;
}

export function solveEngineeringSurfaceElectrical(
  samples: readonly EngineeringSurfaceElectricalSample[],
  reference: ElectricalConfig = DEFAULT_ELECTRICAL,
  config: EngineeringSurfaceConnectionConfig = {},
): EngineeringSurfaceElectricalResult {
  const nominalCellAreaM2 = config.nominalCellAreaM2 ?? reference.areaM2;
  const conditions = aggregateSurfaceSamplesIntoCells(samples, nominalCellAreaM2);
  const requestedStrings = Math.round(config.parallelStrings ?? 2);
  const parallelStringCount = integerInRange(
    Math.min(requestedStrings, conditions.length), 1, conditions.length, "Parallel string count",
  );
  const cellsPerBypassSubstring = integerInRange(
    Math.round(config.cellsPerBypassSubstring ?? 10), 1, 10_000, "Cells per bypass substring",
  );
  const bypassForwardVoltageV = nonNegativeFinite(config.bypassForwardVoltageV ?? 0.5, "Bypass forward voltage");
  const stringWiringResistanceOhm = nonNegativeFinite(config.stringWiringResistanceOhm ?? 0, "String wiring resistance");
  const arrayWiringResistanceOhm = nonNegativeFinite(config.arrayWiringResistanceOhm ?? 0, "Array wiring resistance");
  const cellIvModel = config.cellIvModel ?? "piecewise-nameplate";
  const cellCurveSamples = Math.round(clamp(config.cellCurveSamples ?? 48, 16, 512));
  const circuitSamples = Math.round(clamp(config.circuitSamples ?? 128, 32, 1024));
  const cells: CircuitDevice[] = conditions.map((condition) => ({
    id: condition.id,
    curve: cellCurve(condition, reference, cellIvModel, cellCurveSamples),
  }));
  const cellGroups = partitionContiguous(cells, parallelStringCount);
  const networks: StringNetwork[] = cellGroups.map((stringCells, stringIndex) => {
    const substringCells = chunk(stringCells, cellsPerBypassSubstring);
    const substrings: CircuitDevice[] = substringCells.map((devices, substringIndex) => ({
      id: `string-${stringIndex + 1}:substring-${substringIndex + 1}`,
      curve: calculateCircuit({
        devices,
        topology: "series",
        bypassEnabled: false,
        samples: circuitSamples,
      }),
    }));
    return {
      id: `string-${stringIndex + 1}`,
      cells: stringCells,
      substrings,
      result: calculateCircuit({
        devices: substrings,
        topology: "series",
        bypassEnabled: true,
        bypassForwardVoltageV,
        wiringResistanceOhm: stringWiringResistanceOhm,
        samples: circuitSamples,
      }),
    };
  });
  const array = calculateCircuit({
    devices: networks.map((network) => ({ id: network.id, curve: network.result })),
    topology: "parallel",
    bypassEnabled: false,
    wiringResistanceOhm: arrayWiringResistanceOhm,
    samples: circuitSamples,
  });
  let bypassActiveCount = 0;
  const strings: EngineeringStringResult[] = networks.map((network) => {
    const operatingCurrentA = interpolateCurrentAtVoltage(network.result, array.mpp.voltageV);
    const states = seriesVoltageAtCurrent(network.substrings, operatingCurrentA, {
      bypassEnabled: true,
      bypassForwardVoltageV,
      wiringResistanceOhm: stringWiringResistanceOhm,
    }).states;
    const active = states.filter((state) => state.bypassConducting).length;
    bypassActiveCount += active;
    return {
      id: network.id,
      cellCount: network.cells.length,
      bypassSubstringCount: network.substrings.length,
      operatingCurrentA,
      bypassActiveCount: active,
      standaloneMppPowerW: network.result.mpp.powerW,
    };
  });
  const idealLocalMppDcPowerW = cells.reduce((sum, cell) => sum + cell.curve.mpp.powerW, 0);
  const mismatchAndWiringLossW = Math.max(0, idealLocalMppDcPowerW - array.mpp.powerW);
  const activeAreaM2 = conditions.reduce((sum, cell) => sum + cell.areaM2, 0);
  const finalCellAreaM2 = conditions.at(-1)?.areaM2 ?? 0;
  return {
    connectionModel: "explicit-series-parallel-bypass",
    cellIvModel,
    dcPowerW: Math.max(0, array.mpp.powerW),
    dcVoltageV: Math.max(0, array.mpp.voltageV),
    dcCurrentA: Math.max(0, array.mpp.currentA),
    idealLocalMppDcPowerW,
    mismatchAndWiringLossW,
    mismatchAndWiringLossFraction: idealLocalMppDcPowerW > 0
      ? clamp(mismatchAndWiringLossW / idealLocalMppDcPowerW, 0, 1)
      : 0,
    bypassActiveCount,
    activeAreaM2,
    nominalCellAreaM2,
    nominalCellDensityPerM2: 1 / nominalCellAreaM2,
    cellCount: cells.length,
    partialBoundaryCellAreaM2: finalCellAreaM2 < nominalCellAreaM2 - 1e-12 ? finalCellAreaM2 : 0,
    parallelStringCount,
    seriesCellCountByString: strings.map((string) => string.cellCount),
    bypassSubstringCount: strings.reduce((sum, string) => sum + string.bypassSubstringCount, 0),
    strings,
  };
}
