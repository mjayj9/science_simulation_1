#!/usr/bin/env node
/**
 * Run `vinext build` against an explicit deployment target.
 *
 * `DEPLOY_TARGET=cloudflare vinext build` would be enough on a POSIX shell, but
 * npm runs scripts through cmd.exe on Windows, where that prefix form is not
 * valid. Spawning the build from Node sets the variable the same way on every
 * platform.
 *
 * The target is validated here rather than left to the Vite config so an
 * unknown value fails before the build starts.
 */
import { spawn } from "node:child_process";
import { DEPLOY_TARGETS } from "../build/deploy-target.ts";

const [target] = process.argv.slice(2);

if (!DEPLOY_TARGETS.includes(target)) {
  console.error(
    `Usage: node scripts/build-target.mjs <${DEPLOY_TARGETS.join("|")}>`,
  );
  process.exit(1);
}

const child = spawn("vinext", ["build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DEPLOY_TARGET: target },
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
