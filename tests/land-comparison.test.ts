import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPARISON_BASIS,
  DEFAULT_LAND_AREA_M2,
  DEFAULT_MAX_HEIGHT_M,
  calculateComparisonGeometry,
  createComparisonSurface,
  projectedAreaForDirection,
  rotateSurfaceSampleAroundY,
  surfaceSamples,
  type ComparisonShapeKind,
  type SurfaceIntegrationModel,
  type Vec3,
} from "../src/lib/geometry";

const SHAPES: readonly ComparisonShapeKind[] = [
  "plane", "cube", "sphere", "hemisphere", "cylinder", "cone",
];
const A0 = 0.05;
const LAND = {
  basis: "land" as const,
  landAreaM2: A0,
  maxHeightM: 1,
  maximumAspectRatio: 10,
  maximumActiveAreaM2: 1,
  planeTiltDeg: 30,
  cylinderHeightM: 2 * Math.sqrt(A0 / Math.PI),
  coneHeightM: 2 * Math.sqrt(A0 / Math.PI),
};

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function numericalProjection(model: SurfaceIntegrationModel, direction: Vec3): number {
  const length = Math.hypot(...direction);
  return surfaceSamples(model).reduce(
    (sum, sample) => sum + sample.areaM2 * Math.max(0, dot(sample.normal, direction) / length),
    0,
  );
}

describe("equal-land comparison geometry", () => {
  it("defaults to the documented A_land and constraints", () => {
    expect(DEFAULT_COMPARISON_BASIS).toBe("land");
    expect(DEFAULT_LAND_AREA_M2).toBe(A0);
    expect(DEFAULT_MAX_HEIGHT_M).toBe(0.3);
    for (const shape of SHAPES) {
      const geometry = calculateComparisonGeometry(shape);
      expect(geometry.basis).toBe("land");
      expect(geometry.requestedLandAreaM2).toBe(A0);
      expect(geometry.landAreaM2, shape).toBeCloseTo(A0, 14);
      expect(geometry.footprint.staticProjectedAreaM2, shape).toBeCloseTo(A0, 14);
      expect(geometry.footprintIndex, shape).toBeCloseTo(100, 12);
    }
  });

  it("implements all six exact A_PV formulas without shape multipliers", () => {
    const radiusM = Math.sqrt(A0 / Math.PI);
    const tilt = LAND.planeTiltDeg * Math.PI / 180;
    const expected = {
      plane: A0 / Math.cos(tilt),
      cube: 5 * A0,
      sphere: 4 * A0,
      hemisphere: 2 * A0,
      cylinder: A0 + 2 * Math.PI * radiusM * LAND.cylinderHeightM,
      cone: Math.PI * radiusM * Math.hypot(radiusM, LAND.coneHeightM),
    } satisfies Record<ComparisonShapeKind, number>;
    for (const shape of SHAPES) {
      const geometry = calculateComparisonGeometry(shape, LAND);
      expect(geometry.landAreaM2, `${shape}.A_land`).toBeCloseTo(A0, 14);
      expect(geometry.activeAreaM2, `${shape}.A_PV`).toBeCloseTo(expected[shape], 13);
      expect(geometry.footprintIndex, shape).toBeCloseTo(100, 12);
    }
    expect(calculateComparisonGeometry("sphere", LAND).dimensions.radiusM)
      .toBeCloseTo(radiusM, 14);
  });

  it.each([0.0123, 0.2])("preserves arbitrary A_land=%f for every shape", (landAreaM2) => {
    const radiusM = Math.sqrt(landAreaM2 / Math.PI);
    for (const shape of SHAPES) {
      const geometry = calculateComparisonGeometry(shape, {
        ...LAND,
        landAreaM2,
        cylinderHeightM: 2 * radiusM,
        coneHeightM: 2 * radiusM,
      });
      expect(geometry.landAreaM2, shape).toBeCloseTo(landAreaM2, 13);
      expect(geometry.footprintIndex, shape).toBeCloseTo(100, 11);
    }
  });

  it("clamps plane tilt without changing A_land and rejects impossible solid heights", () => {
    const plane = calculateComparisonGeometry("plane", {
      ...LAND,
      planeTiltDeg: 75,
      maxHeightM: 0.04,
    });
    expect(plane.constraints.heightLimited).toBe(true);
    expect(plane.landAreaM2).toBeCloseTo(A0, 14);
    expect(plane.dimensions.heightM).toBeLessThanOrEqual(0.04 + 1e-12);
    expect(plane.dimensions.widthM).toBeCloseTo(Math.sqrt(A0), 13);
    expect(plane.dimensions.depthM).toBeCloseTo(Math.sqrt(A0), 13);
    expect(plane.dimensions.planeTiltDeg).toBeCloseTo(
      Math.atan(0.04 / Math.sqrt(A0)) * 180 / Math.PI,
      10,
    );

    const surface = createComparisonSurface("plane", {
      ...LAND,
      planeTiltDeg: 75,
      maxHeightM: 0.04,
    });
    expect(surface.comparison.dimensions.widthM).toBeCloseTo(Math.sqrt(A0), 13);
    expect(surface.comparison.dimensions.depthM).toBeCloseTo(Math.sqrt(A0), 13);
    expect(surface.comparison.dimensions.planeTiltDeg!).toBeCloseTo(
      plane.dimensions.planeTiltDeg ?? 0,
      12,
    );

    expect(() => calculateComparisonGeometry("sphere", { ...LAND, maxHeightM: 0.1 }))
      .toThrow(/sphere footprint/i);
    expect(() => calculateComparisonGeometry("cube", { ...LAND, maxHeightM: 0.1 }))
      .toThrow(/cube footprint/i);
  });

  it("uses the specified L by L default footprint and rejects tilt above 75 degrees", () => {
    const sideM = Math.sqrt(A0);
    const atThirty = calculateComparisonGeometry("plane", {
      ...LAND,
      planeAspectRatio: undefined,
      planeTiltDeg: 30,
    });
    expect(atThirty.dimensions.widthM).toBeCloseTo(sideM, 13);
    expect(atThirty.dimensions.depthM).toBeCloseTo(sideM, 13);
    expect(atThirty.dimensions.planeSlantLengthM).toBeCloseTo(
      sideM / Math.cos(Math.PI / 6),
      13,
    );

    expect(() => calculateComparisonGeometry("plane", {
      ...LAND,
      planeAspectRatio: undefined,
      planeTiltDeg: 90,
      maxHeightM: 10,
      maximumActiveAreaM2: 10,
    })).toThrow(/0~75/);
  });

  it("preserves a requested active area in the optional active-area basis", () => {
    for (const shape of SHAPES) {
      const geometry = calculateComparisonGeometry(shape, {
        basis: "active",
        activeAreaM2: A0,
        maximumActiveAreaM2: 1,
        landAreaM2: 1,
        maxHeightM: 1,
        maximumAspectRatio: 10,
        cylinderHeightM: 0.2,
        coneHeightM: 0.2,
      });
      expect(geometry.activeAreaM2, shape).toBeCloseTo(A0, 13);
    }
  });
});

describe("single continuous-skin quadrature", () => {
  it.each(SHAPES)("models %s as one skin and not twenty panels", (shape) => {
    const model = createComparisonSurface(shape, LAND);
    const expectedRegionCount = shape === "cube" ? 5 : shape === "cylinder" ? 2 : 1;
    expect(model.surfaceCount).toBe(1);
    expect(model.continuousSkinId).toBe(`${shape}-continuous-skin`);
    expect(model.zones).toHaveLength(expectedRegionCount);
    expect("nEq" in model.comparison).toBe(false);
    expect("equivalentPanelCount" in model.comparison).toBe(false);
    expect("electricalZones" in model.comparison).toBe(false);
    expect(model.zones.reduce((sum, region) => sum + region.areaM2, 0))
      .toBeCloseTo(model.comparison.activeAreaM2, 13);
    expect(surfaceSamples(model).reduce((sum, sample) => sum + sample.areaM2, 0))
      .toBeCloseTo(model.comparison.activeAreaM2, 13);
    expect(surfaceSamples(model).every((sample) => (
      Number.isFinite(sample.areaM2)
      && sample.areaM2 > 0
      && Math.abs(Math.hypot(...sample.normal) - 1) < 1e-12
    ))).toBe(true);
  });

  it.each(SHAPES)("keeps %s top projection equal to A_land", (shape) => {
    const model = createComparisonSurface(shape, { ...LAND, azimuthSamples: 64 });
    expect(projectedAreaForDirection(model, [0, 1, 0])).toBeCloseTo(A0, 13);
    expect(numericalProjection(model, [0, 1, 0])).toBeCloseTo(A0, 12);
  });

  it.each(SHAPES)("converges %s direct projection below 0.5% from Nphi=32 to 64", (shape) => {
    const direction: Vec3 = [0.51, 0.63, -0.42];
    const coarse = createComparisonSurface(shape, { ...LAND, azimuthSamples: 32 });
    const refined = createComparisonSurface(shape, { ...LAND, azimuthSamples: 64 });
    const coarseProjection = numericalProjection(coarse, direction);
    const refinedProjection = numericalProjection(refined, direction);
    expect(Math.abs(coarseProjection - refinedProjection) / Math.max(refinedProjection, 1e-15))
      .toBeLessThan(0.005);
    expect(Math.abs(refinedProjection - projectedAreaForDirection(refined, direction))
      / Math.max(projectedAreaForDirection(refined, direction), 1e-15)).toBeLessThan(0.002);
  });

  it.each(SHAPES)("keeps %s A_land invariant under arbitrary Y rotation", (shape) => {
    const model = createComparisonSurface(shape, { ...LAND, azimuthSamples: 64 });
    for (const angleRad of [0, 0.137, 1.234, Math.PI, 5.73]) {
      const projected = surfaceSamples(model).reduce((sum, base) => {
        const sample = rotateSurfaceSampleAroundY(base, angleRad);
        return sum + sample.areaM2 * Math.max(0, sample.normal[1]);
      }, 0);
      expect(projected, `${shape}@${angleRad}`).toBeCloseTo(A0, 12);
    }
  });

  it("uses configurable meridional quadrature without changing physical area", () => {
    const coarse = createComparisonSurface("cone", { ...LAND, meridionalSegments: 8 });
    const refined = createComparisonSurface("cone", { ...LAND, meridionalSegments: 16 });
    expect(refined.meridionalSegments).toBe(16);
    expect(surfaceSamples(refined)).toHaveLength(2 * surfaceSamples(coarse).length);
    for (const model of [coarse, refined]) {
      expect(surfaceSamples(model).reduce((sum, sample) => sum + sample.areaM2, 0))
        .toBeCloseTo(model.comparison.activeAreaM2, 13);
    }
  });
});
