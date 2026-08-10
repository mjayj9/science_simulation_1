import { defineConfig } from "vitest/config";

/**
 * Unit tests deliberately use an isolated Vite graph. Importing the deployment
 * vite.config.ts would activate the Cloudflare Worker/RSC environments, whose
 * externalization rules are incompatible with Vitest's Node runner.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".next/**", ".vinext/**"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
