import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

/** Read JSON with a path-bearing error instead of leaking an unhelpful SyntaxError. */
export function readJsonFile(path: string): unknown {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Required validation artifact is unreadable: ${path}`, { cause: error });
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Required validation artifact is not valid JSON: ${path}`, { cause: error });
  }
}

/**
 * Write beside the destination, flush the complete temporary file, then rename it.
 * A failed render therefore leaves the previous report intact and never exposes a
 * partially written JSON/Markdown artifact.
 */
export function atomicWriteUtf8(path: string, contents: string): void {
  const absolutePath = resolve(path);
  const parent = dirname(absolutePath);
  mkdirSync(parent, { recursive: true });
  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, absolutePath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}
