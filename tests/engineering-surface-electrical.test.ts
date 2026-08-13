import { describe, expect, it } from "vitest";
import { DEFAULT_ELECTRICAL } from "../src/lib/physics/electrical";
import {
  aggregateSurfaceSamplesIntoCells,
  solveEngineeringSurfaceElectrical,
  type EngineeringSurfaceElectricalSample,
} from "../src/lib/physics/engineering-surface-electrical";

function sample(
  id: string,
  areaM2: number,
  poaWm2 = 1_000,
  cellTemperatureC = 25,
): EngineeringSurfaceElectricalSample {
  return { id, areaM2, poaWm2, cellTemperatureC };
}

describe("engineering surface series/parallel/bypass connection", () => {
  it("conserves active area and area-weighted cell conditions at quadrature boundaries", () => {
    const source = [
      sample("a", 0.013, 900, 20),
      sample("b", 0.024, 300, 50),
      sample("c", 0.004, 700, 30),
    ];
    const cells = aggregateSurfaceSamplesIntoCells(source, 0.01);
    expect(cells).toHaveLength(5);
    expect(cells.reduce((sum, cell) => sum + cell.areaM2, 0)).toBeCloseTo(0.041, 12);
    expect(cells.at(-1)?.areaM2).toBeCloseTo(0.001, 12);
    expect(cells.reduce((sum, cell) => sum + cell.poaWm2 * cell.areaM2, 0)).toBeCloseTo(
      source.reduce((sum, point) => sum + point.poaWm2 * point.areaM2, 0),
      12,
    );
    expect(cells.reduce((sum, cell) => sum + cell.cellTemperatureC * cell.areaM2, 0)).toBeCloseTo(
      source.reduce((sum, point) => sum + point.cellTemperatureC * point.areaM2, 0),
      12,
    );
  });

  it("matches the local-cell MPP upper bound for uniform cells and balanced zero-resistance strings", () => {
    const result = solveEngineeringSurfaceElectrical(
      [sample("uniform", 0.2)],
      { ...DEFAULT_ELECTRICAL, areaM2: 0.01, pmaxW: 2, iscA: 4.24, impA: 4 },
      {
        nominalCellAreaM2: 0.01,
        parallelStrings: 2,
        cellsPerBypassSubstring: 5,
        stringWiringResistanceOhm: 0,
        arrayWiringResistanceOhm: 0,
        circuitSamples: 512,
      },
    );
    expect(result.cellCount).toBe(20);
    expect(result.parallelStringCount).toBe(2);
    expect(result.seriesCellCountByString).toEqual([10, 10]);
    expect(result.bypassSubstringCount).toBe(4);
    expect(result.bypassActiveCount).toBe(0);
    expect(result.dcPowerW / result.idealLocalMppDcPowerW).toBeGreaterThan(0.998);
    expect(result.mismatchAndWiringLossFraction).toBeLessThan(0.002);
  });

  it("activates substring bypass under strong nonuniform illumination and never exceeds the ideal upper bound", () => {
    const result = solveEngineeringSurfaceElectrical(
      [sample("bright", 0.1, 1_000), sample("shade", 0.1, 40)],
      { ...DEFAULT_ELECTRICAL, areaM2: 0.01, pmaxW: 2, iscA: 4.24, impA: 4 },
      {
        nominalCellAreaM2: 0.01,
        parallelStrings: 1,
        cellsPerBypassSubstring: 10,
        bypassForwardVoltageV: 0.5,
      },
    );
    expect(result.bypassActiveCount).toBeGreaterThan(0);
    expect(result.dcPowerW).toBeGreaterThanOrEqual(0);
    expect(result.dcPowerW).toBeLessThanOrEqual(result.idealLocalMppDcPowerW + 1e-9);
    expect(result.mismatchAndWiringLossW).toBeGreaterThan(0);
  });

  it("returns zero power at night without negative generation", () => {
    const result = solveEngineeringSurfaceElectrical(
      [sample("night", 0.05, 0, -5)],
      DEFAULT_ELECTRICAL,
      { parallelStrings: 2, cellsPerBypassSubstring: 5 },
    );
    expect(result.dcPowerW).toBe(0);
    expect(result.dcVoltageV).toBe(0);
    expect(result.dcCurrentA).toBe(0);
    expect(result.idealLocalMppDcPowerW).toBe(0);
    expect(result.mismatchAndWiringLossFraction).toBe(0);
  });

  it("is deterministic for identical cell density, connection and samples", () => {
    const samples = [sample("one", 0.075, 820, 37), sample("two", 0.036, 410, 44)];
    const config = {
      nominalCellAreaM2: 0.01,
      parallelStrings: 2,
      cellsPerBypassSubstring: 4,
      stringWiringResistanceOhm: 0.02,
      arrayWiringResistanceOhm: 0.01,
    } as const;
    const first = solveEngineeringSurfaceElectrical(samples, DEFAULT_ELECTRICAL, config);
    const second = solveEngineeringSurfaceElectrical(samples, DEFAULT_ELECTRICAL, config);
    expect(second).toEqual(first);
    expect(first.activeAreaM2).toBeCloseTo(0.111, 12);
    expect(first.nominalCellDensityPerM2).toBe(100);
  });
});
