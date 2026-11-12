import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import type { QueryEvent } from "./query.server";

// Simulated serverless cold start: an import answers questions while the
// worker is warm, the worker forgets it, and the next query on that corpus
// must say the source is gone instead of answering from the seed corpus or
// a stale graph entry. Uses a private in-memory sidecar store like
// query-runtime.test.ts so no real developer state is touched.
test("ephemeral storage forgets imports honestly across a simulated cold start", async (t) => {
  const env = process.env;
  const globals = globalThis as typeof globalThis & {
    __intelliragMemory?: unknown;
    __intelliragGraph?: unknown;
    __intelliragSuggestions?: unknown;
  };
  const previous = {
    memory: globals.__intelliragMemory,
    graph: globals.__intelliragGraph,
    suggestions: globals.__intelliragSuggestions,
  };
  const paths = new Set([
    "/tmp/intellirag-memory.json",
    "/tmp/intellirag-graphify.json",
    "/tmp/intellirag-suggested-questions.json",
  ]);
  const sidecars = new Map<string, string>();
  const read = fs.readFileSync;
  const write = fs.writeFileSync;
  const readSpy = t.mock.method(fs, "readFileSync", ((path, ...args) => {
    if (!paths.has(String(path))) return read(path, ...args);
    const value = sidecars.get(String(path));
    if (value === undefined) throw new Error("No test sidecar");
    return value;
  }) as typeof fs.readFileSync);
  const writeSpy = t.mock.method(fs, "writeFileSync", ((path, data, ...args) => {
    if (!paths.has(String(path))) return write(path, data, ...args);
    sidecars.set(String(path), String(data));
  }) as typeof fs.writeFileSync);
  syncBuiltinESMExports();
  t.after(() => {
    process.env = env;
    globals.__intelliragMemory = previous.memory;
    globals.__intelliragGraph = previous.graph;
    globals.__intelliragSuggestions = previous.suggestions;
    readSpy.mock.restore();
    writeSpy.mock.restore();
    syncBuiltinESMExports();
  });
  // Allowlist env: VERCEL forces the ephemeral memory path, no providers.
  process.env = { VERCEL: "1" };
  globals.__intelliragMemory = { documents: [], chunks: [], traces: [] };
  globals.__intelliragSuggestions = { rows: [] };
  delete globals.__intelliragGraph;

  const { ensureSeedDocuments } = await import("./store.server");
  const { ingestText } = await import("./ingest.server");
  const { runQueryStream } = await import("./query.server");
  const { resetMemoryForTests } = await import("./memory.server");
  await ensureSeedDocuments();

  const corpus = "imported:ephemeral-check";
  await ingestText({
    title: "Ephemeral check fixture",
    body: "# Ephemeral check fixture\n\nThe cobalt lease renews every forty days.\n\nOperators record each renewal in the cobalt ledger before noon.",
    sourceType: "markdown",
    slugHint: "ephemeral-check",
    corpusId: corpus,
  } as Parameters<typeof ingestText>[0]);

  const question = "How often does the cobalt lease renew?";
  const warm: QueryEvent[] = [];
  await runQueryStream({ question, corpus, retrievalMode: "keyword", skipCache: true }, (e) => warm.push(e));
  const warmDone = warm.find((e) => e.type === "done");
  assert.ok(warmDone?.type === "done", "warm worker answers the import");
  assert.match(warmDone.answer, /forty days/i);
  assert.equal(warm.some((e) => e.type === "error"), false);

  // Cold start: the worker is recycled; only the bundled seed returns.
  resetMemoryForTests();
  globals.__intelliragMemory = { documents: [], chunks: [], traces: [] };
  delete globals.__intelliragGraph;
  await ensureSeedDocuments();

  const cold: QueryEvent[] = [];
  await runQueryStream({ question, corpus, retrievalMode: "keyword", skipCache: true }, (e) => cold.push(e));
  const coldError = cold.find((e) => e.type === "error");
  assert.ok(coldError?.type === "error", "cold worker reports the forgotten source instead of guessing");
  assert.match(coldError.message, /no longer available/i);
  assert.match(coldError.message, /not evidence that your document lacks the answer/i);
  assert.equal(cold.some((e) => e.type === "done"), false, "no fabricated answer after the loss");
  assert.equal(cold.some((e) => e.type === "sources"), false, "no seed sources passed off as the lost import");
});
