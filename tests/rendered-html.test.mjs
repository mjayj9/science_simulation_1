import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
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
}

test("server-renders the Korean Solarform product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
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
  assert.match(html, /강체 배열과 0\.050 m² 연속 PV 스킨을 같은 활성면적으로 비교/);
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
