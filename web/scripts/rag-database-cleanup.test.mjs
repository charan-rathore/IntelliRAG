import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const helper = new URL("../src/lib/rag/testing/close-database.mjs", import.meta.url).href;
function run(setup) {
  const dir = mkdtempSync(join(tmpdir(), "rag-cleanup-"));
  try {
    const file = join(dir, "case.test.mjs");
    writeFileSync(file, `${setup}\nawait import(${JSON.stringify(helper)});\n`);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ["--test", file], { encoding: "utf8", timeout: 5000, env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("RAG test teardown tolerates no initialized database", () => {
  const child = run("");
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

test("RAG test teardown awaits bootstrap before closing the acquired database", () => {
  const child = run(`
    globalThis.__pgBootstrapPromise__ = new Promise(resolve => setTimeout(() => {
      globalThis.__pgliteInstance__ = Promise.resolve({close: async () => console.log('CLOSED_AFTER_BOOT')});
      resolve();
    }, 30));
  `);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal((child.stdout.match(/CLOSED_AFTER_BOOT/g) ?? []).length, 1);
});

test("RAG test teardown waits for async database close instead of masking failure", () => {
  const child = run(`
    globalThis.__pgliteInstance__ = Promise.resolve({close: async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      throw new Error('close failure sentinel');
    }});
  `);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stdout + child.stderr, /close failure sentinel/);
});
