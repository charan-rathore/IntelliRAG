import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  upsertDocument,
  replaceChunks,
  loadSearchableChunks,
  saveChunkEmbeddings,
  loadChunksByIds,
} from "../src/lib/rag/store.server";
import {
  ensureGraph,
  rememberRetrievedVectors,
  vectorGraphLookup,
  graphSnapshot,
} from "../src/lib/rag/graphify/persist.server";
import { graphFirstRetrieve } from "../src/lib/rag/graph-first";
import { retrieveFromRows } from "../src/lib/rag/retrieve-core";
import { getStorageStatus } from "../src/lib/rag/storage";
const corpus = "integration-vector-graph";
const scope = { kind: "corpus" as const, corpusId: corpus };
const model = "test-integration-model";
const input = {
  title: "Queue timeout guide",
  body: "Queue tasks timeout starts at execution, not while waiting in the queue.",
  sourceType: "markdown" as const,
  slugHint: "vector-integration",
  corpusId: corpus,
};
const doc = await upsertDocument(input);
let rows = await loadSearchableChunks(scope);
await saveChunkEmbeddings(rows.map((r) => ({ id: r.chunk.id, embedding: [1, 0], model })));
rows = await loadSearchableChunks(scope);
await rememberRetrievedVectors(
  rows.map((r) => r.chunk.id),
  model,
  2,
  corpus,
);
assert.equal((await vectorGraphLookup([1, 0], model, corpus)).lookup.paths.length, rows.length);
const result = await graphFirstRetrieve(
  {
    query: "When do queue tasks start timeout execution?",
    queryVector: [1, 0],
    embeddingModel: model,
    mode: "hybrid",
    topK: 5,
    storage: getStorageStatus(),
    scope,
  },
  {
    lookup: vectorGraphLookup,
    fetch: loadChunksByIds,
    full: async () => {
      throw new Error("full index should not load on graph hit");
    },
  },
);
assert.equal(result.vectorTrace.route, "graph");
assert.equal(result.result.chunks[0].text, rows[0].chunk.text);
assert.equal(
  (await graphSnapshot()).nodes.some((n) => n.kind === "chunk"),
  true,
);
assert.equal((await vectorGraphLookup([1, 0], "other-model", corpus)).lookup.paths.length, 0);
await upsertDocument({ ...input, body: input.body + " Changed revision." });
assert.equal((await ensureGraph()).vectorMemory?.nodes.length, 0);
assert.equal((await vectorGraphLookup([1, 0], model, corpus)).lookup.paths.length, 0);
const output = {
  passed: true,
  checks: [
    "PGLite candidate-ID SQL fetch",
    "graph hit without full loader",
    "citation text equality",
    "snapshot chunk nodes",
    "model rejection",
    "source-version invalidation",
  ],
  storage: getStorageStatus(),
  graph_route: result.vectorTrace,
};
writeFileSync("docs/graph-first/store-integration.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
process.exit(0);
