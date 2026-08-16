import { createServer } from "vite";

const modulePath = process.argv[2];
if (!modulePath?.startsWith("/")) {
  throw new TypeError("Usage: run-vite-audit.ts /scripts/<audit-module>.ts [module arguments]");
}

// Keep the audit entrypoints ordinary TypeScript modules while using exactly
// the same bundler resolution rules as production. This avoids Node ESM's
// extensionless-TypeScript ambiguity without installing a second TS runner.
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
});

try {
  // Audit modules read any additional arguments directly from process.argv.
  await vite.ssrLoadModule(modulePath);
} finally {
  await vite.close();
}
