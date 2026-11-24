import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import type { QueryEvent } from "./query.server";

// Exercise actual retrieval and the no-provider response, not only the gate.
// All source/cache state is private to this test process.

test("section heading relevance through the no-provider query path", async (t) => {
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
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), "intellirag-graph-repro-"));
  const graphPath = path.join(graphDir, "graph.json");
  const paths = new Set([
    "/tmp/intellirag-memory.json",
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
    fs.rmSync(graphDir, { recursive: true, force: true });
    globals.__intelliragMemory = previous.memory;
    globals.__intelliragGraph = previous.graph;
    globals.__intelliragSuggestions = previous.suggestions;
    readSpy.mock.restore();
    writeSpy.mock.restore();
    syncBuiltinESMExports();
  });
  process.env = { VERCEL: "1", INTELLIRAG_GRAPH_PATH: graphPath };
  globals.__intelliragMemory = { documents: [], chunks: [], traces: [] };
  globals.__intelliragSuggestions = { rows: [] };
  delete globals.__intelliragGraph;
  const { ensureSeedDocuments } = await import("./store.server");
  const { runQueryStream } = await import("./query.server");
  await ensureSeedDocuments();

  const ask = async (question: string) => {
    const events: QueryEvent[] = [];
    await runQueryStream({ question, skipCache: true }, (e) => events.push(e));
    const done = events.find((e) => e.type === "done") as
      | (QueryEvent & { type: "done" })
      | undefined;
    assert.ok(done, `no done event for: ${question}`);
    
    return done;
  };

  await t.test("exact question keeps the matching section and first remedy in the visible excerpt", async () => {
    const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network"); });
    try {
      const done = await ask("How do you stop a Redis cache stampede?");
      assert.equal(done.refused, false);
      const excerpt = done.answer.split("\n\n---\nFull passages, verbatim:")[0]!;
      for (const remedy of ["When a hot key expires", "Probabilistic early refresh"]) assert.ok(excerpt.includes(remedy), remedy);
      assert.equal(network.mock.callCount(), 0);
    } finally { network.mock.restore(); }
  });
  await t.test("paraphrases retain retrieval without claiming semantic resolution", async () => {
    const done = await ask("How can I avoid a thundering herd?");
    assert.equal(done.refused, false);
    assert.equal(done.answerKind, "source_excerpts");
    assert.ok(done.citations.some(c => /cache stampede/i.test(c.title)));
  });
});
