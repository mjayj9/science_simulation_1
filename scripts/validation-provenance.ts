import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { readJsonFile } from "./validation-io";

// This is deliberately broader than the six audit entrypoints. The numerical
// reports can be changed by transitive geometry, irradiance, circuit, weather,
// worker, or dependency-version changes, so those bytes are part of provenance.
export const VALIDATION_SOURCE_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  "src/lib/geometry/comparison-surfaces.ts",
  "src/lib/geometry/continuous-surfaces.ts",
  "src/lib/geometry/editor.ts",
  "src/lib/geometry/environment.ts",
  "src/lib/geometry/index.ts",
  "src/lib/geometry/math.ts",
  "src/lib/geometry/presets.ts",
  "src/lib/geometry/types.ts",
  "src/lib/geometry/visibility.ts",
  "src/lib/physics/annual-transient.ts",
  "src/lib/physics/circuit.ts",
  "src/lib/physics/continuous-surface.ts",
  "src/lib/physics/electrical.ts",
  "src/lib/physics/engineering-surface-electrical.ts",
  "src/lib/physics/environment.ts",
  "src/lib/physics/index.ts",
  "src/lib/physics/integration.ts",
  "src/lib/physics/inverter.ts",
  "src/lib/physics/irradiance.ts",
  "src/lib/physics/natural-rotation.ts",
  "src/lib/physics/pipeline.ts",
  "src/lib/physics/quaternion.ts",
  "src/lib/physics/registry.ts",
  "src/lib/physics/rotation.ts",
  "src/lib/physics/solar.ts",
  "src/lib/physics/thermal.ts",
  "src/lib/physics/transient-thermal.ts",
  "src/lib/physics/types.ts",
  "src/lib/physics/vector.ts",
  "src/lib/physics/weather.ts",
  "src/lib/research/benchmarks.ts",
  "src/lib/research/index.ts",
  "src/lib/research/presets.ts",
  "src/lib/weather/index.ts",
  "src/lib/weather/offline.ts",
  "src/lib/weather/types.ts",
  "src/workers/index.ts",
  "src/workers/kernel.ts",
  "src/workers/protocol.ts",
  "src/workers/simulation.worker.ts",
  "src/workers/worker-runtime.ts",
  "scripts/audit-annual-transient.ts",
  "scripts/audit-fair-geometry.ts",
  "scripts/audit-full-year-comparison-v2.ts",
  "scripts/audit-natural-rotation.ts",
  "scripts/audit-research-benchmarks.ts",
  "scripts/audit-thermal-model-comparison.ts",
  "scripts/generate-validation-report-v2.ts",
  "scripts/run-vite-audit.ts",
  "scripts/validation-io.ts",
  "scripts/validation-provenance.ts",
  "scripts/validation-report-contract.ts",
  "scripts/write-validation-manifest.ts",
] as const);

export const VALIDATION_AUDIT_PATHS = Object.freeze([
  "docs/annual-transient-audit-2026.json",
  "docs/fair-geometry-audit-2026.json",
  "docs/full-year-comparison-audit-2026.json",
  "docs/natural-rotation-audit-2026.json",
  "docs/research-source-equivalent-audit.json",
  "docs/thermal-model-comparison-audit-2026.json",
] as const);

export interface ValidationAuditManifest {
  schemaVersion: 2;
  generatedAt: string;
  algorithm: "sha256";
  sourceSetSha256: string;
  auditSetSha256: string;
  sourceFiles: Record<string, string>;
  auditFiles: Record<string, string>;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertInsideRoot(rootDir: string, absolutePath: string, relativePath: string): void {
  const root = realpathSync(rootDir);
  const target = realpathSync(absolutePath);
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith("..") || /^[A-Za-z]:/.test(fromRoot)) {
    throw new Error(`Required validation artifact escapes the workspace: ${relativePath}`);
  }
}

function hashesFor(rootDir: string, paths: readonly string[], parseJson: boolean): Record<string, string> {
  return Object.fromEntries(paths.map((relativePath) => {
    const absolutePath = resolve(rootDir, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Required validation artifact is missing: ${relativePath}`);
    }
    assertInsideRoot(rootDir, absolutePath, relativePath);
    if (!statSync(absolutePath).isFile()) {
      throw new Error(`Required validation artifact is not a regular file: ${relativePath}`);
    }
    if (parseJson) readJsonFile(absolutePath);
    return [relativePath, sha256File(absolutePath)];
  }));
}

function assertAuditArtifactsAreFresh(rootDir: string): void {
  const auditAffectingSources = VALIDATION_SOURCE_PATHS.filter((path) =>
    path === "package-lock.json"
    || path.startsWith("src/")
    || path.startsWith("scripts/audit-"),
  );
  const latestSourceMtimeMs = Math.max(...auditAffectingSources.map((path) =>
    statSync(resolve(rootDir, path)).mtimeMs,
  ));
  for (const relativePath of VALIDATION_AUDIT_PATHS) {
    const absolutePath = resolve(rootDir, relativePath);
    if (!existsSync(absolutePath)) continue;
    // The one-millisecond allowance only avoids filesystem timestamp rounding;
    // it cannot mask an audit produced before a later source edit.
    if (statSync(absolutePath).mtimeMs + 1 < latestSourceMtimeMs) {
      throw new Error(`Required validation artifact is stale relative to source bytes: ${relativePath}`);
    }
  }
}

export function digestHashRecord(hashes: Readonly<Record<string, string>>): string {
  const canonical = Object.entries(hashes)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([path, hash]) => `${path}\0${hash}\n`)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}

export function createValidationAuditManifest(rootDir = process.cwd()): ValidationAuditManifest {
  assertAuditArtifactsAreFresh(rootDir);
  const sourceFiles = hashesFor(rootDir, VALIDATION_SOURCE_PATHS, false);
  const auditFiles = hashesFor(rootDir, VALIDATION_AUDIT_PATHS, true);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    algorithm: "sha256",
    sourceSetSha256: digestHashRecord(sourceFiles),
    auditSetSha256: digestHashRecord(auditFiles),
    sourceFiles,
    auditFiles,
  };
}

function assertExactHashRecord(
  value: unknown,
  expected: Record<string, string>,
  label: string,
): asserts value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Validation manifest ${label} must be an object.`);
  }
  const actual = value as Record<string, unknown>;
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`Validation manifest ${label} has missing or unexpected paths.`);
  }
  for (const [relativePath, expectedHash] of Object.entries(expected)) {
    const recordedHash = actual[relativePath];
    if (typeof recordedHash !== "string" || !/^[a-f0-9]{64}$/.test(recordedHash)) {
      throw new Error(`Validation manifest has an invalid SHA-256 digest: ${relativePath}`);
    }
    if (recordedHash !== expectedHash) {
      throw new Error(`Validation artifact is stale: ${relativePath}`);
    }
  }
}

export function assertValidationAuditManifest(
  manifest: ValidationAuditManifest,
  rootDir = process.cwd(),
): void {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Validation manifest must be an object.");
  }
  const expectedTopLevel = [
    "algorithm", "auditFiles", "auditSetSha256", "generatedAt", "schemaVersion", "sourceFiles", "sourceSetSha256",
  ];
  const actualTopLevel = Object.keys(manifest).sort();
  if (actualTopLevel.length !== expectedTopLevel.length
    || actualTopLevel.some((key, index) => key !== expectedTopLevel[index])) {
    throw new Error("Validation manifest has missing or unexpected top-level fields.");
  }
  if (manifest.schemaVersion !== 2 || manifest.algorithm !== "sha256") {
    throw new Error("Unsupported validation manifest schema or digest algorithm.");
  }
  const generatedAt = Date.parse(manifest.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 300_000) {
    throw new Error("Validation manifest generatedAt is invalid or in the future.");
  }
  const expectedSources = hashesFor(rootDir, VALIDATION_SOURCE_PATHS, false);
  const expectedAudits = hashesFor(rootDir, VALIDATION_AUDIT_PATHS, true);
  assertExactHashRecord(manifest.sourceFiles, expectedSources, "sourceFiles");
  assertExactHashRecord(manifest.auditFiles, expectedAudits, "auditFiles");
  if (manifest.sourceSetSha256 !== digestHashRecord(expectedSources)
    || manifest.auditSetSha256 !== digestHashRecord(expectedAudits)) {
    throw new Error("Validation manifest aggregate digest is stale or invalid.");
  }
}
