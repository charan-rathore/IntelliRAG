import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

/**
 * Behavioral regression for the /api/health first-failure response.
 *
 * The route snapshots getStorageStatus() before `await getSql()`, so on the
 * FIRST request whose await records a forced-ephemeral boot failure the
 * pre-fix response still claimed durable pglite storage on its own 503. The
 * catch branch now re-reads the status (health-storage-refresh.test.ts pins
 * that source shape); this test executes the actual sequence through the
 * real route handler.
 *
 * No real store is booted: the existing env-gated constructor seam
 * (INTELLIRAG_TEST_SEAM=1 + __intelliragPgliteCtorForTests__, consumed at
 * db.ts) injects a constructor whose ENOENT message matches isPgliteFsError,
 * so the opening attempt records AND marks ephemeral - the exact case the
 * catch-branch re-read fixes. db.ts starts an eager bootstrap at module load,
 * so the ephemeral flag is set before the dynamic import to keep every
 * attempt under test control, then cleared to make this the first failure.
 */

const g = globalThis as Record<string, any>;

class MatchedFailingCtor {
  static calls = 0;
  constructor(_opts: unknown) {
    MatchedFailingCtor.calls++;
    throw new Error("ENOENT: no such file or directory, open '/x/_libs/pglite.data'");
  }
}

let handlers: Record<string, (ctx: { request: Request }) => Promise<Response>>;
const ENV_KEYS = ["DATABASE_URL", "VERCEL", "VERCEL_ENV", "VERCEL_URL"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

before(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  g.__intelliragForceEphemeral__ = true; // block the module-load eager bootstrap
  process.env.INTELLIRAG_TEST_SEAM = "1";
  await import("../db.ts");
  const { Route } = await import("../../routes/api/health.ts");
  handlers = (
    Route as unknown as { options: { server: { handlers: typeof handlers } } }
  ).options.server.handlers;
});

describe("/api/health first boot-failure response (injected ctor, no real store)", () => {
  it("reports ephemeral storage on the very response whose await records the failure", async () => {
    // First-failure state: nothing recorded, nothing marked.
    for (const key of [
      "__pgliteInstance__",
      "__pgliteMigrateChain__",
      "__pgliteBootFailure__",
      "__intelliragForceEphemeral__",
    ]) {
      delete g[key];
    }
    MatchedFailingCtor.calls = 0;
    g.__intelliragPgliteCtorForTests__ = MatchedFailingCtor;

    const res = await handlers.GET({ request: new Request("http://test.local/api/health") });
    assert.equal(res.status, 503, "failed database surfaces as 503");
    const body = await res.json();
    assert.equal(body.status, "database-error");
    assert.equal(body.databaseReachable, false);
    assert.equal(MatchedFailingCtor.calls, 1, "exactly one boot attempt");
    assert.equal(
      body.storage.backend,
      "ephemeral",
      "the FIRST failing response must not claim durable pglite storage",
    );
    assert.equal(body.storage.durable, false);
    assert.ok(
      typeof body.storage.warning === "string" && body.storage.warning.includes("incident db-"),
      "warning names the recorded incident id",
    );
  });

  it("restores the env it saved", async () => {
    for (const k of ENV_KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];
  });
});
