import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { resolveDeployTarget } from "../build/deploy-target.ts";

const target = resolveDeployTarget();

/**
 * Invoke the built server entry the way its target runtime would.
 *
 * The two targets emit incompatible entries: the Node build's default export is
 * a bare `(request) => Response` handler, while the Cloudflare build's is a
 * Worker module wrapping it as `{ fetch(request, env, ctx) }` and reading an
 * `ASSETS` fetcher off `env`. Which one is on disk is decided by DEPLOY_TARGET
 * at build time.
 *
 * The shape is asserted against the configured target rather than sniffed and
 * accommodated. Accepting whichever entry happens to be there would let a build
 * made for the wrong runtime pass this smoke test and fail on the host instead.
 */
async function render(pathname = "/") {
  const entryUrl = new URL("../dist/server/index.js", import.meta.url);
  entryUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: entry } = await import(entryUrl.href);
  const request = new Request(new URL(pathname, "http://localhost"), {
    headers: { accept: "text/html" },
  });

  let response;
  if (target === "cloudflare") {
    assert.equal(
      typeof entry?.fetch,
      "function",
      "cloudflare build must default-export a Worker module exposing fetch()",
    );
    response = await entry.fetch(
      request,
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );
  } else {
    assert.equal(
      typeof entry,
      "function",
      "node build must default-export a (request) => Response handler",
    );
    response = await entry(request);
  }

  const html = await response.text();
  return { response, html };
}

test("server-renders the Korean Solarform product shell", async () => {
  const { response, html } = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  assert.equal(response.bodyUsed, true);
  assert.match(html, /<html[^>]*\blang=["']ko["']/i);
  assert.match(html, /<title>3D 태양광 시뮬레이터 · 솔라폼 랩<\/title>/i);
  assert.match(html, /aria-label=["']주요 화면["']/);
  assert.match(html, />3D 조립</);
  assert.match(html, />환경 편집</);
  assert.match(html, />회로 편집</);
  assert.match(html, />시뮬레이션</);
  assert.match(html, />다중 형상 비교</);
  assert.match(html, />공식 · 근거</);
  assert.match(html, />데이터 내보내기</);
  assert.match(html, /단일 연속 PV 형상 비교/);
  assert.match(html, /공통 토지 투영면적 A_land/);
  assert.match(html, /단일 연속 PV 스킨/);
  assert.match(html, /일반 평면/);
  assert.match(html, /정육면체/);
  assert.match(html, /원기둥/);
  assert.match(html, />구</);
  assert.match(html, /반구/);
  assert.match(html, /원뿔/);
  assert.match(html, /위에서 보기/);
  assert.match(html, /표면 법선/);
  assert.match(html, /적분 샘플/);
  assert.match(html, /이상적 연속막 상한 · 총 AC/);
  assert.match(html, /토지 생산성 · 이상적 상한/);
  assert.match(html, /PV 면적당 생산성 · 이상적 상한/);
  assert.match(html, /kWh\/m²-land\/year/);
  assert.match(html, /kWh\/m²-PV\/year/);
  assert.doesNotMatch(html, /N_eq|20구역|동일 PV 활성면적|5×5 cm 물리 패널/);
  assert.match(html, /1280px 이상 PC 화면을 권장/);
  assert.match(html, /Three\.js와 Web Worker 계산을 위해 JavaScript가 필요/);

  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site|Starter Project/i);
  assert.doesNotMatch(html, /react-loading-skeleton|_sites-preview/i);
});

test("source tree contains product metadata and no disposable starter", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /title:\s*["']3D 태양광 시뮬레이터["']/);
  assert.match(page, /<SimulatorClient\s*\/>/);
  assert.match(layout, /<html\s+lang=["']ko["']/);
  assert.match(layout, /const\s+title\s*=\s*["']솔라폼 엔지니어링 랩["']/);
  assert.match(layout, /applicationName:\s*title/);
  assert.doesNotMatch(`${page}\n${layout}`, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  const previewDirectory = new URL("../app/_sites-preview", import.meta.url);
  const previewFiles = await readdir(previewDirectory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(previewFiles, []);
  await assert.rejects(access(new URL("../public/_sites-preview", import.meta.url)));
  await access(new URL("../src/ui/SimulatorClient.tsx", import.meta.url));
  await access(new URL("../src/ui/ThreeWorkspace.tsx", import.meta.url));
  await access(new URL("../src/workers/simulation.worker.ts", import.meta.url));
  await access(new URL("../docs/modeling-research.md", import.meta.url));
  await access(new URL("../docs/architecture.md", import.meta.url));
});

/**
 * The Render blueprint boots `node dist/standalone/server.js`. Nothing else in
 * the suite touches that file, so without this check the deployment could break
 * — `output: "standalone"` dropped from next.config, the bundle's private
 * node_modules no longer emitted — while every other gate stayed green, and the
 * failure would first appear as a crash loop on the host.
 */
test("node target emits the standalone bundle render.yaml starts", async (t) => {
  if (target !== "node") {
    t.skip(`DEPLOY_TARGET=${target} does not emit standalone output`);
    return;
  }

  const standalone = new URL("../dist/standalone/", import.meta.url);
  await access(new URL("server.js", standalone));
  await access(new URL("dist/client/", standalone));
  await access(new URL("dist/server/index.js", standalone));
  // Carrying its own vinext copy is the reason the running service does not
  // depend on devDependencies surviving the build.
  await access(new URL("node_modules/vinext/package.json", standalone));

  const [server, blueprint] = await Promise.all([
    readFile(new URL("server.js", standalone), "utf8"),
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
  ]);

  // Render assigns the port and requires a non-loopback bind.
  assert.match(server, /process\.env\.PORT/);
  assert.match(server, /0\.0\.0\.0/);
  assert.match(blueprint, /startCommand:\s*node dist\/standalone\/server\.js/);
  // Vite and vinext are devDependencies; an install that omits them cannot build.
  assert.match(blueprint, /buildCommand:.*--include=dev/);
});
