import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateEngineeringMeshAudit,
  validateEngineeringMeshGate,
} from "../scripts/engineering-validation-contract";

const meshPath = "docs/engineering-mesh-convergence-audit-2026.json";
const gatePath = "src/lib/physics/engineering-mesh-validation.generated.json";

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("fail-closed engineering validation contracts", () => {
  it("accepts only the final two-contract mesh artifact and exact pass gate", () => {
    const audit = validateEngineeringMeshAudit(json(meshPath));
    const gate = validateEngineeringMeshGate(json(gatePath), audit);
    expect(audit.schemaVersion).toBe(2);
    expect(audit.geometryContracts.map((contract) => contract.contractId)).toEqual([
      "static-land-matched", "swept-rotation-envelope",
    ]);
    expect(audit.geometryContracts.flatMap((contract) => contract.shapes)).toHaveLength(12);
    expect(gate.status).toBe("pass");
  });

  it("rejects a missing geometry contract", () => {
    const value = json(meshPath);
    (value.geometryContracts as unknown[]).pop();
    expect(() => validateEngineeringMeshAudit(value)).toThrow(/geometryContracts|both geometry contracts/);
  });

  it("rejects stationary phase evidence disguised as a numerical gate", () => {
    const value = json(meshPath);
    const contracts = value.geometryContracts as Array<Record<string, unknown>>;
    const shapes = contracts[0].shapes as Array<Record<string, unknown>>;
    const phase = shapes[0].phaseConvergence as Record<string, unknown>;
    phase.status = "evaluated";
    expect(() => validateEngineeringMeshAudit(value)).toThrow(/explicit N\/A/);
  });

  it("rejects topology drift even when reported pass flags remain true", () => {
    const value = json(meshPath);
    const contracts = value.geometryContracts as Array<Record<string, unknown>>;
    const shapes = contracts[1].shapes as Array<Record<string, unknown>>;
    const levels = shapes[0].levels as Array<Record<string, unknown>>;
    levels[1].layoutId = `${String(levels[1].layoutId)}-tampered`;
    expect(() => validateEngineeringMeshAudit(value)).toThrow(/topology|pass\/official/);
  });

  it("rejects a compact gate unless status and artifact SHA remain exact", () => {
    const audit = validateEngineeringMeshAudit(json(meshPath));
    const statusGate = clone(json(gatePath));
    statusGate.status = "running-or-failed";
    statusGate.officialRankingEligible = false;
    expect(() => validateEngineeringMeshGate(statusGate, audit)).toThrow(/status=pass/);

    const shaGate = clone(json(gatePath));
    shaGate.artifactSha256 = "0".repeat(64);
    expect(() => validateEngineeringMeshGate(shaGate, audit)).toThrow(/artifact SHA/);
  });
});
