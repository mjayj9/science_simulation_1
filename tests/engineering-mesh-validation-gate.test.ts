import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_ARTIFACT_PATH = "docs/engineering-mesh-convergence-audit-2026.json";
const GATE_PATH = "src/lib/physics/engineering-mesh-validation.generated.json";
const SHAPES = ["plane", "cube", "sphere", "hemisphere", "cylinder", "cone"];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Not JSON serializable.");
  return serialized;
}

interface ShapeGate {
  shape: string;
  pass: boolean;
}

interface ContractGate {
  contractId: string;
  footprintMode: string;
  phaseGateRequired: boolean;
  pass: boolean;
  shapes: ShapeGate[];
}

interface CompactGate {
  schemaVersion: number;
  status: string;
  generatedAt: string;
  artifactSchemaVersion: number;
  artifactPath: string;
  artifactSha256: string;
  configurationSha256: string;
  implementationSha256: string;
  officialMinimumResolution: Record<string, number>;
  layoutVersion: string;
  contracts: ContractGate[];
  officialRankingEligible: boolean;
}

interface ShapeReport {
  shape: string;
  pass: boolean;
  opticalMeshPass: boolean;
  circuitConvergence: { pass: boolean };
  phaseConvergence: { required: boolean; status: string; pass: boolean };
}

interface ContractReport {
  contractId: string;
  pass: boolean;
  officialEligible: boolean;
  shapes: ShapeReport[];
}

describe("generated engineering mesh validation gate", () => {
  it("recomputes exact artifact/configuration/implementation SHA-256 and closes both contracts", () => {
    const gate = JSON.parse(readFileSync(resolve(GATE_PATH), "utf8")) as CompactGate;
    expect(gate.schemaVersion).toBe(1);
    expect(gate.status).toBe("pass");
    expect(gate.officialRankingEligible).toBe(true);
    expect(gate.artifactPath).toBe(EXPECTED_ARTIFACT_PATH);

    const artifactBytes = readFileSync(resolve(gate.artifactPath), "utf8");
    const artifact = JSON.parse(artifactBytes) as {
      schemaVersion: number;
      fixture: {
        configuration: unknown;
        configurationSha256: string;
        implementationSha256: string;
        implementationSourceFiles: string[];
      };
      implementation: { sha256: string };
      topology: { layoutVersion: string };
      convergence: { officialMinimumResolution: Record<string, number> };
      geometryContracts: ContractReport[];
      officialRankingEligible: boolean;
    };
    expect(sha256(artifactBytes)).toBe(gate.artifactSha256);
    expect(artifact.schemaVersion).toBe(gate.artifactSchemaVersion);
    expect(sha256(canonicalJson(artifact.fixture.configuration)))
      .toBe(gate.configurationSha256);
    expect(artifact.fixture.configurationSha256).toBe(gate.configurationSha256);
    const implementationBytes = artifact.fixture.implementationSourceFiles.map((path) =>
      `${path}\n${readFileSync(resolve(path), "utf8")}`).join("\n---\n");
    expect(sha256(implementationBytes)).toBe(gate.implementationSha256);
    expect(artifact.fixture.implementationSha256).toBe(gate.implementationSha256);
    expect(artifact.implementation.sha256).toBe(gate.implementationSha256);
    expect(artifact.topology.layoutVersion).toBe(gate.layoutVersion);
    expect(artifact.convergence.officialMinimumResolution)
      .toEqual(gate.officialMinimumResolution);
    expect(artifact.officialRankingEligible).toBe(true);

    expect(artifact.geometryContracts.map((contract) => contract.contractId)).toEqual([
      "static-land-matched", "swept-rotation-envelope",
    ]);
    artifact.geometryContracts.forEach((contract) => {
      const compact = gate.contracts.find((entry) => entry.contractId === contract.contractId);
      expect(compact?.pass).toBe(true);
      expect(compact?.footprintMode).toBe(contract.contractId === "static-land-matched" ? "static" : "swept");
      expect(compact?.phaseGateRequired).toBe(contract.contractId === "swept-rotation-envelope");
      expect(contract.pass).toBe(true);
      expect(contract.officialEligible).toBe(true);
      expect(contract.shapes.map((shape) => shape.shape)).toEqual(SHAPES);
      expect(compact?.shapes).toEqual(contract.shapes.map((shape) => ({
        shape: shape.shape,
        pass: shape.pass,
      })));
      contract.shapes.forEach((shape) => {
        expect(shape.pass).toBe(true);
        expect(shape.opticalMeshPass).toBe(true);
        expect(shape.circuitConvergence.pass).toBe(true);
        if (contract.contractId === "static-land-matched") {
          expect(shape.phaseConvergence).toMatchObject({
            required: false,
            status: "not-applicable-stationary-rpm0",
            pass: true,
          });
        } else {
          expect(shape.phaseConvergence).toMatchObject({
            required: true,
            status: "evaluated",
            pass: true,
          });
        }
      });
    });
    expect(gate.contracts).toHaveLength(2);
    expect(Date.parse(gate.generatedAt)).toBeGreaterThan(0);
    expect(statSync(resolve(EXPECTED_ARTIFACT_PATH)).mtimeMs + 1)
      .toBeGreaterThanOrEqual(statSync(resolve(GATE_PATH)).mtimeMs);
  });
});
