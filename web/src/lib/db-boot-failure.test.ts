import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Failure-injected contract tests for PGLite bootstrap failure handling.
 * No real database is booted: an env-gated test-only constructor seam
 * (`INTELLIRAG_TEST_SEAM=1` + `__intelliragPgliteCtorForTests__`) replaces
 * the PGlite class, so these tests inject open/migration rejections.
 *
 * db.ts starts an eager bootstrap at module load, so this file imports it
 * dynamically in before() ONLY AFTER the ephemeral flag is set - that makes
 * the module-load condition skip the eager attempt, keeping every attempt
 * under test control. The seam env flag is likewise set before import.
 *
 * Contract under test (diagnostic / no-implicit-retry):
 * - one failed attempt per configured-store identity per process
 * - concurrent FIRST callers share the in-flight attempt: constructor count
 *   1, one stable incidentId
 * - repeated callers observe the same typed failure; clearing cached handles
 *   must not cause a hidden reopen/reset/recreate
 * - a different store identity (test-only data-dir override; production
 *   identity is immutable per process - see pgliteDataDir) is not blocked by
 *   a stale record
 * - the public error serializes to {name, stage, incidentId, message} only
 * - fallback classification is preserved exactly: fallbackEligible equals
 *   what the un-wrapped error would have produced at store.server.ts
 *   dbUnavailable (raw-message regex for the first failure; the ephemeral
 *   short-circuit for recorded-failure callers)
 */

const g = globalThis as Record<string, any>;

let getSql: () => Promise<unknown>;
let ensureDbReady: () => Promise<void>;
let getPglite: () => Promise<unknown>;
let isDbUnavailableError: (err: unknown) => boolean;

class FailingCtor {
  static calls = 0;
  constructor(_opts: unknown) {
    FailingCtor.calls++;
    // Observed incident shape: a wasm abort whose message matches none of
    // the fallback-classifier regex terms (no "pglite"/"ENOENT"/"_libs").
    throw new Error("Aborted(). Build with -sASSERTIONS for more info.");
  }
}

class MatchedFailingCtor {
  static calls = 0;
  constructor(_opts: unknown) {
    MatchedFailingCtor.calls++;
    throw new Error("ENOENT: no such file or directory, open '/x/_libs/pglite.data'");
  }
}

class MigrationFailingCtor {
  static calls = 0;
  static transactions = 0;
  static closes = 0;
  waitReady = Promise.resolve();
  constructor(_opts: unknown) {
    MigrationFailingCtor.calls++;
  }
  async exec(_sql: string): Promise<void> {
    // _migrations bookkeeping table creation succeeds
  }
  async query<T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> {
    return { rows: [] };
  }
  async transaction(_work: (tx: unknown) => Promise<void>): Promise<void> {
    MigrationFailingCtor.transactions++;
    throw new Error("disk I/O error");
  }
  async close(): Promise<void> {
    MigrationFailingCtor.closes++;
  }
}

before(async () => {
  // Block the module-load eager bootstrap, enable the constructor seam, then
  // import db.ts. Every getSql() below is a controlled test attempt.
  g.__intelliragForceEphemeral__ = true;
  process.env.INTELLIRAG_TEST_SEAM = "1";
  ({ getSql, ensureDbReady, getPglite, isDbUnavailableError } = await import("./db.ts"));
});

function resetDbState() {
  for (const key of [
    "__pgSqlPromise__",
    "__pgliteInstance__",
    "__pgliteMigrateChain__",
    "__pgliteBootFailure__",
    "__intelliragForceEphemeral__",
    "__intelliragPgliteCtorForTests__",
  ]) {
    delete g[key];
  }
  FailingCtor.calls = 0;
  MatchedFailingCtor.calls = 0;
  MigrationFailingCtor.calls = 0;
  MigrationFailingCtor.transactions = 0;
  MigrationFailingCtor.closes = 0;
  delete process.env.DATABASE_URL;
  delete process.env.NETLIFY_DATABASE_URL;
  delete process.env.VERCEL;
  g.__intelliragPgliteTestDir = mkdtempSync(join(tmpdir(), "ir-diag-boot-"));
}

async function rejections(n: number): Promise<unknown[]> {
  const settled = await Promise.allSettled(Array.from({ length: n }, () => getSql()));
  return settled.map((s) => (s.status === "rejected" ? s.reason : new Error("UNEXPECTED SUCCESS")));
}

function assertTyped(err: unknown, stage: string, incidentId?: string): string {
  assert.ok(err instanceof Error, "rejection must be an Error");
  assert.equal(err.name, "DbUnavailableError");
  const e = err as Error & { stage?: string; incidentId?: string };
  assert.equal(e.stage, stage);
  assert.equal(typeof e.incidentId, "string");
  if (incidentId) assert.equal(e.incidentId, incidentId, "incidentId must stay stable");
  const json = JSON.parse(JSON.stringify(err));
  assert.deepEqual(
    Object.keys(json).sort(),
    ["incidentId", "message", "name", "stage"],
    "public error must serialize to exactly {name, stage, incidentId, message}",
  );
  const serialized = JSON.stringify(json);
  assert.equal(serialized.includes("Aborted"), false, "raw cause must not leak");
  assert.equal(serialized.includes("disk I/O"), false, "raw cause must not leak");
  assert.equal(serialized.includes("/tmp"), false, "paths must not leak");
  assert.equal(serialized.includes("_libs"), false, "paths must not leak");
  return e.incidentId!;
}

function eligible(err: unknown): boolean {
  return (err as { fallbackEligible?: boolean }).fallbackEligible === true;
}

describe("pglite bootstrap failure contract (failure-injected)", () => {
  beforeEach(resetDbState);

  it("opening failure, unmatched shape: concurrent first callers share one attempt; no implicit retry", async () => {
    g.__intelliragPgliteCtorForTests__ = FailingCtor;
    // Cold start: three CONCURRENT first callers, no prior settled call.
    const first3 = await rejections(3);
    const id = assertTyped(first3[0], "opening configured store");
    assertTyped(first3[1], "opening configured store", id);
    assertTyped(first3[2], "opening configured store", id);
    assert.equal(FailingCtor.calls, 1, "concurrent first callers share one attempt");
    // Unmatched raw shape keeps its old no-fallback classification.
    assert.equal(eligible(first3[0]), false);
    // Repeated callers observe the same recorded incident, no reopen.
    for (const err of await rejections(2)) assertTyped(err, "opening configured store", id);
    assert.equal(FailingCtor.calls, 1, "repeated callers must not reopen the store");
  });

  it("opening failure, matched shape: fallback classification preserved (eligible)", async () => {
    g.__intelliragPgliteCtorForTests__ = MatchedFailingCtor;
    const [first] = await rejections(1);
    const id = assertTyped(first, "opening configured store");
    assert.equal(eligible(first), true, "matched raw message used to fall back; typed must too");
    assert.equal(g.__intelliragForceEphemeral__, true, "opening regex-mark policy unchanged");
    const [again] = await rejections(1);
    assertTyped(again, "opening configured store", id);
    assert.equal(eligible(again), true, "recorded incident replaces the old 'disabled' short-circuit");
    assert.equal(MatchedFailingCtor.calls, 1);
  });

  it("migration failure, concurrent first callers: one pass, stable incident, no rerun/reopen", async () => {
    g.__intelliragPgliteCtorForTests__ = MigrationFailingCtor;
    const first3 = await rejections(3);
    const id = assertTyped(first3[0], "app migrations");
    assertTyped(first3[1], "app migrations", id);
    assertTyped(first3[2], "app migrations", id);
    // Old policy: the first pass's raw unmatched message reached every
    // concurrent caller (no fallback); only LATER callers hit the ephemeral
    // 'disabled' short-circuit (fallback). The typed error preserves both.
    assert.equal(eligible(first3[0]), false, "first failure keeps raw-message classification");
    assert.equal(eligible(first3[1]), false);
    assert.equal(eligible(first3[2]), false);
    assert.equal(g.__intelliragForceEphemeral__, true, "migration mark policy unchanged");
    const [later] = await rejections(1);
    assertTyped(later, "app migrations", id);
    assert.equal(eligible(later), true, "recorded incident replaces the old 'disabled' short-circuit");
    assert.equal(MigrationFailingCtor.calls, 1, "no reopen after migration failure");
    assert.equal(MigrationFailingCtor.transactions, 1, "migration must not re-run");
    assert.equal(MigrationFailingCtor.closes, 1, "instance closed exactly once");
  });

  it("cleared handles do not trigger a hidden reopen", async () => {
    g.__intelliragPgliteCtorForTests__ = FailingCtor;
    const [first] = await rejections(1);
    const id = assertTyped(first, "opening configured store");
    // Simulate the cleanup paths that clear cached handles after a failure.
    delete g.__pgliteInstance__;
    delete g.__pgliteMigrateChain__;
    const [after] = await rejections(1);
    assertTyped(after, "opening configured store", id);
    assert.equal(FailingCtor.calls, 1, "clearing handles must not reopen the store");
  });

  it("a different configured store is not blocked by a stale record", async () => {
    // Stale-record guard, not multi-store support: only the latest failed
    // store is remembered and the ephemeral flag stays process-global. The
    // test-only data-dir override stands in for a different configured store
    // (the supported deployment scope is one immutable store per process).
    g.__intelliragPgliteCtorForTests__ = FailingCtor;
    const [first] = await rejections(1);
    const idA = assertTyped(first, "opening configured store");
    assert.equal(FailingCtor.calls, 1);
    // Test-only data-dir override stands in for a different configured store.
    g.__intelliragPgliteTestDir = mkdtempSync(join(tmpdir(), "ir-diag-boot-b-"));
    g.__intelliragPgliteCtorForTests__ = MatchedFailingCtor;
    const [second] = await rejections(1);
    const idB = assertTyped(second, "opening configured store");
    assert.notEqual(idB, idA, "a different store records its own first failure");
    assert.equal(MatchedFailingCtor.calls, 1, "the new store gets its own single attempt");
  });

  it("entry points keep the incident observable after the corpus is marked ephemeral", async () => {
    g.__intelliragPgliteCtorForTests__ = MigrationFailingCtor;
    const [first] = await rejections(1);
    const id = assertTyped(first, "app migrations");
    assert.equal(g.__intelliragForceEphemeral__, true);
    // Without a record check, both entry points would now short-circuit:
    // ensureDbReady would RESOLVE (false readiness) and getPglite would throw
    // a generic 'disabled' error, losing the incident.
    const ready = await ensureDbReady().then(() => null, (e) => e);
    assertTyped(ready, "app migrations", id);
    const pg = await getPglite().then(() => null, (e) => e);
    assertTyped(pg, "app migrations", id);
    assert.equal(MigrationFailingCtor.calls, 1);
  });

  it("a migration pass queued by a second module instance does not run after a recorded failure", async () => {
    // HMR creates a second instance of db.ts with its own module-local
    // sqlPromise but the SAME global caches. Its migration pass can be queued
    // behind another instance's pass; when that pass fails and closes the
    // shared instance, the queued pass must observe the record and stop.
    let rejectFirst!: (e: Error) => void;
    const firstTx = new Promise<never>((_res, rej) => {
      rejectFirst = rej;
    });
    class DeferredMigrationCtor {
      static calls = 0;
      static transactions = 0;
      static closes = 0;
      waitReady = Promise.resolve();
      constructor(_opts: unknown) {
        DeferredMigrationCtor.calls++;
      }
      async exec(_sql: string): Promise<void> {}
      async query<T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> {
        return { rows: [] };
      }
      transaction(_work: (tx: unknown) => Promise<void>): Promise<void> {
        DeferredMigrationCtor.transactions++;
        return firstTx;
      }
      async close(): Promise<void> {
        DeferredMigrationCtor.closes++;
      }
    }
    g.__intelliragPgliteCtorForTests__ = DeferredMigrationCtor;
    // Import a second module instance (HMR analogue) with the eager
    // module-load bootstrap blocked, then start both instances' getSql().
    g.__intelliragForceEphemeral__ = true;
    const hmrSpecifier = "./db.ts?hmr=2"; // non-literal: tsc cannot type-check it
    const m2 = (await import(hmrSpecifier)) as { getSql: typeof getSql };
    delete g.__intelliragForceEphemeral__;
    const p1 = getSql().then(() => null, (e) => e);
    // Wait until the first instance's migrate pass is blocked inside its
    // transaction - THEN the second instance queues its pass behind it.
    for (let i = 0; i < 400 && DeferredMigrationCtor.transactions === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(DeferredMigrationCtor.transactions, 1, "first pass must reach its migration");
    const p2 = m2.getSql().then(() => null, (e) => e);
    // Let the second instance finish queueing its pass on the shared chain.
    await new Promise((r) => setTimeout(r, 25));
    rejectFirst(new Error("disk I/O error"));
    const [r1, r2] = await Promise.all([p1, p2]);
    const id = assertTyped(r1, "app migrations");
    assertTyped(r2, "app migrations", id);
    assert.equal(DeferredMigrationCtor.calls, 1, "both instances share one construction");
    assert.equal(
      DeferredMigrationCtor.transactions,
      1,
      "the queued second pass must not run migrations on the closed store",
    );
    assert.equal(DeferredMigrationCtor.closes, 1);
  });

  it("brand check matches typed errors across module identities (HMR caveat)", async () => {
    g.__intelliragPgliteCtorForTests__ = FailingCtor;
    const [first] = await rejections(1);
    const id = assertTyped(first, "opening configured store");
    assert.equal(isDbUnavailableError(first), true, "same-module typed error");
    // A structurally branded object from a DIFFERENT module identity (HMR
    // reload analogue): instanceof would fail, the brand check must not - so
    // the store.server.ts fallback classifier keeps working across reloads.
    const foreign = {
      name: "DbUnavailableError",
      stage: "opening configured store",
      incidentId: id,
      fallbackEligible: false,
      message: `Storage unavailable while opening configured store (incident ${id}).`,
    };
    assert.equal(isDbUnavailableError(foreign), true, "foreign-identity branded error");
    assert.equal(isDbUnavailableError(new Error("nope")), false);
    assert.equal(isDbUnavailableError({ name: "DbUnavailableError" }), false, "partial shape is not enough");
    assert.equal(isDbUnavailableError(null), false);
  });
});
