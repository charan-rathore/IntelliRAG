import { readFileSync, writeFileSync } from "node:fs";
import { graphFirstRetrieve } from "../src/lib/rag/graph-first";
import { learnVectors, emptyVectorMemory, lookupVectors } from "../src/lib/rag/graphify/vector";
import { retrieveFromRows, type SearchRow } from "../src/lib/rag/retrieve-core";
import { GROUNDED_SYSTEM, INSUFFICIENT_ANSWER } from "../src/lib/rag/evidence";
const root = "docs/graph-first/";
const data = JSON.parse(readFileSync(root + "provider-vectors.json", "utf8"));
const rows: SearchRow[] = data.texts.map((text: string, i: number) => ({
  title: ["Timeout guide", "Queue pause guide", "Abort cleanup guide"][i],
  slug: `provider-${i}`,
  corpusId: "provider-test",
  indexedAt: null,
  chunk: {
    id: `chunk-${i}`,
    document_id: `doc-${i}`,
    ordinal: 0,
    text,
    token_count: 50,
    heading: null,
    embedding: JSON.stringify(data.vectors[i]),
    embedding_model: data.model,
    content_hash: text,
    created_at: "",
    filepath: null,
    language: null,
    symbol: null,
    chunk_kind: "prose",
    corpus_id: "provider-test",
  },
}));
const byId = new Map(rows.map((r) => [r.chunk.id, r]));
const scope = { kind: "corpus" as const, corpusId: "provider-test" };
const storage = { backend: "pglite" as const, durable: true, denseAvailable: true, warning: null };
let memory = emptyVectorMemory();
const cases = [];
let fullCalls = 0;
for (const q of data.queries) {
  const opts = {
    query: q.question,
    queryVector: q.vector,
    embeddingModel: data.model,
    mode: "hybrid" as const,
    topK: 3,
    storage,
    scope,
  };
  let start = performance.now();
  const full = retrieveFromRows({ ...opts, rows, corpusScope: scope });
  const fullMs = performance.now() - start;
  const graph = await graphFirstRetrieve(opts, {
    lookup: async (v, m, c) => {
      const lookup = lookupVectors(memory, v, m, c);
      const selected = new Set(lookup.paths.map((p) => p.id));
      return { lookup, nodes: memory.nodes.filter((n) => selected.has(n.id)), edges: memory.edges };
    },
    fetch: async (ids) => ids.map((id) => byId.get(id)!).filter(Boolean),
    full: async () => {
      fullCalls++;
      return retrieveFromRows({ ...opts, rows, corpusScope: scope });
    },
  });
  cases.push({
    id: q.id,
    question: q.question,
    graph: {
      trace: graph.vectorTrace,
      evidence: graph.result.evidence,
      contexts: graph.result.chunks,
    },
    full: { ms: fullMs, evidence: full.evidence, contexts: full.chunks },
    citation_text_equal: graph.result.chunks.every(
      (c) => byId.get(c.chunkId)?.chunk.text === c.text,
    ),
  });
  if (graph.result.evidence === "positive")
    memory = learnVectors(
      memory,
      graph.result.chunks.map((c) => byId.get(c.chunkId)!),
      data.model,
      q.vector.length,
    );
}
writeFileSync(
  root + "provider-retrieval.json",
  JSON.stringify(
    {
      scope:
        "Real provider embeddings, actual retrieval functions; tiny 3-chunk corpus, local CPU, no SQL/server/embedding latency comparison. Sequential learning; exact answer cache bypassed.",
      cases,
      learned_nodes: memory.nodes,
      edges: memory.edges,
      full_calls: fullCalls,
    },
    null,
    2,
  ),
);
writeFileSync(
  root + "provider-prompts.json",
  JSON.stringify({ GROUNDED_SYSTEM, INSUFFICIENT_ANSWER }),
);
