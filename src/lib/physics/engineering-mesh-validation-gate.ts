import {
  ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
  ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
} from "./engineering-surface-electrical";

export interface InvalidEngineeringMeshValidationGateInput {
  generatedAt: string;
  artifactSchemaVersion: number;
  artifactPath: string;
  shapes: readonly string[];
}

/**
 * Produces the schema-complete compact gate written before a mesh audit starts.
 * Consumers may therefore fail closed without special-casing a partially
 * populated gate when the audit process exits before publishing a pass result.
 */
export function invalidEngineeringMeshValidationGate(
  input: InvalidEngineeringMeshValidationGateInput,
) {
  const failedShapes = input.shapes.map((shape) => ({ shape, pass: false }));
  return {
    schemaVersion: 1,
    status: "running-or-failed",
    generatedAt: input.generatedAt,
    artifactSchemaVersion: input.artifactSchemaVersion,
    artifactPath: input.artifactPath,
    artifactSha256: "",
    configurationSha256: "",
    implementationSha256: "",
    officialMinimumResolution: { ...ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION },
    layoutVersion: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
    contracts: [
      {
        contractId: "static-land-matched",
        footprintMode: "static",
        phaseGateRequired: false,
        pass: false,
        shapes: failedShapes.map((entry) => ({ ...entry })),
      },
      {
        contractId: "swept-rotation-envelope",
        footprintMode: "swept",
        phaseGateRequired: true,
        pass: false,
        shapes: failedShapes.map((entry) => ({ ...entry })),
      },
    ],
    officialRankingEligible: false,
  } as const;
}
