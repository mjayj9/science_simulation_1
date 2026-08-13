import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VALIDATION_AUDIT_PATHS,
  VALIDATION_SOURCE_PATHS,
  assertValidationAuditManifest,
  createValidationAuditManifest,
} from "../scripts/validation-provenance";

function populatedFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "solarform-validation-"));
  VALIDATION_SOURCE_PATHS.forEach((relativePath, index) => {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `fixture-${index}\n`, "utf8");
  });
  VALIDATION_AUDIT_PATHS.forEach((relativePath, index) => {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify({ fixture: index })}\n`, "utf8");
  });
  return root;
}

describe("validation audit provenance", () => {
  it("binds every generated audit to the exact source and fixture bytes", () => {
    const root = populatedFixtureRoot();
    const manifest = createValidationAuditManifest(root);
    assertValidationAuditManifest(manifest, root);
    const firstPath = VALIDATION_SOURCE_PATHS[0];
    expect(manifest.sourceFiles[firstPath]).toBe(
      createHash("sha256").update("fixture-0\n").digest("hex"),
    );
  });

  it("rejects changed code, changed audit output, and missing artifacts", () => {
    const root = populatedFixtureRoot();
    const manifest = createValidationAuditManifest(root);
    writeFileSync(join(root, VALIDATION_SOURCE_PATHS[0]), "changed\n", "utf8");
    expect(() => assertValidationAuditManifest(manifest, root)).toThrow(/stale/);

    const secondRoot = populatedFixtureRoot();
    const secondManifest = createValidationAuditManifest(secondRoot);
    writeFileSync(join(secondRoot, VALIDATION_AUDIT_PATHS[0]), `${JSON.stringify({ changed: true })}\n`, "utf8");
    expect(() => assertValidationAuditManifest(secondManifest, secondRoot)).toThrow(/stale/);

    const emptyRoot = mkdtempSync(join(tmpdir(), "solarform-validation-missing-"));
    expect(() => createValidationAuditManifest(emptyRoot)).toThrow(/missing/);
  });
});
