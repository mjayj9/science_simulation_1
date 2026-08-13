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
  const hash = [...id].reduce((value, character) =>
    (value * 33 + character.charCodeAt(0)) % 10_000, 5381);
  const u = (hash + 0.5) / 10_001;
  return {
    id,
    areaM2,
    poaWm2,
    cellTemperatureC,
    zoneId: "test-skin",
    zoneIndex: 0,
    u,
    v: 0.5,
    positionM: { x: u, y: 0, z: 0 },
  };
}

function grid(rows: number, columns: number): EngineeringSurfaceElectricalSample[] {
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const u = (row + 0.5) / rows;
    const v = (column + 0.5) / columns;
    return {
      id: `grid-${row}-${column}`,
      areaM2: 1 / (rows * columns),
      poaWm2: 300 + 600 * u + 100 * v,
      cellTemperatureC: 20 + 20 * u,
      zoneId: "plane-skin", zoneIndex: 0, u, v,
      positionM: { x: v - 0.5, y: 0, z: u - 0.5 },
    };
  });
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

  it("is exactly invariant to quadrature input permutation because wiring uses material coordinates", () => {
    const samples = grid(8, 8);
    const permuted = samples.filter((_, index) => index % 2 === 0).reverse()
      .concat(samples.filter((_, index) => index % 2 === 1).reverse());
    const config = {
      nominalCellAreaM2: 0.125,
      parallelStrings: 2,
      cellsPerBypassSubstring: 2,
      bypassForwardVoltageV: 0.5,
      stringWiringResistanceOhm: 0.01,
      arrayWiringResistanceOhm: 0.01,
      circuitSamples: 512,
    } as const;
    const ordered = solveEngineeringSurfaceElectrical(samples, DEFAULT_ELECTRICAL, config);
    const shuffled = solveEngineeringSurfaceElectrical(permuted, DEFAULT_ELECTRICAL, config);
    expect(shuffled).toEqual(ordered);
    expect(ordered.layoutId).toContain("surface-spatial-u-v-row-major-v1");
    expect(ordered.layoutId).toContain("zones=0:plane-skin");
  });

  it("keeps the physical cell/string result stable when optical quadrature is refined", () => {
    const config = {
      nominalCellAreaM2: 0.125,
      parallelStrings: 2,
      cellsPerBypassSubstring: 2,
      bypassForwardVoltageV: 0.5,
      stringWiringResistanceOhm: 0.01,
      arrayWiringResistanceOhm: 0.01,
      circuitSamples: 512,
    } as const;
    const coarse = solveEngineeringSurfaceElectrical(grid(8, 8), DEFAULT_ELECTRICAL, config);
    const refined = solveEngineeringSurfaceElectrical(grid(16, 16), DEFAULT_ELECTRICAL, config);
    expect(refined.layoutId).toBe(coarse.layoutId);
    expect(refined.cellCount).toBe(coarse.cellCount);
    expect(refined.seriesCellCountByString).toEqual(coarse.seriesCellCountByString);
    expect(refined.bypassSubstringCount).toBe(coarse.bypassSubstringCount);
    expect(refined.activeAreaM2).toBeCloseTo(coarse.activeAreaM2, 12);
    expect(refined.dcPowerW).toBeCloseTo(coarse.dcPowerW, 10);
    expect(refined.idealLocalMppDcPowerW).toBeCloseTo(coarse.idealLocalMppDcPowerW, 10);
    expect(refined.mismatchAndWiringLossFraction)
      .toBeCloseTo(coarse.mismatchAndWiringLossFraction, 10);
  });
});
