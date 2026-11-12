import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomicJson } from "../src/lib/rag/graphify/atomic-json.mjs";

test("graph snapshots replace complete files with private permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "intellirag-atomic-"));
  try {
    const path = join(root, "graph.json");
    writeAtomicJson(path, { nodes: ["old"] });
    writeAtomicJson(path, { nodes: ["new"], memory: ["query"] });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { nodes: ["new"], memory: ["query"] });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const circular = {}; circular.self = circular;
    assert.throws(() => writeAtomicJson(path, circular));
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).nodes, ["new"]);
    assert.deepEqual(readdirSync(root), ["graph.json"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
