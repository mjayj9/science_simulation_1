import { describe, expect, it } from "vitest";
import transientEngineeringGateJson from "../src/lib/physics/transient-engineering-validation.generated.json";
import {
  ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
  ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
} from "../src/lib/physics/engineering-surface-electrical";
import { invalidEngineeringMeshValidationGate } from "../src/lib/physics/engineering-mesh-validation-gate";
import {
  ENGINEERING_RANK_SHAPES,
  engineeringOfficialRuntimeEligibility,
} from "../src/ui/engineering-official-ranking";

describe("engineering mesh running-or-failed gate", () => {
  it("is schema-complete and makes official UI eligibility fail closed without throwing", () => {
    const mesh = invalidEngineeringMeshValidationGate({
      generatedAt: "2026-08-15T00:00:00.000Z",
      artifactSchemaVersion: 2,
      artifactPath: "docs/engineering-mesh-convergence-audit-2026.json",
      shapes: ENGINEERING_RANK_SHAPES,
    });

    expect(mesh).toMatchObject({
      schemaVersion: 1,
      status: "running-or-failed",
      artifactSha256: "",
      configurationSha256: "",
      implementationSha256: "",
      officialMinimumResolution: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
      layoutVersion: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
      officialRankingEligible: false,
    });
    expect(mesh.contracts).toHaveLength(2);
    expect(mesh.contracts.map((contract) => ({
      contractId: contract.contractId,
      pass: contract.pass,
      shapeCount: contract.shapes.length,
      shapesPass: contract.shapes.every((shape) => shape.pass),
    }))).toEqual([
      { contractId: "static-land-matched", pass: false, shapeCount: 6, shapesPass: false },
      { contractId: "swept-rotation-envelope", pass: false, shapeCount: 6, shapesPass: false },
    ]);

    const gates = {
      mesh,
      transient: transientEngineeringGateJson,
    } as unknown as NonNullable<Parameters<typeof engineeringOfficialRuntimeEligibility>[0]["gates"]>;
    const result = engineeringOfficialRuntimeEligibility({
      rows: [],
      footprintMode: "static",
      rotationRequiresPhaseQuadrature: false,
      resolution: { ...ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION },
      coupledSettings: {
        thermalNodeCount: 6,
        maximumThermalSubstepSeconds: 900,
        maximumElectricalCouplingStepSeconds: 900,
      },
      runtimeGeometry: {
        landAreaM2: 0.05,
        maximumHeightM: 0.252313252202016,
        structureHeightM: 0.252313252202016,
        supportHeightM: 0,
        planeTiltDeg: 30,
      },
      runtimeFixture: transientEngineeringGateJson.certifiedFixture,
      connection: OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
      expectedSteps: 8761,
      expectedIntervals: 8760,
      expectedDurationHours: 8760,
      gates,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("mesh-gate-not-pass");
  });
});
