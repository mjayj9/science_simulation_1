/**
 * Which runtime the production build targets.
 *
 * The two targets emit incompatible server entries, so the choice has to be
 * made once and read by every piece of the build:
 *
 *   node       `dist/server/index.js` exports a plain `(Request) => Response`
 *              handler that `vinext start` — or the self-contained bundle at
 *              `dist/standalone/` — serves over `node:http`. This is what a
 *              generic Node host such as Render runs.
 *
 *   cloudflare `@cloudflare/vite-plugin` wraps that handler in `worker/index.ts`
 *              and `dist/server/index.js` becomes a Worker module whose default
 *              export is `{ fetch(request, env, ctx) }`, expecting an `ASSETS`
 *              fetcher and an `IMAGES` binding that only workerd provides.
 *
 * Node is the default because it is the portable one: it needs nothing from the
 * host beyond a Node runtime and a `PORT`. Cloudflare stays reachable through
 * `DEPLOY_TARGET=cloudflare` so the Workers deployment path is not lost.
 *
 * An unrecognised value throws rather than falling back. A silent fallback here
 * would produce a build that looks finished and fails only once it is serving
 * traffic on the wrong runtime.
 */
export const DEPLOY_TARGETS = ["node", "cloudflare"] as const;

export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export const DEFAULT_DEPLOY_TARGET: DeployTarget = "node";

export function resolveDeployTarget(
  value: string | undefined = process.env.DEPLOY_TARGET,
): DeployTarget {
  if (value === undefined || value === "") {
    return DEFAULT_DEPLOY_TARGET;
  }
  if (!(DEPLOY_TARGETS as readonly string[]).includes(value)) {
    throw new Error(
      `Unknown DEPLOY_TARGET ${JSON.stringify(value)}. `
        + `Expected one of: ${DEPLOY_TARGETS.join(", ")}.`,
    );
  }
  return value as DeployTarget;
}
