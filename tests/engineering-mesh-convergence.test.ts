import { describe, expect, it } from "vitest";
import {
  createComparisonSurface,
  surfaceSamples,
  type ComparisonShapeKind,
} from "../src/lib/geometry";
import { DEFAULT_ELECTRICAL } from "../src/lib/physics/electrical";
import {
  aggregateSurfaceSamplesIntoCells,
  createEngineeringSurfaceCellLayout,
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  solveEngineeringSurfaceElectrical,
  type EngineeringSurfaceElectricalSample,
  type EngineeringSurfaceLayoutSample,
} from "../src/lib/physics/engineering-surface-electrical";

const SHAPES: readonly ComparisonShapeKind[] = [
  "plane", "cube", "sphere", "hemisphere", "cylinder", "cone",
];
const LEVELS = [
  { azimuthSamples: 16, meridionalSegments: 8 },
  { azimuthSamples: 32, meridionalSegments: 16 },
  { azimuthSamples: 64, meridionalSegments: 32 },
] as const;
const LAND_AREA_M2 = 0.05;
const MAXIMUM_HEIGHT_M = 2 * Math.sqrt(LAND_AREA_M2 / Math.PI);

function comparisonLayoutSamples(
  shape: ComparisonShapeKind,
  azimuthSamples: number,
  meridionalSegments: number,
): { activeAreaM2: number; samples: EngineeringSurfaceLayoutSample[] } {
  const surface = createComparisonSurface(shape, {
    basis: "land",
    landAreaM2: LAND_AREA_M2,
    maxHeightM: MAXIMUM_HEIGHT_M,
    cylinderHeightM: MAXIMUM_HEIGHT_M,
    coneHeightM: MAXIMUM_HEIGHT_M,
    planeTiltDeg: 30,
    groundClearanceM: 0,
    maximumActiveAreaM2: 1,
    maximumAspectRatio: 4,
    footprintMode: "swept",
    azimuthSamples,
    meridionalSegments,
  });
  return {
    activeAreaM2: surface.comparison.activeAreaM2,
    samples: surfaceSamples(surface).map((sample, index) => ({
      id: `${shape}:${azimuthSamples}:${meridionalSegments}:${index}`,
      areaM2: sample.areaM2,
      zoneId: sample.zoneId,
      zoneIndex: sample.zoneIndex,
      u: sample.u,
      v: sample.v,
      positionM: { x: sample.position[0], y: sample.position[1], z: sample.position[2] },
    })),
  };
}

function projectedAreaByCell(layout: ReturnType<typeof createEngineeringSurfaceCellLayout>): number[] {
  const result = Array(layout.cells.length).fill(0) as number[];
  Object.values(layout.sampleProjectionBySpatialKey).forEach((projection) => {
    projection.overlaps.forEach((overlap) => { result[overlap.cellIndex] += overlap.areaM2; });
  });
  return result;
}

function gl2LinearSamples(): EngineeringSurfaceElectricalSample[] {
  const gl2 = 1 / Math.sqrt(3);
  const samples: EngineeringSurfaceElectricalSample[] = [];
  for (let segment = 0; segment < 2; segment += 1) {
    const midpoint = (segment + 0.5) / 2;
    const halfWidth = 0.25;
    for (const node of [-gl2, gl2]) {
      const u = midpoint + halfWidth * node;
      for (let column = 0; column < 2; column += 1) {
        const v = (column + 0.5) / 2;
        samples.push({
          id: `gl2:${segment}:${node < 0 ? "left" : "right"}:${column}`,
          areaM2: 1 / 8,
          poaWm2: 100 + 200 * u,
          cellTemperatureC: 20 + 8 * u,
          zoneId: "linear-skin",
          zoneIndex: 0,
          u,
          v,
          positionM: { x: v, y: 0, z: u },
        });
      }
    }
  }
  return samples;
}

function twoBandElectricalSamples(): EngineeringSurfaceElectricalSample[] {
  return [
    { id: "bright", areaM2: 0.1, poaWm2: 1_000, cellTemperatureC: 25, u: 0.25 },
    { id: "shade", areaM2: 0.1, poaWm2: 35, cellTemperatureC: 25, u: 0.75 },
  ].map((sample) => ({
    ...sample,
    zoneId: "two-band-skin",
    zoneIndex: 0,
    v: 0.5,
    positionM: { x: sample.u, y: 0, z: 0 },
  }));
}

describe("invariant engineering surface topology and sparse optical projection", () => {
  it.each(SHAPES)("keeps %s physical topology and A_PV invariant across three independent optical meshes", (shape) => {
    const layouts = LEVELS.map((level) => {
      const fixture = comparisonLayoutSamples(shape, level.azimuthSamples, level.meridionalSegments);
      const layout = createEngineeringSurfaceCellLayout(
        fixture.samples,
        OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
        OFFICIAL_ENGINEERING_SURFACE_CONNECTION.nominalCellAreaM2,
      );
      expect(layout.activeAreaM2).toBeCloseTo(fixture.activeAreaM2, 11);
      const projected = projectedAreaByCell(layout);
      expect(projected.reduce((sum, areaM2) => sum + areaM2, 0))
        .toBeCloseTo(fixture.activeAreaM2, 11);
      projected.forEach((areaM2, index) => {
        expect(areaM2, layout.cells[index].id).toBeCloseTo(layout.cells[index].areaM2, 9);
      });
      layout.zones.forEach((zone) => {
        const zoneCells = zone.cellIndices.map((index) => layout.cells[index]);
        expect(zoneCells.reduce((sum, cell) => sum + cell.areaM2, 0))
          .toBeCloseTo(zone.areaM2, 11);
        expect(zoneCells.every((cell) => cell.zoneId === zone.zoneId
          && cell.zoneIndex === zone.zoneIndex
          && cell.uMin >= zone.uMin - 1e-12
          && cell.uMax <= zone.uMax + 1e-12)).toBe(true);
      });
      return layout;
    });
    for (const layout of layouts.slice(1)) {
      expect(layout.layoutId).toBe(layouts[0].layoutId);
      expect(layout.cells).toEqual(layouts[0].cells);
      expect(layout.seriesCellCountByString).toEqual(layouts[0].seriesCellCountByString);
      expect(layout.bypassSubstringCount).toBe(layouts[0].bypassSubstringCount);
    }
    expect(new Set(layouts.map((layout) => layout.sampleProjectionFingerprint)).size).toBe(3);
  }, 60_000);

  it("uses left/right GL2 half-segment supports and preserves a linear-u cell mean exactly", () => {
    const cells = aggregateSurfaceSamplesIntoCells(gl2LinearSamples(), 0.25);
    expect(cells).toHaveLength(4);
    expect(cells[0].poaWm2).toBeCloseTo(150, 12);
    expect(cells[1].poaWm2).toBeCloseTo(150, 12);
    expect(cells[2].poaWm2).toBeCloseTo(250, 12);
    expect(cells[3].poaWm2).toBeCloseTo(250, 12);
    expect(cells[0].cellTemperatureC).toBeCloseTo(22, 12);
    expect(cells[2].cellTemperatureC).toBeCloseTo(26, 12);
  });

  it("rejects a stale optical-address cohort but accepts phase-only position changes", () => {
    const coarse = comparisonLayoutSamples("cylinder", 16, 8);
    const refined = comparisonLayoutSamples("cylinder", 32, 16);
    const layout = createEngineeringSurfaceCellLayout(
      coarse.samples,
      OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
      DEFAULT_ELECTRICAL.areaM2,
    );
    const electrical = (samples: readonly EngineeringSurfaceLayoutSample[]) => samples.map((sample, index) => ({
      ...sample,
      id: `electrical:${index}`,
      poaWm2: 700,
      cellTemperatureC: 35,
    }));
    expect(() => solveEngineeringSurfaceElectrical(
      electrical(refined.samples), DEFAULT_ELECTRICAL, OFFICIAL_ENGINEERING_SURFACE_CONNECTION, layout,
    )).toThrow(/absent from the prebuilt projection|cohort/);
    const phaseOnly = electrical(coarse.samples).map((sample) => ({
      ...sample,
      positionM: { x: -sample.positionM.z, y: sample.positionM.y, z: sample.positionM.x },
    }));
    const result = solveEngineeringSurfaceElectrical(
      phaseOnly, DEFAULT_ELECTRICAL, OFFICIAL_ENGINEERING_SURFACE_CONNECTION, layout,
    );
    expect(result.layoutId).toBe(layout.layoutId);
  });
});

describe("engineering circuit operating extraction", () => {
  it("conserves terminal DC by cell/sample and assigns zero extraction to bypassed cells", () => {
    const result = solveEngineeringSurfaceElectrical(
      twoBandElectricalSamples(),
      { ...DEFAULT_ELECTRICAL, areaM2: 0.01, pmaxW: 2, iscA: 4.24, impA: 4 },
      {
        nominalCellAreaM2: 0.01,
        parallelStrings: 1,
        cellsPerBypassSubstring: 10,
        bypassForwardVoltageV: 0.5,
        stringWiringResistanceOhm: 0.02,
        arrayWiringResistanceOhm: 0.01,
        circuitSamples: 512,
      },
    );
    const rawW = result.cells.reduce((sum, cell) => sum + cell.rawElectricalExtractionW, 0);
    const cellTerminalW = result.cells.reduce(
      (sum, cell) => sum + cell.terminalElectricalExtractionW, 0,
    );
    const sampleTerminalW = Object.values(result.electricalExtractionWBySampleId)
      .reduce((sum, powerW) => sum + powerW, 0);
    expect(rawW).toBeGreaterThanOrEqual(result.dcPowerW - 1e-10);
    expect(cellTerminalW).toBeCloseTo(result.dcPowerW, 11);
    expect(sampleTerminalW).toBeCloseTo(result.dcPowerW, 11);
    expect(result.bypassActiveCount).toBeGreaterThan(0);
    const bypassedCells = result.cells.filter((cell) => cell.bypassConducting);
    expect(bypassedCells.length).toBeGreaterThan(0);
    expect(bypassedCells.every((cell) => cell.rawElectricalExtractionW === 0
      && cell.terminalElectricalExtractionW === 0)).toBe(true);
    expect(result.electricalExtractionWBySampleId.shade).toBe(0);
    expect(Object.values(result.electricalExtractionWBySampleId)
      .every((powerW) => Number.isFinite(powerW) && powerW >= 0)).toBe(true);
  });
});
