import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * /api/health snapshots getStorageStatus() before `await getSql()`. The first
 * request that hits a PGLite boot failure records and marks the failure
 * inside that await, so a snapshot taken beforehand claims durable storage on
 * the very response reporting the database down. The catch branch must
 * re-read the status after the failed await.
 *
 * This is a source-level pin (same style as scripts/theme.test.mjs): the
 * failing-boot sequence itself needs a real store attempt and is covered by
 * db-boot-failure.test.ts's probe seam, not here - no store is booted in this
 * test.
 */
const source = readFileSync(
  new URL("../../routes/api/health.ts", import.meta.url),
  "utf8",
);

test("health catch branch re-reads storage status after the failed getSql await", () => {
  const catchAt = source.indexOf("} catch {");
  assert.notEqual(catchAt, -1, "health route has no catch branch");
  const catchBody = source.slice(catchAt);
  assert.ok(
    catchBody.includes("storage: getStorageStatus(),"),
    "catch branch must recompute storage via getStorageStatus() - the top-of-handler snapshot can predate a failure recorded during await getSql()",
  );
});

test("health handler still snapshots storage for the success path", () => {
  assert.ok(
    source.includes("const storage = getStorageStatus();"),
    "top-of-handler snapshot for the success path should remain",
  );
});
