import { after } from "node:test";

// Importing the store eagerly starts local PGlite. Close it after this test
// worker finishes so its WASM runtime cannot keep an otherwise green run alive.
after(async () => {
  const state = /** @type {typeof globalThis & {
    __pgBootstrapPromise__?: Promise<void>,
    __pgliteInstance__?: Promise<{close(): Promise<void>}>
  }} */ (globalThis);
  await state.__pgBootstrapPromise__;
  const database = await state.__pgliteInstance__;
  if (database) await database.close();
});
