import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyVectorMemory,
  learnVectors,
  lookupVectors,
  dijkstra,
  semanticCost,
  validateVectorRows,
} from "./graphify/vector";
import { graphFirstRetrieve } from "./graph-first";
import { retrieveFromRows, type SearchRow } from "./retrieve-core";
const storage = { backend: "pglite" as const, durable: true, denseAvailable: true, warning: null };
const scope = { kind: "corpus" as const, corpusId: "test" };
export function row(id: string, text: string, vector = [1, 0], corpusId = "test"): SearchRow {
  return {
    title: "Queue guide",
    slug: id,
    corpusId,
    indexedAt: null,
    chunk: {
      id,
      document_id: id,
      ordinal: 0,
      text,
      token_count: 30,
      heading: null,
      embedding: JSON.stringify(vector),
      embedding_model: "test-model",
      content_hash: text,
      created_at: "",
      filepath: null,
      language: null,
      symbol: null,
      chunk_kind: "prose",
      corpus_id: corpusId,
    },
  };
}
const query = "How do queue tasks handle timeout execution?";
const good = row(
  "timeout",
  "Queue tasks timeout starts when execution begins, not while waiting in the queue.",
);
const options = {
  query,
  queryVector: [1, 0],
  embeddingModel: "test-model",
  mode: "hybrid" as const,
  topK: 5,
  storage,
  scope,
};
const full = (rows: SearchRow[]) => retrieveFromRows({ ...options, rows, corpusScope: scope });
test("weighted Dijkstra chooses cheaper multihop path over expensive direct edge", () => {
  const paths = dijkstra(
    new Set(["a", "b", "c"]),
    [
      { source: "a", target: "c", cost: 0.4, similarity: 0.6 },
      { source: "a", target: "b", cost: 0.1, similarity: 0.9 },
      { source: "b", target: "c", cost: 0.1, similarity: 0.9 },
    ],
    new Map([["a", 0]]),
  );
  assert.deepEqual(paths.find((p) => p.id === "c")?.path, ["a", "b", "c"]);
  assert.equal(paths.find((p) => p.id === "c")?.cost, 0.2);
  assert.ok(semanticCost(0.95) < semanticCost(0.8));
  assert.equal(
    dijkstra(
      new Set(["a", "b"]),
      [{ source: "a", target: "b", cost: -1, similarity: 1 }],
      new Map([["a", 0]]),
    ).length,
    1,
  );
});
test("learning stores qualified chunk vectors, not answer embeddings; edges have actual cosine costs", () => {
  const memory = learnVectors(
    emptyVectorMemory(),
    [good, row("other", "Other queue tasks execution timeout details.", [0.96, 0.28])],
    "test-model",
    2,
  );
  assert.equal(memory.nodes.length, 2);
  assert.equal(memory.edges.length, 1);
  assert.ok(Math.abs(memory.edges[0].cost - semanticCost(memory.edges[0].similarity)) < 1e-12);
  assert.equal(lookupVectors(memory, [1, 0], "wrong-model", "test").paths.length, 0);
  assert.equal(lookupVectors(memory, [1, 0, 0], "test-model", "test").paths.length, 0);
  assert.equal(lookupVectors(memory, [1, 0], "test-model", "other").paths.length, 0);
  assert.equal(lookupVectors(memory, [0, 1], "test-model", "test").paths.length, 0);
  assert.equal(lookupVectors(memory, [NaN, 0], "test-model", "test").paths.length, 0);
});
test("reference validation rejects content, vector, model, scope and missing chunk changes", () => {
  const memory = learnVectors(emptyVectorMemory(), [good], "test-model", 2);
  assert.equal(validateVectorRows(memory.nodes, [good]), true);
  for (const patch of [
    { content_hash: "changed" },
    { embedding: "[0,1]" },
    { embedding_model: "new" },
  ]) {
    assert.equal(
      validateVectorRows(memory.nodes, [{ ...good, chunk: { ...good.chunk, ...patch } }]),
      false,
    );
  }
  assert.equal(validateVectorRows(memory.nodes, [{ ...good, corpusId: "wrong" }]), false);
  assert.equal(validateVectorRows(memory.nodes, []), false);
});
test("graph hit fetches only candidate IDs; never invokes full loader", async () => {
  const memory = learnVectors(emptyVectorMemory(), [good], "test-model", 2);
  let fullCalls = 0;
  let ids: string[] = [];
  const routed = await graphFirstRetrieve(options, {
    lookup: async (v, m, c) => {
      const lookup = lookupVectors(memory, v, m, c);
      return { lookup, nodes: memory.nodes };
    },
    fetch: async (x) => {
      ids = x;
      return [good];
    },
    full: async () => {
      fullCalls++;
      return full([good]);
    },
  });
  assert.equal(routed.vectorTrace.route, "graph");
  assert.equal(fullCalls, 0);
  assert.deepEqual(ids, ["timeout"]);
  assert.equal(routed.result.chunks[0].chunkId, good.chunk.id);
  assert.equal(routed.result.chunks[0].text, good.chunk.text);
});
test("related question receives fresh retrieval, not reuse of an answer; new unsupported terms fall back", async () => {
  const memory = learnVectors(emptyVectorMemory(), [good], "test-model", 2);
  let fullCalls = 0;
  const deps = {
    lookup: async (v: number[], m: string, c: string) => ({
      lookup: lookupVectors(memory, v, m, c),
      nodes: memory.nodes,
    }),
    fetch: async () => [good],
    full: async () => {
      fullCalls++;
      return full([good]);
    },
  };
  const related = await graphFirstRetrieve(
    { ...options, query: "When do queue tasks start timeout execution?" },
    deps,
  );
  assert.equal(related.vectorTrace.route, "graph");
  assert.equal("answer" in related, false);
  const unsupported = await graphFirstRetrieve(
    { ...options, query: "What is the production database administrator password?" },
    deps,
  );
  assert.equal(unsupported.vectorTrace.route, "full");
  assert.equal(fullCalls, 1);
  assert.equal(unsupported.vectorTrace.reason, "weak-graph-evidence-or-query-coverage");
  // That fallback fixture deliberately has a misleading perfect synthetic vector. Its legacy gate is positive.
  assert.equal(unsupported.result.evidence, "positive");
});
test("stale candidates, weak vectors and keyword mode use normal retrieval", async () => {
  const memory = learnVectors(emptyVectorMemory(), [good], "test-model", 2);
  let calls = 0;
  const deps = {
    lookup: async (v: number[], m: string, c: string) => ({
      lookup: lookupVectors(memory, v, m, c),
      nodes: memory.nodes,
    }),
    fetch: async () => [],
    full: async () => {
      calls++;
      return full([good]);
    },
  };
  for (const patch of [{}, { queryVector: [0, 1] }, { mode: "keyword" as const }]) {
    const routed = await graphFirstRetrieve({ ...options, ...patch }, deps);
    assert.equal(routed.vectorTrace.route, "full");
  }
  assert.equal(calls, 3);
});
test("bounded memory and cross-corpus edges cannot contaminate graph", () => {
  const rows = Array.from({ length: 270 }, (_, i) =>
    row(String(i), "Queue timeout", i % 2 ? [1, 0] : [0.99, 0.1], i % 2 ? "a" : "b"),
  );
  const memory = learnVectors(emptyVectorMemory(), rows, "test-model", 2);
  assert.equal(memory.nodes.length, 256);
  const byId = new Map(memory.nodes.map((n) => [n.id, n]));
  assert.ok(
    memory.edges.every((e) => byId.get(e.source)?.corpusId === byId.get(e.target)?.corpusId),
  );
  assert.ok(
    lookupVectors(memory, [1, 0], "test-model", "a").paths.every(
      (p) => byId.get(p.id)?.corpusId === "a",
    ),
  );
});

test("graph I/O errors degrade to full retrieval, not a failed answer", async () => {
  let calls = 0;
  const result = await graphFirstRetrieve(options, {
    lookup: async () => {
      throw new Error("store unavailable");
    },
    fetch: async () => [],
    full: async () => {
      calls++;
      return full([good]);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.vectorTrace.reason, "graph-lookup-or-fetch-error");
});
test("path costs genuinely change candidate ordering", () => {
  const a = row("a", good.chunk.text),
    b = row("b", good.chunk.text);
  const x = retrieveFromRows({
    ...options,
    rows: [a, b],
    corpusScope: scope,
    graphPathCosts: new Map([
      ["a", 0.4],
      ["b", 0.05],
    ]),
  });
  assert.equal(x.candidates[0].chunkId, "b");
  const y = retrieveFromRows({
    ...options,
    rows: [a, b],
    corpusScope: scope,
    graphPathCosts: new Map([
      ["a", 0.05],
      ["b", 0.4],
    ]),
  });
  assert.equal(y.candidates[0].chunkId, "a");
});
test("cross-source/comparison requests fall back even with strong local support", async () => {
  const memory = learnVectors(emptyVectorMemory(), [good], "test-model", 2);
  let calls = 0;
  const result = await graphFirstRetrieve(
    { ...options, query: "Compare queue tasks timeout execution across all sources" },
    {
      lookup: async (v, m, c) => ({ lookup: lookupVectors(memory, v, m, c), nodes: memory.nodes }),
      fetch: async () => [good],
      full: async () => {
        calls++;
        return full([good]);
      },
    },
  );
  assert.equal(result.vectorTrace.route, "full");
  assert.equal(calls, 1);
});
test("unchanged learned vectors do not rebuild or repersist the graph", () => {
  const memory = learnVectors(emptyVectorMemory(), [good], "test-model", 2);
  assert.equal(learnVectors(memory, [good], "test-model", 2), memory);
});
