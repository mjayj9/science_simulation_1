import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Derives the transitive relative-import closure of a set of entry points.
 *
 * Provenance fingerprints must cover every source byte that can change a
 * computed number. A hand-maintained file list cannot express that invariant:
 * it silently under-covers as soon as a module gains a new dependency, and the
 * resulting fingerprint then certifies results against sources it never read.
 * Deriving the closure makes under-coverage unrepresentable.
 *
 * The walk is deliberately strict. An unresolvable relative specifier throws
 * instead of being skipped, because a renamed or deleted module is exactly the
 * event that would otherwise drop bytes out of a fingerprint unnoticed.
 */

const SOURCE_EXTENSIONS = Object.freeze([".ts", ".tsx", ".mts", ".cts", ".json"] as const);

/** `from "x"`, `import "x"`, `export … from "x"`, and dynamic `import("x")`. */
const SPECIFIER_PATTERNS = Object.freeze([
  /(?:^|[\s;}])(?:import|export)\s+[^;'"]*?from\s*["']([^"']+)["']/g,
  /(?:^|[\s;}])import\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
]);

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** Applies Node/TypeScript relative-specifier resolution to one import. */
function resolveRelativeSpecifier(specifier: string, fromFile: string): string | undefined {
  const base = join(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  // `./x.js` is the ESM spelling of `./x.ts` under a bundler/TS resolver.
  const rewritten = base.replace(/\.(js|mjs|cjs|jsx)$/, "");
  if (rewritten !== base) {
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${rewritten}${extension}`));
  }
  return candidates.find((candidate) => isFile(candidate));
}

function assertInsideRoot(rootDir: string, absolutePath: string, label: string): string {
  const fromRoot = relative(realpathSync(rootDir), realpathSync(absolutePath));
  if (fromRoot === "" || fromRoot.startsWith("..") || /^[A-Za-z]:/.test(fromRoot)) {
    throw new Error(`${label} source escapes the workspace: ${toPosix(absolutePath)}`);
  }
  return toPosix(fromRoot);
}

export interface SourceClosureOptions {
  /** Workspace-relative entry points. Every one must exist. */
  entryPoints: readonly string[];
  rootDir: string;
  /**
   * Workspace-relative paths excluded from the closure. Reserved for artifacts
   * the fingerprinting process itself writes, which would otherwise make the
   * fingerprint depend on its own previous output.
   */
  excluded?: readonly string[];
  label: string;
}

/**
 * Returns sorted, deduplicated, workspace-relative POSIX paths covering every
 * entry point and every module reachable from one by relative import.
 */
export function computeSourceClosure(options: SourceClosureOptions): readonly string[] {
  const { entryPoints, rootDir, label } = options;
  if (entryPoints.length === 0) {
    throw new Error(`${label} requires at least one entry point.`);
  }
  const excluded = new Set((options.excluded ?? []).map(toPosix));
  const root = resolve(rootDir);
  const visited = new Set<string>();
  const closure = new Set<string>();
  const queue: string[] = [];

  for (const entryPoint of entryPoints) {
    const absolute = resolve(root, entryPoint);
    if (!isFile(absolute)) {
      throw new Error(`${label} entry point does not exist: ${toPosix(entryPoint)}`);
    }
    queue.push(absolute);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const relativePath = assertInsideRoot(root, current, label);
    if (excluded.has(relativePath)) continue;
    closure.add(relativePath);
    // JSON is a fingerprintable leaf; it cannot import anything further.
    if (relativePath.endsWith(".json")) continue;

    const contents = readFileSync(current, "utf8");
    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of contents.matchAll(pattern)) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        const resolved = resolveRelativeSpecifier(specifier, current);
        if (resolved === undefined) {
          throw new Error(
            `${label} cannot resolve relative import "${specifier}" from ${relativePath}.`,
          );
        }
        if (!visited.has(resolved)) queue.push(resolved);
      }
    }
  }

  return Object.freeze([...closure].sort());
}
