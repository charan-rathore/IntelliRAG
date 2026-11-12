#!/usr/bin/env node
/**
 * Release gate: does this deployment's promise match its storage?
 *
 *   node scripts/release-gate.mjs <baseUrl> [demo|product]
 *
 * `product` blocks promotion unless storage is durable, the database answered,
 * and the server classifies itself as product. `demo` blocks promotion unless
 * the host *behaves* like a demo: it says so on the page and refuses a
 * visitor's model key. Exit code 1 means do not promote.
 */

export function evaluateHealth(health, expect) {
  const failures = [];
  if (!health || typeof health !== "object") return ["Health endpoint returned no JSON."];
  const posture = health.deployment;
  if (!posture || (posture.mode !== "demo" && posture.mode !== "product")) {
    failures.push("Health does not report a deployment mode; the server cannot be held to a promise.");
    return failures;
  }
  const durable = health.storage?.durable === true;
  const reachable = health.databaseReachable === true;
  if (posture.mode === "product" && (!durable || !reachable)) {
    failures.push("Server claims product mode without durable, reachable storage.");
  }
  if (posture.customSources && !durable && posture.temporaryImports !== true) {
    failures.push("Custom sources are accepted on non-durable storage without saying imports are temporary.");
  }
  if (expect === "product") {
    if (posture.mode !== "product") failures.push(`Expected product mode, host is ${posture.mode} (${(posture.reasons ?? []).join(", ")}).`);
    if (!durable) failures.push("Product release requires durable storage.");
    if (!reachable) failures.push("Product release requires a reachable database.");
  }
  if (expect === "demo" && posture.mode !== "demo") {
    failures.push("Expected the public host to stay in demo mode.");
  }
  return failures;
}

/** Vercel previews sit behind Deployment Protection; a bypass secret lets CI read them. */
function headers(extra = {}) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return bypass ? { "x-vercel-protection-bypass": bypass, ...extra } : extra;
}

async function main() {
  const base = (process.argv[2] || process.env.RELEASE_GATE_URL || "").replace(/\/$/, "");
  const expect = process.argv[3] || process.env.RELEASE_GATE_EXPECT || "demo";
  if (!base) {
    console.error("usage: release-gate.mjs <baseUrl> [demo|product]");
    process.exit(2);
  }
  const report = { base, expect, checkedAt: new Date().toISOString(), failures: [] };
  let health = null;
  try {
    const res = await fetch(`${base}/api/health`, { headers: headers(), signal: AbortSignal.timeout(15000) });
    health = await res.json();
  } catch (err) {
    report.failures.push(`Health unreachable: ${err instanceof Error ? err.message : err}`);
  }
  report.failures.push(...evaluateHealth(health, expect));
  report.mode = health?.deployment?.mode ?? null;

  if (health?.deployment?.mode === "demo") {
    // Behavioural probes: the page and the API must agree with the health JSON.
    try {
      const html = await (await fetch(base, { headers: headers(), signal: AbortSignal.timeout(15000) })).text();
      if (!html.includes("Interactive demo")) report.failures.push("Demo host does not tell visitors it is a demo.");
    } catch (err) {
      report.failures.push(`Homepage unreachable: ${err instanceof Error ? err.message : err}`);
    }
    try {
      const keysOn = health?.deployment?.visitorKeys === true;
      const res = await fetch(`${base}/api/keys`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ openrouter: "sk-or-release-gate-probe" }),
        signal: AbortSignal.timeout(15000),
      });
      if (keysOn && res.status !== 200) report.failures.push(`Host advertises visitor keys but refused one (HTTP ${res.status}).`);
      if (!keysOn && res.status !== 403) report.failures.push(`Host pins keys off but accepted one (HTTP ${res.status}).`);
      if (keysOn) {
        const body = await res.text();
        if (body.includes("sk-or-release-gate-probe")) report.failures.push("Key probe response echoed the key.");
        await fetch(`${base}/api/keys`, {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({ clearOpenRouter: true }),
          signal: AbortSignal.timeout(15000),
        });
      }
    } catch (err) {
      report.failures.push(`Key probe failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  report.verdict = report.failures.length ? "do-not-promote" : "promote";
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failures.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
