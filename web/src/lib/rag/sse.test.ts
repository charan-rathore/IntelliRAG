import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuerySseStream } from "./sse.server";
import type { QueryEvent } from "./query.server";

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value, { stream: true });
  }
}

test("completed run streams every event and closes cleanly", async () => {
  const events: QueryEvent[] = [
    { type: "token", text: "hel" } as QueryEvent,
    { type: "token", text: "lo" } as QueryEvent,
  ];
  const stream = createQuerySseStream(async (send) => {
    for (const e of events) send(e);
  });
  const text = await drain(stream);
  assert.equal(text, 'event: token\ndata: {"type":"token","text":"hel"}\n\nevent: token\ndata: {"type":"token","text":"lo"}\n\n');
});

test("client cancel aborts the run and later sends are dropped", async () => {
  let sawAbort = false;
  let sendsAfterAbort = 0;
  const stream = createQuerySseStream(async (send, signal) => {
    send({ type: "token", text: "first" } as QueryEvent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    sawAbort = signal.aborted;
    for (let i = 0; i < 5; i += 1) {
      send({ type: "token", text: `late-${i}` } as QueryEvent);
      sendsAfterAbort += 1;
    }
  });
  const reader = stream.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  await reader.cancel("client gone");
  // Give the run a chance to finish; nothing may throw and no late event may surface.
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(sawAbort, true, "run must observe the abort signal after cancel");
  assert.equal(sendsAfterAbort, 5, "run keeps calling send; the stream drops them");
});

test("an already-aborted request signal reaches the run immediately", async () => {
  const requestAbort = new AbortController();
  requestAbort.abort();
  let sawAbort = false;
  const stream = createQuerySseStream(async (_send, signal) => {
    sawAbort = signal.aborted;
  }, requestAbort.signal);
  await drain(stream);
  assert.equal(sawAbort, true);
});

test("request abort mid-run closes the stream without an error frame", async () => {
  const requestAbort = new AbortController();
  const stream = createQuerySseStream(async (send, signal) => {
    send({ type: "token", text: "before" } as QueryEvent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (signal.aborted) return;
    send({ type: "token", text: "after" } as QueryEvent);
  }, requestAbort.signal);
  const reader = stream.getReader();
  await reader.read();
  requestAbort.abort();
  let rest = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
  }
  assert.equal(rest.includes("after"), false);
});
