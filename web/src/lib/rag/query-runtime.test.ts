import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import type { CacheEntry } from "./graphify/schema";
import type { QueryEvent } from "./query.server";

// Exercise real server wrappers with a private in-memory sidecar store.
// Other test workers and developer sidecars are never read or overwritten.
test("query runtime promises", async (t) => {
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
  // An allowlist prevents ambient provider credentials and optional flags
  // from changing this no-provider scenario.
  process.env = { VERCEL: "1" };
  globals.__intelliragMemory = { documents: [], chunks: [], traces: [] };
  globals.__intelliragSuggestions = { rows: [] };
  delete globals.__intelliragGraph;
  const { ensureSeedDocuments } = await import("./store.server");
  const { ensureGraph, findCachedAnswer } = await import("./graphify/persist.server");
  const { resolveRuntime } = await import("./keys.server");
  const { runQueryStream } = await import("./query.server");
  const { extractiveAnswer } = await import("./extractive");
  await ensureSeedDocuments();

  await t.test("skipCache bypasses a matching hit without deleting it", async () => {
    const state = await ensureGraph();
    const entry: CacheEntry = {
      question: "Retry 7 times?", questionHash: "retry-seven", answer: "Seven",
      policy: "keyword-5", corpusId: "seed-lab", outcome: null,
      sourceSlugs: [], sourceNodes: [], coverage: "grounded", citations: [],
      candidates: [], chunks: [], contextTokens: 0, hitCount: 0,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    };
    state.cache = [entry];
    const options = { policy: entry.policy };
    assert.equal((await findCachedAnswer(entry.question, "seed-lab", options)).hit, entry);
    assert.equal((await findCachedAnswer(entry.question, "seed-lab", { ...options, skipCache: true })).hit, null);
    assert.equal((await findCachedAnswer(entry.question, "seed-lab", options)).hit, entry);
    state.cache = [];
  });

  await t.test("runQueryStream forwards bypass while preserving a matching runtime cache entry", async () => {
    const input = { question: "What caused the Kubernetes pod scheduling failures?", retrievalMode: "keyword" as const };
    const run = async (skipCache: boolean) => {
      const events: QueryEvent[] = [];
      await runQueryStream({ ...input, skipCache }, (event) => events.push(event));
      const done = events.find((event) => event.type === "done");
      assert.ok(done?.type === "done");
      return { done, events };
    };
    const initial = await run(false);
    assert.equal(initial.done.model, "extractive");
    const state = await ensureGraph();
    const entry = state.cache.find((entry) => entry.question === input.question);
    assert.ok(entry, "a real fresh query populates the runtime policy/corpus cache");
    entry.answer = "Cached answer sentinel";
    const cached = await run(false);
    assert.equal(cached.done.cacheHit, true);
    assert.equal(cached.done.answer, entry.answer);
    const bypassed = await run(true);
    assert.equal(bypassed.done.cacheHit, false);
    assert.equal(bypassed.done.model, "extractive");
    assert.equal(bypassed.done.answer, initial.done.answer);
    assert.ok(bypassed.events.some((event) => event.type === "graph" && event.cache === "bypass"));
    const cachedAgain = await run(false);
    assert.equal(cachedAgain.done.cacheHit, true);
    assert.equal(cachedAgain.done.answer, entry.answer);
    state.cache = [];
  });

  await t.test("no provider returns a fresh extractive answer without network generation", async () => {
    assert.deepEqual(resolveRuntime(), { embed: null, generate: null });
    // Any accidental provider call is counted and fails without leaving this process.
    const network = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Unexpected network request in no-provider mode");
    });
    try {
      const question = "What caused the Kubernetes pod scheduling failures?";
      const events: QueryEvent[] = [];
      await runQueryStream({ question, skipCache: true, retrievalMode: "keyword" }, (event) => events.push(event));
      const sources = events.find((event) => event.type === "sources");
      const done = events.find((event) => event.type === "done");
      assert.ok(sources?.type === "sources" && sources.chunks.length > 0);
      assert.ok(done?.type === "done");
      assert.equal(done.model, "extractive");
      assert.equal(done.refused, false);
      assert.equal(done.cacheHit, false);
      assert.equal(done.latencies.generate, 0);
      assert.equal(done.answer, extractiveAnswer(question, sources.chunks));
      assert.ok(done.answer.length > 0);
      assert.equal(events.some((event) => event.type === "error"), false);
      assert.equal(events.some((event) => event.type === "stage" && event.name === "generating"), false);
      assert.equal(network.mock.callCount(), 0);
    } finally {
      network.mock.restore();
    }
  });
  await t.test("real no-provider query preserves a short answer and an explicit unknown", async () => {
    const { ingestText } = await import("./ingest.server");
    const fixtures = [
      { title: "Cobalt fixture", body: "# Cobalt fixture\n\nRetry limit: 4.\n\nThe cobalt service supports background uploads and operational telemetry for internal teams.", query: "What is the retry limit?", fact: "Retry limit: 4." },
      { title: "Zircon incident fixture", body: "# Zircon incident fixture\n\nRoot cause unknown.\n\nThe zircon pump stopped on Tuesday during its scheduled operating window and the technician recorded the observation.", query: "What is the root cause?", fact: "Root cause unknown." },
    ];
    const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
    try {
      for (const [index, fixture] of fixtures.entries()) {
        const imported = await ingestText({ title: fixture.title, body: fixture.body, sourceType: "markdown", sourceUri: `fixture://short-evidence/${index}`, slugHint: `short-evidence-${index}` });
        const events: QueryEvent[] = [];
        await runQueryStream({ question: fixture.query, corpus: imported.corpusId, skipCache: true, retrievalMode: "keyword" }, event => events.push(event));
        const done = events.find(event => event.type === "done");
        assert.ok(done?.type === "done", JSON.stringify(events));
        assert.equal(done.model, "extractive");
        assert.ok(done.answer.includes(fixture.fact), done.answer);
        assert.ok(done.answer.includes("[Source 1]"));
        assert.ok(done.answer.includes("not a generated recommendation"));
      }
      assert.equal(network.mock.callCount(), 0);
    } finally { network.mock.restore(); }
  });
  assert.deepEqual([...sidecars.keys()].sort(), [...paths].sort(), "all three sidecars stay in the private store");
});
