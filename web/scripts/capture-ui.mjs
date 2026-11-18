#!/usr/bin/env node
/**
 * The README's pictures, taken from the real app: a built preview on this
 * machine, the pinned seed corpus, no model key (answers are cited extracts).
 * Nothing is mocked. Run after `npm run build && npm run preview:restart`:
 *   node scripts/capture-ui.mjs [outDir]
 * Writes desktop and phone screenshots and a recording of a conversation.
 */
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const URL = process.env.CAPTURE_URL || "http://127.0.0.1:8081/";
const out = resolve(process.argv[2] || "../docs/images/ui");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function session(name, viewport, script) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, recordVideo: name === "desktop" ? { dir: out + "/.video", size: viewport } : undefined, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal,[data-tanstack-devtools]{display:none!important}" });
  await script(page);
  await ctx.close();
}

async function ask(page, q) {
  const box = page.getByLabel("Ask a question about your documents");
  await box.click();
  await box.pressSequentially(q, { delay: 18 });
  await page.keyboard.press("Enter");
  // Done when the newest answer shows its coverage verdict.
  await page.waitForFunction(() => {
    const arts = document.querySelectorAll("main article");
    const last = arts[arts.length - 1];
    return last && /Grounded|Source excerpts|Refused|Guide/.test(last.textContent || "") && !last.querySelector(".animate-spin");
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(900);
}

const shotLast = (page, file) => page.locator("main article").last().screenshot({ path: join(out, file) });

await session("desktop", { width: 1440, height: 900 }, async (page) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "home.png") });
  await ask(page, "What caused the Kubernetes pod scheduling failures?");
  await page.screenshot({ path: join(out, "answer.png") });
  await ask(page, "How do I fix it?");
  await shotLast(page, "follow-up.png");
  await page.screenshot({ path: join(out, "conversation.png") });
  await ask(page, "What is the CEO's salary?");
  await shotLast(page, "refusal.png");
});

await session("phone", { width: 390, height: 844 }, async (page) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "phone-home.png") });
  await ask(page, "How do you stop a Redis cache stampede?");
  await page.screenshot({ path: join(out, "phone-answer.png") });
});

await browser.close();
const video = readdirSync(out + "/.video").find((f) => f.endsWith(".webm"));
if (video) renameSync(join(out, ".video", video), join(out, "conversation.webm"));
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "captured with no page errors");
