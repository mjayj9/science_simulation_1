import { describe, expect, it } from "vitest";
import { createComparisonSurface, surfaceSamples, type ComparisonShapeKind } from "../src/lib/geometry";
import {
  createEngineeringSurfaceCellLayout,
  solveEngineeringSurfaceElectrical,
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  type EngineeringSurfaceElectricalSample,
} from "../src/lib/physics/engineering-surface-electrical";
import { DEFAULT_ELECTRICAL } from "../src/lib/physics/electrical";

/**
 * Manufactured-solution guard for the engineering connection.
 *
 * Mesh convergence proves a number stops moving as the grid refines; it cannot
 * prove the number is right, because a consistent modelling error is invariant
 * too. Under perfectly uniform irradiance and temperature every cell is
 * identical, so series mismatch is physically zero and the only loss left is
 * resistive wiring. Any shape that loses materially more than that is losing it
 * to topology, not physics.
 *
 * This is the test that would have caught the superseded sliver-cell layout,
 * where the remainder of A_PV / nominal cell area became one tiny series cell
 * that throttled its whole bypass substring: plane lost 21.9% and cone 11.0%
 * while cube, sphere, hemisphere and cylinder — whose areas happen to be exact
 * multiples of the cell area — lost only wiring.
 */

const LAND_AREA_M2 = 0.05;
const MAXIMUM_HEIGHT_M = 2 * Math.sqrt(LAND_AREA_M2 / Math.PI);
const SHAPES: readonly ComparisonShapeKind[] = [
  "plane", "cube", "sphere", "hemisphere", "cylinder", "cone",
];
const FOOTPRINT_MODES = ["static", "swept"] as const;

/** Resistive wiring at the audited topology costs well under 1%. */
const WIRING_ONLY_LOSS_CEILING = 0.01;
/** Shapes must not differ from each other by more than resistive spread. */
const CROSS_SHAPE_LOSS_SPREAD_CEILING = 0.005;

const reference = {
  ...DEFAULT_ELECTRICAL,
  efficiency: 0.2,
  pmaxW: DEFAULT_ELECTRICAL.areaM2 * 0.2 * DEFAULT_ELECTRICAL.referenceIrradianceWm2,
  gammaPmpPerC: -0.004,
  cellsInSeries: 1,
};

function uniformlyLitSamples(
  shape: ComparisonShapeKind,
  footprintMode: (typeof FOOTPRINT_MODES)[number],
  poaWm2: number,
  cellTemperatureC: number,
): EngineeringSurfaceElectricalSample[] {
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
    footprintMode,
    azimuthSamples: 32,
    meridionalSegments: 16,
  });
  return surfaceSamples(surface).map((sample, index) => ({
    id: `${shape}:${index}`,
    areaM2: sample.areaM2,
    zoneId: sample.zoneId,
    zoneIndex: sample.zoneIndex,
    u: sample.u,
    v: sample.v,
    positionM: { x: sample.position[0], y: sample.position[1], z: sample.position[2] },
    poaWm2,
    cellTemperatureC,
  }));
}

function solveUniform(
  shape: ComparisonShapeKind,
  footprintMode: (typeof FOOTPRINT_MODES)[number],
  poaWm2 = 1000,
  cellTemperatureC = 25,
) {
  const samples = uniformlyLitSamples(shape, footprintMode, poaWm2, cellTemperatureC);
  const layout = createEngineeringSurfaceCellLayout(
    samples, OFFICIAL_ENGINEERING_SURFACE_CONNECTION, DEFAULT_ELECTRICAL.areaM2,
  );
  const result = solveEngineeringSurfaceElectrical(
    samples, reference, { ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION, circuitSamples: 256 }, layout,
  );
  return {
    layout,
    result,
    lossFraction: result.mismatchAndWiringLossW / Math.max(1e-12, result.idealLocalMppDcPowerW),
  };
}

describe("engineering connection is topology-neutral under uniform illumination", () => {
  for (const footprintMode of FOOTPRINT_MODES) {
    for (const shape of SHAPES) {
      it(`${footprintMode}/${shape} loses only resistive wiring`, () => {
        const { lossFraction, result } = solveUniform(shape, footprintMode);
        expect(result.dcPowerW).toBeGreaterThan(0);
        expect(lossFraction).toBeGreaterThanOrEqual(0);
        expect(lossFraction).toBeLessThan(WIRING_ONLY_LOSS_CEILING);
      });

      it(`${footprintMode}/${shape} builds uniform series cells within each zone`, () => {
        const { layout } = solveUniform(shape, footprintMode);
        for (const zone of layout.zones) {
          const areas = zone.cellIndices.map((index) => layout.cells[index].areaM2);
          const minimum = Math.min(...areas);
          const maximum = Math.max(...areas);
          // A zone's cells carry the same series current, so unequal areas mean
          // unequal photocurrent and an artificial bottleneck.
          expect(maximum - minimum).toBeLessThanOrEqual(maximum * 1e-9);
          // No cell may exceed the manufactured nominal area.
          expect(maximum).toBeLessThanOrEqual(layout.nominalCellAreaM2 * (1 + 1e-9));
        }
        // Every parallel string must carry the same series count, or the
        // strings have different voltages and mismatch on a shared bus.
        const seriesCounts = new Set(layout.seriesCellCountByString);
        expect(seriesCounts.size).toBe(1);
      });
    }
  }

  it("does not advantage shapes whose area happens to be an exact cell multiple", () => {
    for (const footprintMode of FOOTPRINT_MODES) {
      const losses = SHAPES.map((shape) => solveUniform(shape, footprintMode).lossFraction);
      const spread = Math.max(...losses) - Math.min(...losses);
      // cube/sphere/hemisphere/cylinder divide exactly at A_land=0.05 m^2;
      // plane and cone do not. That arithmetic coincidence must not show up
      // as an energy difference.
      expect(spread).toBeLessThan(CROSS_SHAPE_LOSS_SPREAD_CEILING);
    }
  });

  it("conserves exact active area while removing sliver cells", () => {
    for (const footprintMode of FOOTPRINT_MODES) {
      for (const shape of SHAPES) {
        const { layout } = solveUniform(shape, footprintMode);
        const summed = layout.cells.reduce((total, cell) => total + cell.areaM2, 0);
        expect(Math.abs(summed - layout.activeAreaM2))
          .toBeLessThanOrEqual(Math.max(1e-12, layout.activeAreaM2 * 1e-12));
        // Trimming below nominal is allowed and recorded; a cell far below its
        // zone's uniform size is the sliver this layout exists to prevent.
        const smallest = Math.min(...layout.cells.map((cell) => cell.areaM2));
        expect(smallest).toBeGreaterThan(layout.nominalCellAreaM2 * 0.5);
      }
    }
  });

  it("keeps the Isc temperature coefficient area-independent", () => {
    // A cell's relative Isc temperature response must not depend on how the
    // surface happened to be divided.
    for (const shape of SHAPES) {
      const warm = solveUniform(shape, "static", 1000, 55);
      const cold = solveUniform(shape, "static", 1000, -5);
      expect(warm.result.dcCurrentA).toBeGreaterThan(cold.result.dcCurrentA);
      const relativeSpanPerC = (warm.result.dcCurrentA - cold.result.dcCurrentA)
        / (cold.result.dcCurrentA * 60);
      const expected = DEFAULT_ELECTRICAL.alphaIscAperC / DEFAULT_ELECTRICAL.iscA;
      expect(relativeSpanPerC).toBeGreaterThan(expected * 0.5);
      expect(relativeSpanPerC).toBeLessThan(expected * 2);
    }
  });
});
