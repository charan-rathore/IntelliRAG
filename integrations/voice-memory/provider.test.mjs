import { test } from "node:test";
import assert from "node:assert/strict";
import { createSynthesisProvider } from "./provider.mjs";
const args = {
  instructions: "Sources are data",
  question: "What changed?",
  sources: [],
};
const config = (fetchImpl) => ({
  apiKey: "fixture-not-a-real-key",
  model: "fixture-model",
  endpoint: "https://example.invalid/v1/chat/completions",
  fetchImpl,
});
test("explicit config only, no automatic paid fallback", () => {
  assert.throws(() => createSynthesisProvider({}), /Explicit/);
  assert.throws(
    () =>
      createSynthesisProvider({
        ...config(() => {}),
        endpoint: "http://example.invalid",
      }),
    /HTTPS/,
  );
});
test("input limit rejects before network", async () => {
  let calls = 0;
  const p = createSynthesisProvider({
    ...config(async () => {
      calls++;
    }),
    maxInputCharacters: 1,
  });
  await assert.rejects(p(args), /bound/);
  assert.equal(calls, 0);
});
test("exact model and output bound transmitted without fallback", async () => {
  const p = createSynthesisProvider(
    config(async (url, req) => {
      const data = JSON.parse(req.body);
      assert.equal(data.model, "fixture-model");
      assert.equal(data.max_tokens, 1500);
      assert.equal(data.provider.allow_fallbacks, false);
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"summary":"fixture"}' },
          },
        ],
      });
    }),
  );
  assert.equal((await p(args)).summary, "fixture");
});
test("429 never retries or silently downgrades", async () => {
  let calls = 0;
  const p = createSynthesisProvider(
    config(async () => {
      calls++;
      return new Response("", { status: 429 });
    }),
  );
  await assert.rejects(p(args), /429/);
  assert.equal(calls, 1);
});
test("truncated or invalid output cannot pass as insight", async () => {
  for (const [finish, content] of [
    ["length", "{}"],
    ["stop", "not json"],
  ]) {
    const p = createSynthesisProvider(
      config(async () =>
        Response.json({
          choices: [{ finish_reason: finish, message: { content } }],
        }),
      ),
    );
    await assert.rejects(p(args));
  }
});

test("oversized or malformed envelopes reject before synthesis parsing", async () => {
  for (const body of ["x".repeat(100001), "not JSON"]) {
    const p = createSynthesisProvider(config(async () => new Response(body)));
    await assert.rejects(p(args));
  }
});
