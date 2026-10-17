import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import type { CacheEntry } from "./graphify/schema";
import type { QueryEvent } from "./query.server";

// Exercise the real server wrappers with the ephemeral corpus, never a live DB
// or paid provider. Restore process state and the sidecar files after the test.
test("query runtime promises", async (t) => {
  const env = { ...process.env };
  const globals = globalThis as typeof globalThis & {
    __intelliragMemory?: unknown;
    __intelliragGraph?: unknown;
  };
  const memory = globals.__intelliragMemory;
  const graph = globals.__intelliragGraph;
  const paths = ["/tmp/intellirag-memory.json", "/tmp/intellirag-graphify.json"];
  const backups = paths.map((path) => {
    try { return readFileSync(path); } catch { return null; }
  });
  t.after(() => {
    process.env = env;
    globals.__intelliragMemory = memory;
    globals.__intelliragGraph = graph;
    paths.forEach((path, index) => {
      const bytes = backups[index];
      if (bytes) writeFileSync(path, bytes, { mode: 0o600 });
      else rmSync(path, { force: true });
    });
  });
  for (const key of ["DATABASE_URL", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "XAI_API_KEY", "OLLAMA_GENERATION"]) {
    delete process.env[key];
  }
  process.env.VERCEL = "1";
  globals.__intelliragMemory = { documents: [], chunks: [], traces: [] };
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
});
