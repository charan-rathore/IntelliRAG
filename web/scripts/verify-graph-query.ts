import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  upsertDocument,
  loadSearchableChunks,
  saveChunkEmbeddings,
} from "../src/lib/rag/store.server";
import { runQueryStream, type QueryEvent } from "../src/lib/rag/query.server";
import { EMBEDDING_MODEL } from "../src/lib/rag/types";
// Synthetic provider responses, no real API key/call. Covers actual runQueryStream and persisted vectors.
process.env.OPENROUTER_API_KEY = "synthetic-local-test";
const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const corpus = "query-integration";
await upsertDocument({
  title: "Queue timeout guide",
  body: "Queue tasks timeout starts at execution, not while waiting in the queue.",
  sourceType: "markdown",
  slugHint: "query-vector-test",
  corpusId: corpus,
});
const rows = await loadSearchableChunks({ kind: "corpus", corpusId: corpus });
await saveChunkEmbeddings(
  rows.map((r) => ({ id: r.chunk.id, embedding: vector, model: EMBEDDING_MODEL })),
);
const original = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  providerCalls++;
  if (url.includes("/embeddings"))
    return new Response(JSON.stringify({ data: [{ embedding: vector }] }), { status: 200 });
  if (url.includes("/chat/completions")) {
    const events = [
      { choices: [{ delta: { content: "Queue tasks timeout starts at execution [Source 1]." } }] },
      { choices: [{ delta: {} }] },
    ];
    return new Response(
      events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }
  return original(input, init);
};
const runs: QueryEvent[][] = [];
for (const question of [
  "When do queue tasks start timeout execution?",
  "When do queue tasks start timeout execution?",
  "When does queue timeout execution start?",
]) {
  const events: QueryEvent[] = [];
  await runQueryStream(
    { question, corpus, retrievalMode: "hybrid", topK: 5, skipCache: true },
    (e) => events.push(e),
  );
  runs.push(events);
}
globalThis.fetch = original;
delete process.env.OPENROUTER_API_KEY;
assert.ok(runs.every((es) => es.some((e) => e.type === "done")));
const traces = runs.map((es) =>
  es.find((e) => e.type === "graph" && e.vector)?.type === "graph"
    ? es.filter((e) => e.type === "graph").at(-1)
    : null,
);
assert.equal(traces[0]?.type === "graph" && traces[0].vector?.route, "full");
assert.equal(traces[1]?.type === "graph" && traces[1].vector?.route, "graph");
assert.equal(traces[2]?.type === "graph" && traces[2].vector?.route, "graph");
assert.ok(runs.every((es) => !es.some((e) => e.type === "stage" && e.name === "graph-cache")));
writeFileSync(
  "docs/graph-first/query-integration.json",
  JSON.stringify(
    {
      scope:
        "Actual local runQueryStream, SQL persistence, synthetic 768-dimension embeddings and synthetic streaming generator. Answer cache bypassed. Not real-provider correctness or timing.",
      passed: true,
      providerCalls,
      runs,
    },
    null,
    2,
  ),
);
console.log(
  "Actual query path: cold full fallback, repeat graph hit, related graph hit; fresh streaming answers in all cases.",
);
process.exit(0);
