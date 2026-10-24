import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuerySseStream } from "./sse.server";
import type { QueryEvent } from "./query.server";

test("request abort promptly closes output while the upstream is still pending", async () => {
  const request = new AbortController();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stream = createQuerySseStream(async (send) => {
    send({ type: "token", text: "before" } as QueryEvent);
    await pending;
    send({ type: "token", text: "late" } as QueryEvent);
  }, request.signal);
  const reader = stream.getReader();
  await reader.read();
  request.abort();
  const result = await Promise.race([
    reader.read(),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 60)),
  ]);
  finish();
  assert.notEqual(
    result,
    "timeout",
    "output waits for stalled upstream instead of closing on abort",
  );
  assert.deepEqual(result, { value: undefined, done: true });
});

test("request abort drops sends even when a runner ignores its signal", async () => {
  const request = new AbortController();
  const stream = createQuerySseStream(async (send) => {
    send({ type: "token", text: "before" } as QueryEvent);
    request.abort();
    send({ type: "token", text: "late" } as QueryEvent);
  }, request.signal);
  const text = await new Response(stream).text();
  assert.equal(text.includes("late"), false);
});

test("an already-aborted request suppresses a noncooperative runner output", async () => {
  const request = new AbortController();
  request.abort();
  const stream = createQuerySseStream(async (send, signal) => {
    assert.equal(signal.aborted, true);
    send({ type: "token", text: "late" } as QueryEvent);
  }, request.signal);
  assert.equal(await new Response(stream).text(), "");
});

test("an abort-related upstream rejection does not emit an error frame", async () => {
  const request = new AbortController();
  const stream = createQuerySseStream(async () => {
    request.abort();
    throw new Error("private provider detail");
  }, request.signal);
  assert.equal(await new Response(stream).text(), "");
});

test("synchronous upstream abort handlers cannot enqueue late output", async () => {
  const request = new AbortController();
  const stream = createQuerySseStream(async (send, signal) => {
    signal.addEventListener("abort", () =>
      send({ type: "token", text: "abort-handler" } as QueryEvent),
    );
    request.abort();
  }, request.signal);
  assert.equal(await new Response(stream).text(), "");
});
