import { test } from "node:test";
import assert from "node:assert/strict";
import { explorerNodes } from "./graphify/explorer.ts";
import type { GraphNode } from "./graphify/schema.ts";

const nodes: GraphNode[] = ["document", "query", "chunk", "term"].map((kind, index) => ({
  id: String(index), label: kind === "query" ? "Why retry?" : "Queue", kind: kind as GraphNode["kind"],
  source_file: "src/worker.ts", source_location: "L42", file_type: "code", community: 1,
}));
test("memory views keep saved questions and vectors distinct from sources", () => {
  for (const [view, expected] of [["sources", "document"], ["questions", "query"], ["vectors", "chunk"]] as const) {
    assert.deepEqual(explorerNodes(nodes, view, "").map(node => node.kind), [expected]);
  }
  assert.equal(explorerNodes(nodes, "all", "").length, 4);
});
test("search uses source provenance and respects the selected memory view", () => {
  assert.equal(explorerNodes(nodes, "vectors", " WORKER.TS ")[0].kind, "chunk");
  assert.equal(explorerNodes(nodes, "all", "L42").length, 4);
  assert.equal(explorerNodes(nodes, "sources", "Why retry?").length, 0);
  assert.deepEqual(explorerNodes([], "all", ""), []);
});
