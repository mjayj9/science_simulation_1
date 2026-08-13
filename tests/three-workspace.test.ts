import { describe, expect, it } from "vitest";
import {
  continuousSurfaceDimensions,
  createComparisonSurface,
  type ContinuousSurfaceKind,
} from "../src/lib/geometry";
import {
  cameraPoseForView,
  comparisonParcelRenderGeometry,
  continuousRenderFootprintAreaM2,
  parcelDimensionsFromArea,
  planarZonePatch,
  pointOnContinuousSurface,
  pointOnSurfaceModel,
  resolveParcelRenderGeometry,
  resolveSurfacePlacement,
  rigidSweptFootprintAreaM2,
  type ScenePanel,
} from "../src/ui/ThreeWorkspace";

describe("ThreeWorkspace land and footprint geometry", () => {
  it("does not apply comparison ground clearance twice", () => {
    const groundClearanceM = 0.017;
    for (const kind of ["plane", "cube", "sphere", "hemisphere", "cylinder", "cone"] as const) {
      const model = createComparisonSurface(kind, {
        basis: "land",
        landAreaM2: 0.05,
        maxHeightM: 1,
        maximumActiveAreaM2: 1,
        groundClearanceM,
      });
      expect(model.dimensions.groundClearanceM, kind).toBe(groundClearanceM);

      const matched = resolveSurfacePlacement(model.dimensions, groundClearanceM);
      expect(matched.translationY, kind).toBe(0);
      expect(matched.groundClearanceM, kind).toBe(groundClearanceM);
      expect(matched.displayedSupportHeightM, kind).toBe(groundClearanceM);
      for (const sample of model.zones.flatMap((region) => region.samples)) {
        // Rendering applies only translationY; physics consumes sample.position directly.
        expect(sample.position[1] + matched.translationY).toBe(sample.position[1]);
      }

      const raised = resolveSurfacePlacement(model.dimensions, 0.03);
      expect(raised.translationY, kind).toBeCloseTo(0.03 - groundClearanceM, 14);
      expect(raised.groundClearanceM, kind).toBe(0.03);
    }

    expect(resolveSurfacePlacement(undefined, groundClearanceM)).toEqual({
      translationY: groundClearanceM,
      groundClearanceM,
      displayedSupportHeightM: groundClearanceM,
    });
  });

  it("uses one synchronized top-camera pose for exact XZ footprint inspection", () => {
    const pose = cameraPoseForView("top", 2, [0, 0.1, 0]);
    expect(pose.target).toEqual([0, 0.1, 0]);
    expect(pose.position[0]).toBe(0);
    expect(pose.position[1]).toBeCloseTo(2.1, 14);
    expect(pose.position[2]).toBeCloseTo(1e-6, 14);
    expect(pose.up).toEqual([0, 0, -1]);

    const perspective = cameraPoseForView("perspective", 2, [0, 0.1, 0]);
    expect(Math.hypot(
      perspective.position[0],
      perspective.position[1] - 0.1,
      perspective.position[2],
    )).toBeCloseTo(2, 14);
    expect(perspective.up).toEqual([0, 1, 0]);
  });

  it("preserves parcel area for square and rectangular land boundaries", () => {
    const square = parcelDimensionsFromArea(0.25);
    expect(square.widthM).toBeCloseTo(0.5, 14);
    expect(square.depthM).toBeCloseTo(0.5, 14);
    expect(square.widthM * square.depthM).toBeCloseTo(0.25, 14);

    const rectangle = parcelDimensionsFromArea(0.32, 2);
    expect(rectangle.widthM / rectangle.depthM).toBeCloseTo(2, 14);
    expect(rectangle.widthM * rectangle.depthM).toBeCloseTo(0.32, 14);
  });

  it("prefers authoritative rectangle dimensions and preserves its world-Y rotation", () => {
    const parcel = resolveParcelRenderGeometry({
      shape: "rectangle",
      areaM2: 99,
      widthM: 0.3,
      depthM: 0.2,
      rotationRad: Math.PI / 3,
    });
    expect(parcel.shape).toBe("rectangle");
    expect(parcel.widthM).toBe(0.3);
    expect(parcel.depthM).toBe(0.2);
    expect(parcel.areaM2).toBeCloseTo(0.06, 14);
    expect(parcel.rotationRad).toBeCloseTo(Math.PI / 3, 14);

    const derivedDepth = resolveParcelRenderGeometry({ areaM2: 0.08, widthM: 0.4 });
    expect(derivedDepth.depthM).toBeCloseTo(0.2, 14);
    expect(derivedDepth.areaM2).toBeCloseTo(0.08, 14);
  });

  it("turns circular parcel area or authoritative diameter into an exact disk", () => {
    const byArea = resolveParcelRenderGeometry({ shape: "circle", areaM2: Math.PI * 0.2 ** 2 });
    expect(byArea.radiusM).toBeCloseTo(0.2, 14);
    expect(byArea.widthM).toBeCloseTo(0.4, 14);
    expect(byArea.depthM).toBeCloseTo(0.4, 14);
    expect(byArea.areaM2).toBeCloseTo(Math.PI * 0.2 ** 2, 14);
    expect(byArea.rotationRad).toBe(0);

    const byDiameter = resolveParcelRenderGeometry({ shape: "circle", areaM2: 1, widthM: 0.5 });
    expect(byDiameter.radiusM).toBeCloseTo(0.25, 14);
    expect(byDiameter.areaM2).toBeCloseTo(Math.PI * 0.25 ** 2, 14);
  });

  it("maps a fixed plane to its local projected rectangle before applying azimuth", () => {
    const clearanceM = 0.012;
    const model = createComparisonSurface("plane", {
      basis: "land",
      landAreaM2: 0.08,
      maxHeightM: 10,
      maximumActiveAreaM2: 10,
      layoutMode: "array",
      spacingM: 0.007,
      maintenanceClearanceM: 0.005,
      planeTiltDeg: 37,
      planeAzimuthDeg: 42,
      planeTrackingMode: "fixed",
    });
    const parcel = comparisonParcelRenderGeometry("plane", model.comparison, {
      clearanceM,
      sceneRotationRad: 0.2,
    });
    const projectedDepthM = (model.comparison.dimensions.planeSlantLengthM ?? 0)
      * Math.abs(Math.cos(37 * Math.PI / 180));
    expect(parcel.shape).toBe("rectangle");
    expect(parcel.widthM).toBeCloseTo(model.comparison.dimensions.widthM + 2 * clearanceM, 14);
    expect(parcel.depthM).toBeCloseTo(projectedDepthM + 2 * clearanceM, 14);
    expect(parcel.rotationRad).toBeCloseTo(42 * Math.PI / 180 + 0.2, 14);
    expect(parcel.widthM * parcel.depthM).toBeCloseTo(model.comparison.footprint.parcelAreaM2, 12);
  });

  it.each([
    ["plane", { planeTrackingMode: "dual-axis" as const }],
    ["cube", { footprintMode: "swept" as const }],
  ] as const)("keeps the static A_land rectangle separate from the swept %s disk", (kind, options) => {
    const model = createComparisonSurface(kind, {
      basis: "land",
      landAreaM2: 0.08,
      maxHeightM: 10,
      maximumActiveAreaM2: 10,
      ...options,
    });
    const parcel = comparisonParcelRenderGeometry(kind, model.comparison);
    expect(parcel.shape).toBe("rectangle");
    expect(parcel.areaM2).toBeCloseTo(model.comparison.footprint.staticProjectedAreaM2, 12);
    expect(model.comparison.landAreaM2).toBeCloseTo(model.comparison.footprint.sweptAreaM2, 12);
    expect(model.comparison.footprint.sweptAreaM2).toBeGreaterThanOrEqual(parcel.areaM2);
  });

  it("maps a rotationally symmetric static footprint to its exact A_land disk", () => {
    const model = createComparisonSurface("sphere", {
      basis: "land",
      landAreaM2: 0.08,
      maxHeightM: 10,
      maximumActiveAreaM2: 10,
    });
    const parcel = comparisonParcelRenderGeometry("sphere", model.comparison);
    expect(parcel.shape).toBe("circle");
    expect(parcel.areaM2).toBeCloseTo(model.comparison.landAreaM2, 12);
  });

  it("uses the rendered continuous radius for the calculated footprint", () => {
    const kinds: ContinuousSurfaceKind[] = ["sphere", "hemisphere", "cylinder", "cone"];
    kinds.forEach((kind) => {
      const dimensions = continuousSurfaceDimensions(kind);
      expect(continuousRenderFootprintAreaM2(dimensions)).toBeCloseTo(dimensions.footprintM2, 14);
    });
  });

  it("renders the hemisphere from base rim q=0 to apex q=1", () => {
    const dimensions = continuousSurfaceDimensions("hemisphere", { groundClearanceM: 0.01 });
    const { radiusM } = dimensions;
    const rim = pointOnContinuousSurface(dimensions.kind, dimensions, 0, 0.25);
    const apex = pointOnContinuousSurface(dimensions.kind, dimensions, 1, 0.25);
    expect(rim.position[0]).toBeCloseTo(radiusM, 14);
    expect(rim.position[1]).toBeCloseTo(dimensions.centreY, 14);
    expect(rim.position[2]).toBeCloseTo(0, 14);
    expect(rim.normal[0]).toBeCloseTo(1, 14);
    expect(rim.normal[1]).toBeCloseTo(0, 14);
    expect(rim.normal[2]).toBeCloseTo(0, 14);
    expect(apex.position[0]).toBeCloseTo(0, 14);
    expect(apex.position[1]).toBeCloseTo(dimensions.centreY + radiusM, 14);
    expect(apex.position[2]).toBeCloseTo(0, 14);
    expect(apex.normal).toEqual([0, 1, 0]);
    expect(continuousRenderFootprintAreaM2(dimensions)).toBeCloseTo(dimensions.footprintM2, 14);
  });

  it("contains every rendered rigid-panel corner in its Y-axis swept footprint", () => {
    const panel: ScenePanel = {
      id: "panel",
      label: "panel",
      position: [0.1, 0.05, -0.08],
      quaternion: [0, 0, 0, 1],
    };
    const expectedRadius = Math.max(
      ...[-0.025, 0.025].flatMap((x) =>
        [-0.0011, 0.0011].map((z) => Math.hypot(panel.position[0] + x, panel.position[2] + z))
      ),
    );
    expect(rigidSweptFootprintAreaM2([panel])).toBeCloseTo(Math.PI * expectedRadius ** 2, 14);
  });

  it.each(["plane", "cube"] as const)(
    "triangulates the %s IdealSurfaceModel zones at exact active and footprint area",
    (kind) => {
      const model = createComparisonSurface(kind, {
        basis: "land",
        landAreaM2: 0.08,
        maximumActiveAreaM2: 10,
        planeTiltDeg: 32,
      });
      let renderedAreaM2 = 0;
      let renderedHorizontalProjectionM2 = 0;
      model.zones.forEach((zone) => {
        const [p00, p10, , p01] = planarZonePatch(zone).corners;
        const edgeU = p10.position.map((value, axis) => value - p00.position[axis]);
        const edgeV = p01.position.map((value, axis) => value - p00.position[axis]);
        const cross = [
          edgeU[1] * edgeV[2] - edgeU[2] * edgeV[1],
          edgeU[2] * edgeV[0] - edgeU[0] * edgeV[2],
          edgeU[0] * edgeV[1] - edgeU[1] * edgeV[0],
        ];
        const areaM2 = Math.hypot(...cross);
        renderedAreaM2 += areaM2;
        renderedHorizontalProjectionM2 += Math.abs(cross[1]);
        expect(areaM2).toBeCloseTo(zone.areaM2, 12);
      });
      expect(renderedAreaM2).toBeCloseTo(model.dimensions.activeAreaM2, 12);
      expect(renderedHorizontalProjectionM2).toBeCloseTo(model.dimensions.footprintM2, 12);
    },
  );

  it("renders the land-basis cylinder top disk and lateral height from its authoritative model", () => {
    const model = createComparisonSurface("cylinder", {
      basis: "land",
      landAreaM2: 0.08,
      cylinderHeightM: 0.18,
    });
    expect(model.dimensions.includesTopDisk).toBe(true);
    const radiusM = model.dimensions.radiusM ?? 0;
    const topFraction = Math.PI * radiusM ** 2 / model.dimensions.activeAreaM2;
    const topCentre = pointOnSurfaceModel(model, 0, 0, "top");
    const topRim = pointOnSurfaceModel(model, topFraction, 0, "top");
    const lateralBottom = pointOnSurfaceModel(model, topFraction, 0, "lateral");
    const lateralTop = pointOnSurfaceModel(model, 1, 0, "lateral");
    expect(Math.hypot(topCentre.position[0], topCentre.position[2])).toBeCloseTo(0, 14);
    expect(Math.hypot(topRim.position[0], topRim.position[2])).toBeCloseTo(radiusM, 14);
    expect(topRim.position[1]).toBeCloseTo(lateralTop.position[1], 14);
    expect(lateralTop.position[1] - lateralBottom.position[1]).toBeCloseTo(model.dimensions.heightM, 14);
    expect(topRim.normal).toEqual([0, 1, 0]);
  });
});
