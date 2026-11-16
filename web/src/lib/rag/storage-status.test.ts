import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getStorageStatus } from "./storage.ts";

/**
 * Storage status must tell the truth when the configured PGLite store has
 * failed and the corpus was forced ephemeral (__intelliragForceEphemeral__).
 * The flag exists so callers fall back to the in-memory corpus; until this
 * fix, getStorageStatus still reported backend "pglite", durable: true,
 * denseAvailable: true - so /api/health and deployment posture could claim
 * durable local storage while serving a forget-on-restart memory corpus.
 *
 * No database is booted here: the flag and the boot-failure record are plain
 * globals read at call time.
 */

const g = globalThis as Record<string, any>;

function reset() {
  delete g.__intelliragForceEphemeral__;
  delete g.__pgliteBootFailure__;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
}

afterEach(reset);

describe("getStorageStatus under a forced-ephemeral corpus", () => {
  it("reports the local PGLite store as durable by default", () => {
    reset();
    const s = getStorageStatus();
    assert.equal(s.backend, "pglite");
    assert.equal(s.durable, true);
    assert.equal(s.denseAvailable, true);
    assert.equal(s.warning, null);
  });

  it("reports ephemeral, non-durable, dense-unavailable once the corpus is forced ephemeral", () => {
    reset();
    g.__intelliragForceEphemeral__ = true;
    const s = getStorageStatus();
    assert.equal(s.backend, "ephemeral");
    assert.equal(s.durable, false);
    assert.equal(s.denseAvailable, false);
    assert.ok(s.warning, "an ephemeral corpus must carry a warning");
    assert.match(s.warning!, /forgotten|restart/i);
  });

  it("names the recorded incident id when a boot failure is on record", () => {
    reset();
    g.__intelliragForceEphemeral__ = true;
    g.__pgliteBootFailure__ = {
      stage: "opening configured store",
      incidentId: "db-test123-incident",
      reasonClass: "Error",
      cause: new Error("raw cause stays server-side"),
      at: new Date().toISOString(),
      storeDir: "/tmp/whatever",
      regexMatched: false,
      markedEphemeral: false,
    };
    const s = getStorageStatus();
    assert.equal(s.durable, false);
    assert.ok(s.warning!.includes("db-test123-incident"), "warning must carry the incident id");
    assert.equal(s.warning!.includes("raw cause"), false, "raw cause must not leak into status");
  });

  // Getter-ordering pin only, NOT active-corpus durability proof: db.ts's
  // vercelWithoutDatabase() checks the flag BEFORE DATABASE_URL, so a
  // lingering flag with a neon URL would still serve the memory corpus while
  // this getter reports neon/durable. In a real deployment DATABASE_URL is
  // immutable per process and the flag can only be set by a pglite boot
  // failure (which never happens under neon), so the divergence needs a
  // mid-process env change. This test pins the getter's precedence choice.
  it("neon stays durable even if the flag lingers from an earlier pglite attempt", () => {
    reset();
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    g.__intelliragForceEphemeral__ = true;
    try {
      const s = getStorageStatus();
      assert.equal(s.backend, "neon");
      assert.equal(s.durable, true);
    } finally {
      delete process.env.DATABASE_URL;
    }
  });
});
