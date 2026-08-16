import type { NextConfig } from "next";
import { resolveDeployTarget } from "./build/deploy-target";

const target = resolveDeployTarget();

const nextConfig: NextConfig = {
  // `standalone` makes `vinext build` additionally emit `dist/standalone/`: the
  // server entry, the built client and server output, and a `node_modules/`
  // holding only the packages the server bundle actually imports at runtime.
  //
  // This matters for a generic Node host. `vinext start` resolves the vinext
  // runtime out of the project's `node_modules`, where it lives as a
  // devDependency, so it survives only as long as nothing prunes dev packages
  // between build and boot. The standalone bundle carries its own copy and does
  // not depend on that. On the Cloudflare target the server entry is a Worker
  // module and a Node server entry beside it would be misleading, so it is only
  // emitted for the Node target.
  output: target === "node" ? "standalone" : undefined,
};

export default nextConfig;
