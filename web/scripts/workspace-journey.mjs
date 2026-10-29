/** Real no-key UI journey against the local app. No fixture requests are mocked. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const port = Number(process.env.JOURNEY_PORT || 8188);
const origin = `http://localhost:${port}`;
const env = { ...process.env, VITE_AUTH_ENABLED: "false" };
for (const key of Object.keys(env)) {
  if (/KEY|TOKEN|DATABASE_URL/.test(key)) delete env[key];
}
const server = spawn(
  "node",
  [
    "scripts/with-app-env.mjs",
    "node_modules/vite/bin/vite.js",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  },
);
let logs = "";
const errors = [];
let browser;
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
const timings = {};
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* The server may still be starting, or already stopped during cleanup. */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "local app did not start");
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", (e) => errors.push(e.message));
  const start = performance.now();
  await page.goto(origin);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Find the answer. Keep the evidence." }).waitFor();
  timings.readyMs = Math.round(performance.now() - start);
  assert.equal(
    await page.locator("main > div").evaluate((e) => e.scrollTop),
    0,
    "empty state must stay at top",
  );
  await page.screenshot({ path: "/tmp/intelli-workspace-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/intelli-workspace-phone-empty.png", fullPage: true });
  // Modal focus stays inside and Escape restores the initiating control.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("/");
  assert.equal(
    await page.getByRole("dialog").evaluate((el) => el.contains(document.activeElement)),
    true,
    "composer shortcut must not escape modal",
  );
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.getByRole("dialog").evaluate((el) => el.contains(document.activeElement)),
    true,
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  const openSources = () =>
    page.getByRole("button", { name: "Change sources", exact: true }).click();
  const closeSources = async () => {
    const close = page.getByRole("button", { name: "Close dialog", exact: true });
    if (await close.count()) await close.click();
    else await page.getByRole("button", { name: "Add / manage sources", exact: true }).click();
  };
  const importDoc = async (title, body) => {
    await page.getByRole("textbox", { name: "Document title", exact: true }).fill(title);
    await page.getByRole("textbox", { name: "Document text", exact: true }).fill(body);
    const t = performance.now();
    await page.getByRole("button", { name: "Add document", exact: true }).click();
    await page
      .getByText("Document added. Questions now use this source collection.")
      .waitFor({ timeout: 20000 });
    timings.importMs = Math.round(performance.now() - t);
    await page.waitForLoadState("networkidle");
  };
  await page.getByRole("button", { name: "Add a source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Source URL", exact: true })
    .fill("ftp://example.invalid/policy");
  await page.getByRole("button", { name: "Import URL", exact: true }).click();
  await page.getByRole("alert").first().waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Source URL", exact: true }).inputValue(),
    "ftp://example.invalid/policy",
    "retain failed URL for correction",
  );
  await importDoc(
    "Release policy - October",
    "# Release approval\n\nThe Orion release owner is Maya Chen. Production release requires security review and a signed rollback checklist.\n\n# Schedule\n\nThe release window starts on Friday at 16:00 UTC. Do not ship before security review is complete.",
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Document text", exact: true }).inputValue(),
    "",
  );
  await closeSources();
  const firstScope = await page.locator("footer p[title]").getAttribute("title");
  assert.ok(firstScope?.startsWith("imported:"));
  const askAndWait = async (question, answer) => {
    await page.getByRole("textbox", { name: "Ask a question about your documents" }).fill(question);
    const t = performance.now();
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page
      .locator("main")
      .getByText(answer, { exact: false })
      .first()
      .waitFor({ timeout: 20000 });
    await page.waitForLoadState("networkidle");
    timings.queryMs = Math.round(performance.now() - t);
  };
  await askAndWait("Who is the Orion release owner?", "Maya Chen");
  const cited = page
    .locator("main")
    .getByRole("link")
    .filter({ hasText: "Release approval" })
    .first();
  await cited.waitFor();
  await page.screenshot({ path: "/tmp/intelli-workspace-answer.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("main article").last().scrollIntoViewIfNeeded();
  await page
    .locator("main article")
    .last()
    .evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "/tmp/intelli-workspace-phone.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `overflow at ${width}`,
    );
  }
  await cited.click();
  await page.getByRole("heading", { name: "Release approval", exact: true }).waitFor();
  assert.ok(
    (await page.locator("main").innerText()).includes("signed rollback checklist"),
    "source opens complete original text",
  );
  await page.screenshot({ path: "/tmp/intelli-workspace-source.png", fullPage: true });
  await page.goto(origin);
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 390, height: 844 });
  await openSources();
  await importDoc(
    "Support policy",
    "# Support escalation\n\nThe Atlas support escalation owner is Imani Rao. Critical incidents must be routed to the support escalation owner. Maya Chen is not the Atlas owner.",
  );
  await closeSources();
  assert.notEqual(
    await page.locator("footer p[title]").getAttribute("title"),
    firstScope,
    "second import changes active collection",
  );
  await askAndWait("Who is the Atlas support escalation owner?", "Imani Rao");
  const text = await page.locator("main").innerText();
  assert.ok(!text.includes("Orion release owner"), "other collection must not leak into answer");
  await openSources();
  await page.getByRole("combobox", { name: "Search collection" }).selectOption(firstScope);
  await closeSources();
  assert.equal(await page.locator("footer p[title]").getAttribute("title"), firstScope);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await openSources();
  assert.ok(
    await page
      .getByRole("combobox", { name: "Search collection" })
      .locator(`option[value="${firstScope}"]`)
      .count(),
    "local source survives page reload",
  );
  assert.deepEqual(errors, [], "no browser runtime errors");
  assert.ok(
    !logs.includes("localeCompare is not a function"),
    "no timestamp error during suggestions",
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        timings,
        browserErrors: errors,
        checks: [
          "real paste",
          "invalid URL retained",
          "citation original",
          "collection switching",
          "reload local source",
          "390/320px no overflow",
          "phone import modal",
          "keyboard modal focus/Escape",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  writeFileSync("/tmp/intelli-ui-server.txt", logs);
  if (browser) await browser.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* The server may still be starting, or already stopped during cleanup. */
  }
}
