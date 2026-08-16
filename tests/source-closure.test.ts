import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeSourceClosure } from "../scripts/source-closure";

const temporaryRoots: string[] = [];

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "closure-"));
  temporaryRoots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("source closure derivation", () => {
  it("follows relative imports transitively so indirect physics cannot escape a fingerprint", () => {
    const root = workspace({
      "entry.ts": `import { a } from "./a";\nexport const e = a;\n`,
      "a.ts": `import { b } from "./nested/b";\nexport const a = b;\n`,
      "nested/b.ts": `import { c } from "../c";\nexport const b = c;\n`,
      "c.ts": `export const c = 1;\n`,
    });
    expect(computeSourceClosure({ entryPoints: ["entry.ts"], rootDir: root, label: "t" }))
      .toEqual(["a.ts", "c.ts", "entry.ts", "nested/b.ts"]);
  });

  it("resolves barrel re-exports, type-only imports and dynamic imports", () => {
    const root = workspace({
      "entry.ts": `export * from "./barrel";\nimport type { T } from "./types";\n`
        + `export const load = () => import("./lazy");\nexport type U = T;\n`,
      "barrel/index.ts": `export { x } from "./x";\n`,
      "barrel/x.ts": `export const x = 1;\n`,
      "types.ts": `export interface T { v: number }\n`,
      "lazy.ts": `export const lazy = 2;\n`,
    });
    expect(computeSourceClosure({ entryPoints: ["entry.ts"], rootDir: root, label: "t" }))
      .toEqual(["barrel/index.ts", "barrel/x.ts", "entry.ts", "lazy.ts", "types.ts"]);
  });

  it("throws instead of silently dropping an unresolvable import", () => {
    const root = workspace({ "entry.ts": `import { gone } from "./gone";\nexport const e = gone;\n` });
    expect(() => computeSourceClosure({ entryPoints: ["entry.ts"], rootDir: root, label: "t" }))
      .toThrow(/cannot resolve relative import "\.\/gone"/);
  });

  it("terminates on import cycles and reports each file once", () => {
    const root = workspace({
      "entry.ts": `import { b } from "./b";\nexport const a = b;\n`,
      "b.ts": `import { a } from "./entry";\nexport const b = a;\n`,
    });
    expect(computeSourceClosure({ entryPoints: ["entry.ts"], rootDir: root, label: "t" }))
      .toEqual(["b.ts", "entry.ts"]);
  });

  it("omits explicitly excluded self-written artifacts", () => {
    const root = workspace({
      "entry.ts": `import gate from "./gate.generated.json";\nexport const e = gate;\n`,
      "gate.generated.json": `{"status":"running-or-failed"}\n`,
    });
    expect(computeSourceClosure({
      entryPoints: ["entry.ts"], rootDir: root, label: "t",
      excluded: ["gate.generated.json"],
    })).toEqual(["entry.ts"]);
  });

  it("rejects a missing entry point rather than fingerprinting an empty set", () => {
    const root = workspace({ "entry.ts": `export const e = 1;\n` });
    expect(() => computeSourceClosure({ entryPoints: ["absent.ts"], rootDir: root, label: "t" }))
      .toThrow(/entry point does not exist/);
  });

  it("is order-independent and deterministic across repeated derivations", () => {
    const root = workspace({
      "entry.ts": `import "./a";\nimport "./b";\n`,
      "a.ts": `export const a = 1;\n`,
      "b.ts": `export const b = 2;\n`,
    });
    const first = computeSourceClosure({ entryPoints: ["entry.ts"], rootDir: root, label: "t" });
    const second = computeSourceClosure({
      entryPoints: ["entry.ts", "b.ts", "a.ts"], rootDir: root, label: "t",
    });
    expect(first).toEqual(second);
  });
});

describe("production audit fingerprints cover their real dependencies", () => {
  const rootDir = process.cwd();

  it("covers the indirect physics modules a hand-written list had omitted", () => {
    const closure = computeSourceClosure({
      entryPoints: [
        "src/lib/geometry/index.ts",
        "src/lib/physics/index.ts",
        "src/lib/weather/index.ts",
        "src/workers/kernel.ts",
        "src/workers/protocol.ts",
      ],
      rootDir,
      excluded: ["src/lib/physics/transient-engineering-validation.generated.json"],
      label: "computation",
    });
    // Each of these can change an annual number and none appeared in the
    // superseded literal COMPUTATION_SOURCE_FILES list.
    for (const required of [
      "src/lib/physics/solar.ts",
      "src/lib/physics/irradiance.ts",
      "src/lib/physics/vector.ts",
      "src/lib/physics/continuous-surface.ts",
      "src/lib/physics/rotation.ts",
      "src/lib/physics/pipeline.ts",
      "src/lib/physics/natural-rotation.ts",
    ]) {
      expect(closure).toContain(required);
    }
  });

  it("never fingerprints the gate the transient audit writes about itself", () => {
    const closure = computeSourceClosure({
      entryPoints: ["scripts/audit-transient-engineering-full-year.ts"],
      rootDir,
      excluded: ["src/lib/physics/transient-engineering-validation.generated.json"],
      label: "implementation",
    });
    expect(closure).not.toContain("src/lib/physics/transient-engineering-validation.generated.json");
  });

  it("covers the optical and inverter modules the mesh convergence table runs through", () => {
    const closure = computeSourceClosure({
      entryPoints: ["scripts/audit-engineering-mesh-convergence.ts"],
      rootDir,
      label: "engineeringMesh.implementation",
    });
    for (const required of [
      "src/lib/physics/irradiance.ts",
      "src/lib/physics/inverter.ts",
      "src/lib/physics/electrical.ts",
      "src/lib/physics/engineering-surface-electrical.ts",
      "src/lib/physics/circuit.ts",
    ]) {
      expect(closure).toContain(required);
    }
  });
});
