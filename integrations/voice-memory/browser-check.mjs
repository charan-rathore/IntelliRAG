import { chromium } from "playwright";
import { server } from "./server.mjs";
await new Promise((r) => server.listen(4317, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  await page.goto("http://127.0.0.1:4317/");
  await page
    .getByRole("button", { name: "Try a clearly fictional project" })
    .click();
  await page.getByText("Documents ready. Ask a question above.").waitFor();
  await page
    .getByLabel("Ask across your documents")
    .fill("What is pending for the pilot launch security review?");
  await page.getByRole("button", { name: "Find the evidence" }).click();
  await page
    .getByText(
      "Relevant passages need review. The question is unresolved; drafting is disabled.",
    )
    .waitFor();
  await page.locator("summary").first().click();
  await page.screenshot({
    path: "/downloads/bolna-local-desktop.png",
    fullPage: true,
  });
  if (
    !(await page
      .getByRole("button", { name: "Turn this into a draft" })
      .isDisabled())
  )
    throw Error("Unresolved answer allowed draft");
  await page
    .getByLabel("Ask across your documents")
    .fill("budget approved Maya");
  await page.getByRole("button", { name: "Find the evidence" }).click();
  await page
    .getByText("Evidence ready. Open an original passage to inspect it.")
    .waitFor();
  await page.getByRole("button", { name: "Turn this into a draft" }).click();
  await page.getByRole("heading", { name: "Your follow-up draft" }).waitFor();
  await page.screenshot({
    path: "/downloads/bolna-local-draft.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/downloads/bolna-local-phone.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Phone horizontal overflow");
  await page.setViewportSize({ width: 320, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("320px horizontal overflow");
  console.log(
    "UI journey passed: ambiguous passages unresolved/draftdisabled -> positive exact evidence -> review draft; desktop,390px,320px.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
