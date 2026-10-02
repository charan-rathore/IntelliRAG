import { writeFileSync } from "node:fs";
import { graphFirstRetrieve } from "../src/lib/rag/graph-first";
import { learnVectors, emptyVectorMemory, lookupVectors } from "../src/lib/rag/graphify/vector";
import { retrieveFromRows, type SearchRow } from "../src/lib/rag/retrieve-core";
const dimension = 128;
const vector = (i: number) =>
  Array.from({ length: dimension }, (_, j) => (j === i % dimension ? 1 : 0));
const row = (i: number): SearchRow => ({
  title: i === 0 ? "Queue timeout guide" : `Unrelated topic ${i}`,
  slug: `doc-${i}`,
  corpusId: "benchmark",
  indexedAt: null,
  chunk: {
    id: `chunk-${i}`,
    document_id: `doc-${i}`,
    ordinal: 0,
    text:
      i === 0
        ? "Queue tasks timeout begins when execution starts, not while waiting."
        : `Unrelated subject ${i} discusses colors shapes recipes and objects.`,
    token_count: 30,
    heading: null,
    embedding: JSON.stringify(vector(i)),
    embedding_model: "synthetic-128",
    content_hash: `hash-${i}`,
    created_at: "",
    filepath: null,
    language: null,
    symbol: null,
    chunk_kind: "prose",
    corpus_id: "benchmark",
  },
});
const storage = { backend: "pglite" as const, durable: true, denseAvailable: true, warning: null };
const scope = { kind: "corpus" as const, corpusId: "benchmark" };
const opts = {
  query: "When do queue tasks start timeout execution?",
  queryVector: vector(0),
  embeddingModel: "synthetic-128",
  mode: "hybrid" as const,
  topK: 5,
  storage,
  scope,
};
const stats = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return {
    median_ms: s[Math.floor(s.length / 2)],
    p95_ms: s[Math.floor(s.length * 0.95)],
    n: s.length,
  };
};
const outputs = [];
for (const size of [100, 1000, 5000]) {
  const rows = Array.from({ length: size }, (_, i) => row(i));
  const byId = new Map(rows.map((r) => [r.chunk.id, r]));
  const memory = learnVectors(emptyVectorMemory(), [rows[0]], "synthetic-128", dimension);
  let fullLoads = 0;
  let fetched = 0;
  const deps = {
    lookup: async (v: number[], m: string, c: string) => {
      const lookup = lookupVectors(memory, v, m, c);
      return { lookup, nodes: memory.nodes };
    },
    fetch: async (ids: string[]) => {
      fetched += ids.length;
      return ids.map((id) => byId.get(id)!);
    },
    full: async () => {
      fullLoads++;
      return retrieveFromRows({ ...opts, rows, corpusScope: scope });
    },
  };
  const graph: number[] = [];
  const baseline: number[] = [];
  for (let i = 0; i < 35; i++) {
    let start = performance.now();
    const hit = await graphFirstRetrieve(opts, deps);
    const gt = performance.now() - start;
    if (hit.vectorTrace.route !== "graph") throw new Error("Expected graph hit");
    start = performance.now();
    retrieveFromRows({ ...opts, rows, corpusScope: scope });
    const bt = performance.now() - start;
    if (i >= 5) {
      graph.push(gt);
      baseline.push(bt);
    }
  }
  outputs.push({
    size,
    dimensions: dimension,
    learned_vectors: 1,
    graph: stats(graph),
    full: stats(baseline),
    full_loader_calls: fullLoads,
    candidate_rows_per_call: fetched / 35,
  });
}
const out = {
  scope:
    "Synthetic-vector in-process retrieval CPU benchmark. Includes graph lookup, candidate validation, rerank/gate. Excludes provider, SQL/network, graph persistence and server transport. 5 warmups plus 30 measured iterations each. Not an end-to-end speedup claim.",
  outputs,
};
writeFileSync("docs/graph-first/synthetic-benchmark.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
