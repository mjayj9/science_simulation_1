import { describe, expect, it } from "vitest";
import { createComparisonSurface } from "../src/lib/geometry";
import {
  calculateAreaWeightedNodeConvection,
  createAnnualReducedThermalMesh,
} from "../src/lib/physics/annual-transient";
import { DEFAULT_AIR_PROPERTIES } from "../src/lib/physics/transient-thermal";

const zeroWind = { x: 0, y: 0, z: 0 } as const;

function nodeCentroidRadiusM(node: { bodyPositionM: { x: number; z: number } }): number {
  return Math.hypot(node.bodyPositionM.x, node.bodyPositionM.z);
}

describe("annual reduced thermal-node locality and sample-resolved convection", () => {
  it("partitions separate charts first and keeps each multi-node chart group spatially local", () => {
    const cylinder = createComparisonSurface("cylinder", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const first = createAnnualReducedThermalMesh(cylinder, 25, {
      targetNodeCount: 8,
      neighboursPerNode: 2,
    });
    const second = createAnnualReducedThermalMesh(cylinder, 25, {
      targetNodeCount: 8,
      neighboursPerNode: 2,
    });
    expect(second).toEqual(first);
    expect(first.thermalNodeCount).toBe(8);
    for (const node of first.nodes) {
      const samples = first.opticalSamplesByNodeId[node.id];
      const sourceCharts = new Set(samples.map((sample) =>
        Math.abs(sample.bodyNormal.y) > 0.5 ? "top" : "side"));
      expect(sourceCharts.size).toBe(1);

      // A full azimuthal ring has a zero circular resultant. Each allocated
      // local group must instead occupy a bounded angular sector.
      const resultant = Math.hypot(
        samples.reduce((sum, sample) => sum
          + sample.areaM2 * Math.sin(Math.atan2(sample.bodyPositionM.x, sample.bodyPositionM.z)), 0),
        samples.reduce((sum, sample) => sum
          + sample.areaM2 * Math.cos(Math.atan2(sample.bodyPositionM.x, sample.bodyPositionM.z)), 0),
      ) / samples.reduce((sum, sample) => sum + sample.areaM2, 0);
      expect(resultant).toBeGreaterThan(0.5);
    }

    const cube = createComparisonSurface("cube", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const cubeMesh = createAnnualReducedThermalMesh(cube, 25, { targetNodeCount: 2 });
    expect(cubeMesh.requestedThermalNodeCount).toBe(2);
    expect(cubeMesh.thermalNodeCount).toBe(cube.zones.length);
    for (const node of cubeMesh.nodes) {
      const normals = new Set(cubeMesh.opticalSamplesByNodeId[node.id].map((sample) =>
        `${sample.bodyNormal.x},${sample.bodyNormal.y},${sample.bodyNormal.z}`));
      expect(normals.size).toBe(1);
    }
  });

  it.each(["plane", "cube"] as const)(
    "%s uses a physical positive characteristic length instead of its radiusM=0 sentinel",
    (shape) => {
      const surface = createComparisonSurface(shape, {
        landAreaM2: 0.05,
        planeTiltDeg: 0,
        planeAzimuthDeg: 180,
        azimuthSamples: 16,
        meridionalSegments: 4,
      });
      expect(surface.dimensions.radiusM).toBe(0);
      expect(surface.dimensions.widthM).toBeGreaterThan(1e-4);
      const mesh = createAnnualReducedThermalMesh(surface, 25, { targetNodeCount: 1 });
      for (const node of mesh.nodes) {
        const expectedLengthM = surface.dimensions.widthM!;
        expect(node.characteristicLengthM).toBeCloseTo(expectedLengthM, 12);
        expect(node.characteristicLengthM).toBeGreaterThan(1e-3);

        const rotating = calculateAreaWeightedNodeConvection(
          node,
          mesh.opticalSamplesByNodeId[node.id],
          0,
          2 * Math.PI,
          zeroWind,
          0,
          DEFAULT_AIR_PROPERTIES,
        );
        expect(Number.isFinite(rotating.coefficientWm2K)).toBe(true);
        expect(rotating.coefficientWm2K).toBeGreaterThan(0);
        // At this sub-metre fixture and 1 rev/s, a three-digit h would expose
        // the old 0.1 mm numerical length rather than a shape length.
        expect(rotating.coefficientWm2K).toBeLessThan(50);
      }
    },
  );

  it.each(["plane", "cylinder"] as const)(
    "%s rotation increases sample-resolved relative wind and h even when its node centroid is on-axis",
    (shape) => {
      const surface = createComparisonSurface(shape, {
        landAreaM2: 0.05,
        planeTiltDeg: 0,
        planeAzimuthDeg: 180,
        azimuthSamples: 16,
        meridionalSegments: 4,
      });
      // One requested node deliberately recreates the centroid-cancellation
      // condition. A cylinder still receives one node per source chart.
      const mesh = createAnnualReducedThermalMesh(surface, 25, { targetNodeCount: 1 });
      expect(mesh.nodes.every((node) => nodeCentroidRadiusM(node) < 1e-12)).toBe(true);

      for (const node of mesh.nodes) {
        const samples = mesh.opticalSamplesByNodeId[node.id];
        const stationary = calculateAreaWeightedNodeConvection(
          node,
          samples,
          0,
          0,
          zeroWind,
          0,
          DEFAULT_AIR_PROPERTIES,
        );
        const rotating = calculateAreaWeightedNodeConvection(
          node,
          samples,
          0,
          2 * Math.PI,
          zeroWind,
          0,
          DEFAULT_AIR_PROPERTIES,
        );
        expect(stationary.relativeWindSpeedMS).toBe(0);
        expect(rotating.relativeWindSpeedMS).toBeGreaterThan(0);
        expect(rotating.coefficientWm2K).toBeGreaterThan(stationary.coefficientWm2K);
        expect(rotating.areaM2).toBeCloseTo(node.areaM2, 12);
        expect(rotating.sampleCount).toBe(samples.length);
      }
    },
  );
});
