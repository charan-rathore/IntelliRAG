import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCompletion, validateCompletion, readGenerationStream, GenerationError } from "./generation-result";
const stream = (parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { parts.forEach(p => c.enqueue(new TextEncoder().encode(p))); c.close(); } });
const event = (x: unknown) => `data: ${JSON.stringify(x)}\n\n`;
for (const [stop, reason] of [["length", "output_budget_exhausted"], ["MAX_TOKENS", "output_budget_exhausted"], ["content_filter", "content_filtered"], ["SAFETY", "content_filtered"], ["tool_calls", "unexpected_stop"]]) {
  test(`classifies ${stop} and keeps billed usage`, () => {
    const usage = { total_tokens: 1536 };
    assert.throws(() => validateCompletion({ text: "partial", stopReason: stop, usage }), e => e instanceof GenerationError && e.reason === reason && e.usage === usage);
  });
}
test("empty budget stop is not a network error", () => { assert.throws(() => validateCompletion({ text: "", stopReason: "length" }), e => e instanceof GenerationError && e.reason === "output_budget_exhausted"); });
test("normal stop requires nonempty output", () => { assert.equal(validateCompletion({ text: " answer ", stopReason: "STOP" }), "answer"); assert.throws(() => validateCompletion({ text: "", stopReason: "stop" }), e => e instanceof GenerationError && e.reason === "empty_output"); });
test("provider decoders keep their own wire shapes", () => {
  assert.equal(validateCompletion(decodeCompletion({ candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "answer" }] }, finishReason: "STOP" }] }, "google")), "answer");
  assert.equal(validateCompletion(decodeCompletion({ choices: [{ message: { content: "answer" }, finish_reason: "stop" }] }, "openai")), "answer");
});
test("SSE handles split events, CRLF, usage after stop and final event without blank line", async () => {
  const text = (event({ choices: [{ delta: { content: "answer" } }] }) + event({ choices: [{ finish_reason: "stop" }] })).replace(/\n/g,"\r\n");
  assert.equal(await readGenerationStream(stream([text.slice(0,10),text.slice(10), 'data: {"usage":{"total_tokens":8}}']), "openai", () => {}), "answer");
});
test("partial length output fails despite DONE and retains final usage", async () => {
  const data = event({ choices: [{ delta: { content: "partial" }, finish_reason: "length" }] }) + event({ usage: { total_tokens: 1536 } }) + 'data: [DONE]\n\n';
  await assert.rejects(readGenerationStream(stream([data]),"openai",()=>{}), e => e instanceof GenerationError && e.reason === "output_budget_exhausted" && e.usage?.total_tokens === 1536);
});
test("EOF and DONE without terminal reason are incomplete", async () => {
  for (const tail of ["", "data: [DONE]\n\n"]) await assert.rejects(readGenerationStream(stream([event({ choices: [{ delta: { content: "partial" } }] })+tail]),"openai",()=>{}), e => e instanceof GenerationError && e.reason === "incomplete_stream");
});
test("malformed event is not silently treated as keepalive", async () => { await assert.rejects(readGenerationStream(stream(["data: {broken}\n\n"]),"openai",()=>{}),e => e instanceof GenerationError && e.reason === "invalid_response"); });
test("blocked Google prompt is distinct", () => { assert.throws(() => decodeCompletion({ promptFeedback: { blockReason: "SAFETY" } },"google"),e => e instanceof GenerationError && e.reason === "content_filtered"); });
test("interrupted transport is incomplete and keeps already reported usage", async () => {
  let calls = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { if (!calls++) c.enqueue(new TextEncoder().encode(event({ usage: { total_tokens: 9 } }))); else c.error(new Error("socket closed")); } });
  await assert.rejects(readGenerationStream(body,"openai",()=>{}),e => e instanceof GenerationError && e.reason === "incomplete_stream" && e.usage?.total_tokens === 9);
});
test("abort stays an abort rather than becoming a successful completion", async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.error(new DOMException("cancelled","AbortError")); } });
  await assert.rejects(readGenerationStream(body,"openai",()=>{}),e => e instanceof Error && e.name === "AbortError");
});
