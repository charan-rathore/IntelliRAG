// Fixture-level retrieval eval (keyword/BM25 mode, no embeddings, no model).
// Usage: node --experimental-strip-types --import <ts-resolve-hook> pqueue-eval.ts <web/src/lib/rag dir> <fixture.md>
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const [ragDir, fixture] = process.argv.slice(2);
const { chunkDocument } = await import(`${ragDir}/chunking.ts`);
const { retrieveFromRows } = await import(`${ragDir}/retrieve-core.ts`);
const body = readFileSync(fixture!, "utf8");
let t = performance.now();
const chunks = chunkDocument(body);
const chunkMs = performance.now() - t;
const rows = chunks.map((c: any, i: number) => ({
  title: "p-queue", slug: "p-queue", indexedAt: null, corpusId: "c1",
  chunk: { id: `c${i}`, document_id: "d1", corpus_id: "c1", ordinal: i, text: c.text, heading: c.heading, token_count: c.tokenCount, embedding: null, embedding_model: null, filepath: null },
}));
// Each question lists evidence that must ALL appear in top-K (answer-bearing text, not heading labels).
const Q: Array<{ q: string; need: RegExp[] }> = [
  { q: "How do I change concurrency while jobs are queued?", need: [/\.concurrency\]|##### concurrency/] },
  { q: "can i bump how many run at once mid-flight", need: [/\.concurrency\]|##### concurrency/] },
  { q: "How do I configure five runs per second?", need: [/max number of runs in the given interval/, /interval count resets/] },
  { q: "What is the difference between onEmpty and onIdle?", need: [/becomes empty\.\n\nCan be called multiple times/, /onIdle` guarantees that all work/] },
  { q: "onIdle vs onPendingZero", need: [/onIdle` guarantees that all work/, /only waits for currently running tasks/] },
  { q: "How do I know when the queue is rate limited?", need: [/isRateLimited|onRateLimit\(\)/] },
  { q: "How do I add tasks and wait for them all to finish?", need: [/onIdle/] },
];
const K = 5;
let covered = 0, qMs = 0;
for (const { q, need } of Q) {
  t = performance.now();
  const r = retrieveFromRows({ query: q, queryVector: null, mode: "keyword", topK: K, embeddingModel: null, rows, storage: { backend: "ephemeral", durable: false, denseAvailable: false, warning: null }, corpusScope: { kind: "corpus", corpusId: "c1" } });
  qMs += performance.now() - t;
  const hits = (r.chunks ?? r.results ?? []) as any[];
  const ok = need.map((re) => hits.some((h) => re.test(h.text)));
  if (ok.every(Boolean)) covered++;
  console.log(`${ok.every(Boolean) ? "PASS" : "MISS"} [${ok.map((x) => (x ? 1 : 0)).join("")}] ${q}\n   top: ${hits.slice(0, 3).map((h) => h.heading).join(" | ")}`);
}
const indexChars = rows.reduce((a: number, r: any) => a + r.chunk.text.length + (r.chunk.heading ?? "").length, 0);
console.log(JSON.stringify({ coverage: `${covered}/${Q.length}`, chunks: chunks.length, indexChars, chunkMs: +chunkMs.toFixed(1), avgQueryMs: +(qMs / Q.length).toFixed(1) }));
