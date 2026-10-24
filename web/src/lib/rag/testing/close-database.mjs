import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// Importing the store eagerly starts local PGlite. Close it after this test
// worker finishes so its WASM runtime cannot keep an otherwise green run
// alive, then remove this worker's private data directory, if it has one.
after(async () => {
  const state = /** @type {typeof globalThis & {
    __pgBootstrapPromise__?: Promise<void>,
    __pgliteInstance__?: Promise<{close(): Promise<void>}>,
    __intelliragPgliteTestDir?: string
  }} */ (globalThis);
  await state.__pgBootstrapPromise__;
  const database = await state.__pgliteInstance__;
  if (database) await database.close();
  const dir = state.__intelliragPgliteTestDir;
  // Only ever remove a directory this worker's own helper created.
  if (dir && dir.startsWith(join(tmpdir(), "intellirag-pglite-test-"))) {
    rmSync(dir, { recursive: true, force: true });
  }
});
