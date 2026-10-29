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

test("invalid budgets fail before network rather than normalize", () => {
  let calls = 0;
  for (const field of [
    "maxInputCharacters",
    "maxOutputTokens",
    "maxResponseBytes",
    "timeoutMs",
  ]) {
    for (const value of [NaN, Infinity, 0, -1, 1.5, "12", 10000001]) {
      assert.throws(
        () =>
          createSynthesisProvider({
            ...config(() => {
              calls++;
            }),
            [field]: value,
          }),
        /integer|range/,
      );
    }
  }
  assert.equal(calls, 0);
});
test("source-bearing requests forbid redirects", async () => {
  const p = createSynthesisProvider(
    config(async (_url, req) => {
      assert.equal(req.redirect, "error");
      return new Response(null, {
        status: 307,
        headers: { location: "http://elsewhere.invalid" },
      });
    }),
  );
  await assert.rejects(p(args), /307/);
});
test("stream byte bound cancels before consuming unbounded body", async () => {
  let canceled = false;
  let pulls = 0;
  const stream = new ReadableStream({
    pull(c) {
      pulls++;
      c.enqueue(new Uint8Array(64));
      if (pulls === 4) c.close();
    },
    cancel() {
      canceled = true;
    },
  });
  const p = createSynthesisProvider({
    ...config(async () => new Response(stream)),
    maxResponseBytes: 32,
  });
  await assert.rejects(p(args), /bound/);
  assert.equal(canceled, true);
  assert.ok(pulls <= 2);
});
test("deadline aborts stalled fetch and stalled response without caller signal", async () => {
  for (const stall of ["fetch", "body"]) {
    let signal;
    const p = createSynthesisProvider({
      ...config(async (_url, req) => {
        signal = req.signal;
        if (stall === "fetch") return new Promise(() => {});
        return new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
          }),
        );
      }),
      timeoutMs: 20,
    });
    await assert.rejects(p(args), /deadline/);
    assert.equal(signal.aborted, true);
  }
});
test("pre-aborted direct provider exits cleanly without unhandled rejection or network", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `import {createSynthesisProvider} from ${JSON.stringify(new URL("./provider.mjs", import.meta.url).href)};
  const controller = new AbortController(); controller.abort();
  const p = createSynthesisProvider({apiKey:'fixture',model:'fixture',endpoint:'https://example.invalid',fetchImpl:()=>{throw Error('network called')}});
  try {await p({instructions:'x',question:'q',sources:[],signal:controller.signal}); process.exitCode=2;} catch(e) {if(e.name !== 'AbortError') throw e;}
  await new Promise(resolve=>setTimeout(resolve,20));`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
});
test("credential-free audit records exact wire body before network and returned usage", async () => {
  let requestRecord;
  let receipt;
  const p = createSynthesisProvider(
    config(async (_url, request) => {
      assert.equal(requestRecord.body, request.body);
      return Response.json({
        usage: { prompt_tokens: 42 },
        choices: [
          {
            message: { content: '{"summary":"fixture"}' },
            finish_reason: "stop",
          },
        ],
      });
    }),
  );
  await p({
    ...args,
    onRequest: async (r) => {
      requestRecord = r;
    },
    onReceipt: async (r) => {
      receipt = r;
    },
  });
  assert.equal(
    JSON.stringify({ requestRecord, receipt, config: p.auditConfig }).includes(
      "fixture-not-a-real-key",
    ),
    false,
  );
  assert.equal(receipt.usage.prompt_tokens, 42);
});
