import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryEvent } from "./query.server";

test("a trace write outage does not interrupt an extractive result", async (t) => {
  const previousEnv = process.env;
  process.env = { PATH: previousEnv.PATH, HOME: previousEnv.HOME };
  t.after(() => { process.env = previousEnv; });

  const { getSql } = await import("../db");
  const { upsertDocument } = await import("./store.server");
  const { runQueryStream } = await import("./query.server");
  const imported = await upsertDocument({
    title: "Amber relay service manual",
    body: "Amber relay reset requires supervisor approval. The technician records approval in the maintenance log before resuming operation.",
    sourceType: "markdown",
    corpusId: "trace-outage-fixture",
  });

  const sql = await getSql();
  await sql`alter table query_traces rename to unavailable_query_traces`;
  const warnings = t.mock.method(console, "warn", () => {});
  const input = {
    question: "What does the Amber relay reset require?",
    corpus: imported.corpusId,
    retrievalMode: "keyword" as const,
    skipCache: true,
  };
  const events: QueryEvent[] = [];
  await runQueryStream(input, (event) => events.push(event));

  const done = events.find((event) => event.type === "done");
  assert.ok(done?.type === "done");
  assert.equal(done.model, "extractive");
  assert.ok(done.answer.includes("requires supervisor approval"));
  assert.ok(done.citations.length > 0);
  assert.equal(warnings.mock.callCount(), 1);

  const controller = new AbortController();
  warnings.mock.mockImplementation(() => controller.abort());
  const cancelledEvents: QueryEvent[] = [];
  await assert.rejects(
    runQueryStream(input, (event) => cancelledEvents.push(event), controller.signal),
    { name: "AbortError" },
  );
  assert.equal(cancelledEvents.some((event) => event.type === "done"), false);
});
