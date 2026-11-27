#!/usr/bin/env node
// Local, synthetic, no-model browser regression. Run from web/:
// CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome node scripts/citation-navigation.browser.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = await mkdtemp(resolve(tmpdir(), "citation-navigation-"));
const evidence = process.env.CITATION_EVIDENCE_DIR;
const results = [];
let browser;
let server;
try {
  await build({
    configFile: false,
    root: web,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    logLevel: "error",
    plugins: [react()],
    resolve: {
      alias: {
        "@/lib/rag/functions": resolve(web, "scripts/fixtures/citation-no-server.ts"),
        "@": resolve(web, "src"),
      },
    },
    build: {
      outDir: out,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: resolve(web, "scripts/fixtures/citation-navigation.tsx"),
        name: "CitationFixture",
        formats: ["iife"],
        fileName: () => "app.js",
      },
    },
  });
  const script = await readFile(resolve(out, "app.js"));
  const html = `<!doctype html><meta charset="utf-8"><style>body{font:17px system-ui;background:#101315;color:#f2f0e8;margin:24px}main{max-width:760px;margin:auto}section{border:1px solid #63717d;padding:24px;margin:28px 0;min-height:430px}a{color:#98d0ff}a[id]{display:block;padding:14px;border:1px solid #63717d;margin:16px 0}.cite-chip{background:#334654;padding:4px;border-radius:3px}li{list-style:none;margin:12px 0}button{background:#1b232b;color:inherit;padding:12px;border:1px solid #647385}p{line-height:1.6}:target{outline:4px solid #ffd36b;outline-offset:4px}svg{width:16px;height:16px}ul{padding:0}</style><div id="root"></div><script src="/app.js"></script>`;
  server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url.startsWith("/app.js") ? "text/javascript" : "text/html");
    res.end(req.url.startsWith("/app.js") ? script : html);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
    headless: true,
  });
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const width of [1100, 390])
    for (const scope of ["normal", "special"])
      for (const mode of ["reading", "lab", "excerpt", "passages"]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        const errors = [];
        page.on("pageerror", (error) => {
          errors.push(error.message);
          console.error(error.message);
        });
        const externalRequests = [];
        await page.route("**/*", (route) => {
          if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
          externalRequests.push(route.request().url());
          return route.abort();
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}&scope=${scope}`);
        const section = page.locator('[data-turn="second"]');
        await section.locator("a.cite-chip").first().waitFor();
        const ids = await page
          .locator('[id^="cite-"]')
          .evaluateAll((nodes) => nodes.map((node) => node.id));
        if (mode === "passages") await section.locator("details summary").click();
        const chips = section.locator(mode === "passages" ? "details a.cite-chip" : "a.cite-chip");
        for (const sourceIndex of [1, 2]) {
          await chips.nth(sourceIndex - 1).click();
          const target = await page.evaluate(() => {
            const node = document.querySelector(":target");
            return {
              turn: node?.closest("[data-turn]")?.getAttribute("data-turn"),
              text: node?.textContent,
              hash: location.hash,
            };
          });
          const row = {
            width,
            scope,
            mode,
            sourceIndex,
            ...target,
            unique: ids.length === new Set(ids).size,
            count: ids.length,
            errors: [...errors],
            externalRequests: [...externalRequests],
            pass:
              target.turn === "second" &&
              Boolean(target.text?.includes(`Vega deployment guide ${sourceIndex}`)) &&
              ids.length === new Set(ids).size &&
              ids.length === 4 &&
              errors.length === 0 &&
              externalRequests.length === 0,
          };
          if (mode === "lab") {
            // Display order is [packed #2, packed #1, unpacked #3]. Anchor #1 must still mean packed #1.
            const candidateRows = section.locator("li");
            assert.ok(
              (await candidateRows.first().innerText()).includes("Vega deployment guide 2"),
            );
            assert.equal(await candidateRows.last().getAttribute("id"), null);
          }
          results.push(row);
          if (evidence && sourceIndex === 1)
            await page.screenshot({ path: resolve(evidence, `${width}-${scope}-${mode}.png`) });
        }
        await page.close();
      }
  if (evidence)
    await writeFile(resolve(evidence, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  assert.equal(
    results.filter((row) => row.pass).length,
    results.length,
    "citation must target its own answer's packed source, not the first matching global ID",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
  await rm(out, { recursive: true, force: true });
}
