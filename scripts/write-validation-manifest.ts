import { resolve } from "node:path";
import { atomicWriteUtf8, readJsonFile } from "./validation-io";
import {
  assertValidationAuditManifest,
  createValidationAuditManifest,
  type ValidationAuditManifest,
} from "./validation-provenance";

const outputPath = resolve(process.argv[3] ?? "docs/validation-audit-manifest-2026.json");
const manifest = createValidationAuditManifest();
atomicWriteUtf8(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
const persisted = readJsonFile(outputPath) as ValidationAuditManifest;
assertValidationAuditManifest(persisted);
console.log(JSON.stringify({ outputPath, sourceCount: Object.keys(manifest.sourceFiles).length, auditCount: Object.keys(manifest.auditFiles).length }));
