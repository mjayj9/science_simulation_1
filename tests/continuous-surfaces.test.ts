import { describe, expect, it } from "vitest";
import {
  ELECTRICAL_ZONE_COUNT,
  PANEL_AREA_M2,
  TOTAL_ACTIVE_AREA_M2,
  coneProjectedAreaForDirection,
  continuousSurfaceDimensions,
  createContinuousSurface,
  maximumConeProjectedArea,
  pointOnContinuousSurface,
  projectedAreaForDirection,
  rotateSurfaceSampleAroundY,
  surfaceSamples,
  type ContinuousSurfaceKind,
  type ContinuousSurfaceModel,
  type Vec3,
} from "../src/lib/geometry";
import { calculatePOA } from "../src/lib/physics/irradiance";

const KINDS: ContinuousSurfaceKind[] = ["sphere", "hemisphere", "cylinder", "cone"];

function unitSun(elevationDeg: number, azimuthDeg: number): Vec3 {
  const elevation = elevationDeg * Math.PI / 180;
  const azimuth = azimuthDeg * Math.PI / 180;
  return [
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function numericalProjectedArea(
  model: ContinuousSurfaceModel,
  direction: Vec3,
  angleRad = 0,
): number {
  return surfaceSamples(model).reduce((sum, baseSample) => {
    const sample = angleRad === 0 ? baseSample : rotateSurfaceSampleAroundY(baseSample, angleRad);
    return sum + sample.areaM2 * Math.max(0, dot(sample.normal, direction));
  }, 0);
}

function integratedPoa(
  kind: ContinuousSurfaceKind,
  azimuthSamples: number,
  elevationDeg: number,
  azimuthDeg: number,
  options: {
    rotationAngleRad?: number;
    albedo?: number;
    diffuseModel?: "hay-davies" | "isotropic";
  } = {},
): { directW: number; totalW: number } {
  const model = createContinuousSurface(kind, azimuthSamples);
  const direction = unitSun(elevationDeg, azimuthDeg);
  const dniWm2 = 800;
  const dhiWm2 = 100;
  const ghiWm2 = dniWm2 * direction[1] + dhiWm2;
  let directW = 0;
  let totalW = 0;
  for (const baseSample of surfaceSamples(model)) {
    const sample = options.rotationAngleRad === undefined
      ? baseSample
      : rotateSurfaceSampleAroundY(baseSample, options.rotationAngleRad);
    const poa = calculatePOA({
      ghiWm2,
      dniWm2,
      dhiWm2,
      solarZenithDeg: 90 - elevationDeg,
      sunDirection: { x: direction[0], y: direction[1], z: direction[2] },
      panelNormal: { x: sample.normal[0], y: sample.normal[1], z: sample.normal[2] },
      albedo: options.albedo ?? 0.2,
      iam: { model: "ashrae", b0: 0.05 },
      diffuseModel: options.diffuseModel ?? "hay-davies",
      extraterrestrialNormalWm2: 1361,
    });
    directW += poa.directPoaWm2 * sample.areaM2;
    totalW += poa.totalWm2 * sample.areaM2;
  }
  return { directW, totalW };
}

describe("continuous PV surface dimensions and equal-area zones", () => {
  it("uses the exact 0.050 m² area-preserving dimensions", () => {
    const sphere = continuousSurfaceDimensions("sphere");
    expect(sphere.radiusM).toBeCloseTo(Math.sqrt(0.05 / (4 * Math.PI)), 14);
    expect(4 * Math.PI * sphere.radiusM ** 2).toBeCloseTo(TOTAL_ACTIVE_AREA_M2, 14);

    const hemisphere = continuousSurfaceDimensions("hemisphere");
    expect(2 * Math.PI * hemisphere.radiusM ** 2).toBeCloseTo(TOTAL_ACTIVE_AREA_M2, 14);
    expect(hemisphere.heightM).toBeCloseTo(hemisphere.radiusM, 14);

    const cylinder = continuousSurfaceDimensions("cylinder", { cylinderAspectRatio: 1.7 });
    expect(2 * Math.PI * cylinder.radiusM * cylinder.heightM).toBeCloseTo(TOTAL_ACTIVE_AREA_M2, 14);
    expect(cylinder.heightM / (2 * cylinder.radiusM)).toBeCloseTo(1.7, 14);

    const cone = continuousSurfaceDimensions("cone", { coneAspectRatio: 2.4 });
    expect(cone.slantHeightM).toBeCloseTo(Math.hypot(cone.radiusM, cone.heightM), 14);
    expect(Math.PI * cone.radiusM * cone.slantHeightM!).toBeCloseTo(TOTAL_ACTIVE_AREA_M2, 14);
    expect(cone.heightM / cone.radiusM).toBeCloseTo(2.4, 14);
  });

  it.each(KINDS)("partitions %s into twenty full-azimuth zones with exact weights", (kind) => {
    const model = createContinuousSurface(kind, 32);
    expect(model.zones).toHaveLength(ELECTRICAL_ZONE_COUNT);
    expect(model.azimuthSamples).toBe(32);
    expect(model.meridionalOrder).toBe(2);
    expect(model.zones[0].qMin).toBe(0);
    expect(model.zones.at(-1)?.qMax).toBe(1);

    model.zones.forEach((zone, index) => {
      expect(zone.index).toBe(index);
      expect(zone.qMin).toBe(index / ELECTRICAL_ZONE_COUNT);
      expect(zone.qMax).toBe((index + 1) / ELECTRICAL_ZONE_COUNT);
      expect(zone.areaM2).toBe(PANEL_AREA_M2);
      expect(zone.samples).toHaveLength(64);
      expect(zone.samples.reduce((sum, sample) => sum + sample.areaM2, 0)).toBeCloseTo(PANEL_AREA_M2, 14);
      expect(zone.samples.every((sample) => sample.v > 0 && sample.v < 1)).toBe(true);
    });
    expect(surfaceSamples(model).reduce((sum, sample) => sum + sample.areaM2, 0)).toBeCloseTo(0.05, 14);
  });

  it.each(KINDS)("keeps %s quadrature nodes finite, unit-normal and away from singular vertices", (kind) => {
    const model = createContinuousSurface(kind, 32);
    for (const sample of surfaceSamples(model)) {
      expect(sample.u).toBeGreaterThan(0);
      expect(sample.u).toBeLessThan(1);
      expect([...sample.position, ...sample.normal, sample.areaM2].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...sample.normal)).toBeCloseTo(1, 13);
      if (kind === "sphere" || kind === "hemisphere" || kind === "cone") {
        expect(Math.hypot(sample.position[0], sample.position[2])).toBeGreaterThan(1e-8);
      }
    }
  });

  it("validates the periodic azimuth density independently of render tessellation", () => {
    expect(createContinuousSurface("sphere").azimuthSamples).toBe(32);
    expect(() => createContinuousSurface("sphere", 15)).toThrow(/16~128/);
    expect(() => createContinuousSurface("sphere", 129)).toThrow(/16~128/);
    expect(() => createContinuousSurface("sphere", 32.5)).toThrow(/16~128/);
  });
});

describe("analytic projected area and rotation invariance", () => {
  it("returns A/4 for a complete sphere in every direction", () => {
    const sphere = createContinuousSurface("sphere", 16);
    for (const direction of [[1, 0, 0], [0, 1, 0], [0.3, 0.7, -0.2]] as Vec3[]) {
      expect(projectedAreaForDirection(sphere, direction)).toBeCloseTo(0.0125, 14);
    }
  });

  it("uses the exact upward-hemisphere projection pi R^2 (1+s_y)/2", () => {
    const hemisphere = createContinuousSurface("hemisphere", 16);
    const footprint = hemisphere.dimensions.footprintM2;
    expect(projectedAreaForDirection(hemisphere, [0, 1, 0])).toBeCloseTo(footprint, 14);
    expect(projectedAreaForDirection(hemisphere, [1, 0, 0])).toBeCloseTo(footprint / 2, 14);
    expect(projectedAreaForDirection(hemisphere, [0, -1, 0])).toBeCloseTo(0, 14);
    expect(projectedAreaForDirection(hemisphere, [3, 4, 0])).toBeCloseTo(
      footprint * (1 + 4 / 5) / 2,
      14,
    );
  });

  it("uses the exact lateral-cylinder projection 2rh |s_horizontal|", () => {
    const cylinder = createContinuousSurface("cylinder", 16, { cylinderAspectRatio: 1.3 });
    const { radiusM, heightM } = cylinder.dimensions;
    expect(projectedAreaForDirection(cylinder, [1, 0, 0])).toBeCloseTo(2 * radiusM * heightM, 14);
    expect(projectedAreaForDirection(cylinder, [0, 1, 0])).toBe(0);
    const direction: Vec3 = [3, 4, 0];
    expect(projectedAreaForDirection(cylinder, direction)).toBeCloseTo(2 * radiusM * heightM * 3 / 5, 14);
  });

  it("uses the exact one-sided cone projection and a deterministic global maximum", () => {
    for (const coneAspectRatio of [0.25, 1, 2, 4, 10]) {
      const cone = createContinuousSurface("cone", 16, { coneAspectRatio });
      const dimensions = cone.dimensions;
      expect(coneProjectedAreaForDirection(dimensions, [1, 0, 0])).toBeCloseTo(
        dimensions.radiusM * dimensions.heightM,
        13,
      );
      expect(coneProjectedAreaForDirection(dimensions, [0, 1, 0])).toBeCloseTo(
        Math.PI * dimensions.radiusM ** 2,
        13,
      );
      expect(coneProjectedAreaForDirection(dimensions, [0, -1, 0])).toBe(0);

      let scanMaximum = 0;
      for (let index = 0; index <= 20_000; index += 1) {
        const elevation = Math.PI / 2 * index / 20_000;
        scanMaximum = Math.max(
          scanMaximum,
          coneProjectedAreaForDirection(dimensions, [Math.cos(elevation), Math.sin(elevation), 0]),
        );
      }
      const optimized = maximumConeProjectedArea(dimensions);
      expect(optimized).toBeGreaterThanOrEqual(scanMaximum - 1e-12);
      expect(optimized - scanMaximum).toBeLessThan(1e-8);
      expect(dimensions.maximumProjectedAreaM2).toBeCloseTo(optimized, 14);
    }
  });

  it.each(KINDS)("makes the analytic %s projection exactly invariant to Y rotation", (kind) => {
    const model = createContinuousSurface(kind, 32);
    const direction = unitSun(27, 43);
    const expected = projectedAreaForDirection(model, direction);
    for (const angleRad of [0, 0.137, 1.234, Math.PI, 5.73]) {
      const rotated: ContinuousSurfaceModel = {
        ...model,
        zones: model.zones.map((zone) => ({
          ...zone,
          samples: zone.samples.map((sample) => rotateSurfaceSampleAroundY(sample, angleRad)),
        })),
      };
      expect(projectedAreaForDirection(rotated, direction)).toBe(expected);
    }
  });

  it("rotates sample positions and normals with the same right-handed Y transform", () => {
    const sample = createContinuousSurface("cone", 16).zones[7].samples[9];
    const rotated = rotateSurfaceSampleAroundY(sample, Math.PI / 2);
    expect(rotated.position[0]).toBeCloseTo(sample.position[2], 14);
    expect(rotated.position[1]).toBe(sample.position[1]);
    expect(rotated.position[2]).toBeCloseTo(-sample.position[0], 14);
    expect(rotated.normal[0]).toBeCloseTo(sample.normal[2], 14);
    expect(rotated.normal[1]).toBe(sample.normal[1]);
    expect(rotated.normal[2]).toBeCloseTo(-sample.normal[0], 14);
    expect(rotated.areaM2).toBe(sample.areaM2);
  });

  it.each(KINDS)("keeps the finite %s lattice within 0.5% under arbitrary Y phase", (kind) => {
    const model = createContinuousSurface(kind, 64);
    const direction = unitSun(25, 37);
    const baseline = numericalProjectedArea(model, direction, 0);
    for (const angleRad of [0.137, 0.77, 1.234, 2.91, 5.73]) {
      const rotated = numericalProjectedArea(model, direction, angleRad);
      expect(Math.abs(rotated - baseline) / Math.max(rotated, baseline)).toBeLessThan(0.005);
    }
  });

  it.each(KINDS)("keeps integrated %s direct and total POA invariant under Y rotation", (kind) => {
    const baseline = integratedPoa(kind, 64, 31, 47, {
      rotationAngleRad: 0,
      albedo: 0,
      diffuseModel: "isotropic",
    });
    for (const rotationAngleRad of [0.137, 0.77, 1.234, Math.PI, 5.73]) {
      const rotated = integratedPoa(kind, 64, 31, 47, {
        rotationAngleRad,
        albedo: 0,
        diffuseModel: "isotropic",
      });
      expect(Math.abs(rotated.directW - baseline.directW) / baseline.directW)
        .toBeLessThan(0.001);
      expect(Math.abs(rotated.totalW - baseline.totalW) / baseline.totalW)
        .toBeLessThan(0.001);
    }
  });
});

describe("surface quadrature convergence", () => {
  it.each(KINDS)("changes integrated %s direct and total POA by less than 0.5% from Nphi=32 to 64", (kind) => {
    const directions = [
      [2, 45],
      [6, 39],
      [18, 0],
      [25, 37],
      [60, 45],
      [86, 33],
    ] as const;
    let maximumDirectChange = 0;
    let maximumTotalChange = 0;
    for (const [elevationDeg, azimuthDeg] of directions) {
      const coarse = integratedPoa(kind, 32, elevationDeg, azimuthDeg);
      const refined = integratedPoa(kind, 64, elevationDeg, azimuthDeg);
      maximumDirectChange = Math.max(
        maximumDirectChange,
        Math.abs(coarse.directW - refined.directW) / Math.max(coarse.directW, refined.directW, 1e-15),
      );
      maximumTotalChange = Math.max(
        maximumTotalChange,
        Math.abs(coarse.totalW - refined.totalW) / Math.max(coarse.totalW, refined.totalW, 1e-15),
      );
    }
    expect(maximumDirectChange).toBeLessThan(0.005);
    expect(maximumTotalChange).toBeLessThan(0.005);
  });

  it.each(KINDS)("keeps analytic and Nphi=64 projected area close for %s", (kind) => {
    const model = createContinuousSurface(kind, 64);
    const direction = unitSun(25, 37);
    const analytic = projectedAreaForDirection(model, direction);
    const numerical = numericalProjectedArea(model, direction);
    expect(Math.abs(numerical - analytic) / Math.max(analytic, 1e-15)).toBeLessThan(0.001);
  });

  it.each(KINDS)("changes clear-day integrated %s optical energy by less than 0.5% from Nphi=32 to 64", (kind) => {
    const energy = (azimuthSamples: number) => {
      let wattHours = 0;
      const values: number[] = [];
      for (let minute = 6 * 60; minute <= 18 * 60; minute += 10) {
        const phase = (minute - 6 * 60) / (12 * 60);
        const elevationDeg = Math.max(0.5, 68 * Math.sin(Math.PI * phase));
        const azimuthDeg = 90 + 180 * phase;
        values.push(integratedPoa(kind, azimuthSamples, elevationDeg, azimuthDeg).totalW);
      }
      for (let index = 1; index < values.length; index += 1) {
        wattHours += 0.5 * (values[index - 1] + values[index]) / 6;
      }
      return wattHours;
    };
    const coarse = energy(32);
    const refined = energy(64);
    expect(Math.abs(coarse - refined) / refined).toBeLessThan(0.005);
  });

  it("has no isolated zero or single-point spike on a continuous clear-sky sphere series", () => {
    const values = Array.from({ length: 73 }, (_, index) => {
      const phase = index / 72;
      return integratedPoa("sphere", 32, Math.max(0.5, 68 * Math.sin(Math.PI * phase)), 90 + 180 * phase).totalW;
    });
    expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    for (let index = 1; index < values.length - 1; index += 1) {
      expect(values[index] === 0 && values[index - 1] > 0 && values[index + 1] > 0).toBe(false);
      expect(values[index]).toBeLessThan(Math.max(values[index - 1], values[index + 1]) * 1.1 + 1e-9);
    }
  });

  it("maps q endpoints to the intended geometry while production GL nodes avoid them", () => {
    for (const kind of KINDS) {
      const dimensions = continuousSurfaceDimensions(kind);
      const first = pointOnContinuousSurface(kind, dimensions, 0, 0);
      const last = pointOnContinuousSurface(kind, dimensions, 1, 0);
      expect([...first.position, ...first.normal, ...last.position, ...last.normal].every(Number.isFinite)).toBe(true);
      expect(surfaceSamples(createContinuousSurface(kind, 16)).every((sample) => sample.u > 0 && sample.u < 1)).toBe(true);
    }
  });
});
