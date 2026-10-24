import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// node:test runs test files in parallel worker processes, and PGlite is a
// single-writer embedded Postgres: workers sharing one data directory corrupt
// each other's catalog (CI fails with "unexpected data beyond EOF" and
// missing-column bootstrap errors). Give every worker process its own data
// directory, recorded on a per-process global that pgliteDataDir() reads.
// Import this module first, before anything that opens the database.
// close-database.mjs removes the directory after the worker's DB closes.
globalThis.__intelliragPgliteTestDir = mkdtempSync(
  join(tmpdir(), "intellirag-pglite-test-"),
);
