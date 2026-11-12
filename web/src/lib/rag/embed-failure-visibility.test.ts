import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { embedPendingBatch, ingestText } from "./ingest.server.ts";
import { runRagasEval, EvalEmbedStopError } from "./eval.server.ts";
import { pendingEmbeddingCount } from "./store.server.ts";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "./types.ts";

const pad = " with enough surrounding prose to pass the minimum document length check";
const LEAK_TOKEN = "sk-or-test-SECRETTOKEN";
let currentStatus = 200;
let currentMode: "http" | "network" | "programming" | "bad-dimension" = "http";
let origFetch: typeof fetch;
const egressLog: string[] = [];
let generationCalls = 0;

function installFetchMock() {
  origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    egressLog.push(url);
    if (url.includes("/chat/completions") || url.includes(":generateContent") || url.includes(":streamGenerateContent")) {
      generationCalls += 1;
      return new Response(JSON.stringify({ error: { message: "must not be reached" } }), { status: 500 });
    }
    if (!url.includes("/embeddings")) {
      if (url.includes("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "google/gemini-embedding-001" }] }), { status: 200 });
      }
      // FAIL CLOSED: any URL outside the provider-boundary stubs is an
      // egress violation - the test must fail, not pass through to the
      // real network.
      throw new Error(`EGRESS DENIED in test: ${url}`);
    }
    if (currentMode === "network") throw new TypeError("fetch failed");
    if (currentMode === "programming") throw new TypeError("Cannot read properties of undefined (reading 'x')");
    if (currentStatus !== 200) {
      // Provider payload deliberately carries a token that must never reach the UI reason.
      return new Response(
        JSON.stringify({ error: { message: `provider says no, key ${LEAK_TOKEN} rejected` } }),
        { status: currentStatus },
      );
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
    const inputs = body.input ?? [];
    const dims = currentMode === "bad-dimension" ? 3 : EMBEDDING_DIMENSIONS;
    return new Response(
      JSON.stringify({ data: inputs.map((_, index) => ({ embedding: Array(dims).fill(0.1), index })) }),
      { status: 200 },
    );
  }) as typeof fetch;
}

describe("embedPendingBatch failure visibility + safe stop", () => {
  before(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    delete process.env.GEMINI_API_KEY;
    installFetchMock();
  });
  after(() => {
    globalThis.fetch = origFetch;
    delete process.env.OPENROUTER_API_KEY;
  });

  it("a rejecting provider (400/422) stops the call with a typed request-rejected reason and honest pending", async () => {
    await ingestText({ title: "fv 400", body: `failure visibility alpha${pad}`, sourceType: "markdown" });
    currentStatus = 400;
    const result = await embedPendingBatch();
    assert.equal(result.embedded, 0);
    assert.equal(result.stop?.kind, "request-rejected");
    assert.equal(result.stop?.status, 400);
    assert.equal(result.remaining, 1, "honest pending: the unembedded chunk is still counted");
    assert.equal(await pendingEmbeddingCount(EMBEDDING_MODEL), 1);
    assert.ok(!result.stop?.message.includes(LEAK_TOKEN), "provider payload must never leak into the UI reason");
    currentStatus = 422;
    const again = await embedPendingBatch();
    assert.equal(again.stop?.kind, "request-rejected");
    assert.equal(again.stop?.status, 422);
  });

  it("status categories: auth, not-found, rate-limited, server-error", async () => {
    for (const [status, kind] of [[401, "authentication"], [403, "authentication"], [404, "not-found"], [429, "rate-limited"], [500, "server-error"], [503, "server-error"]] as const) {
      currentStatus = status;
      const result = await embedPendingBatch();
      assert.equal(result.embedded, 0);
      assert.equal(result.stop?.kind, kind, `HTTP ${status}`);
      assert.equal(result.stop?.status, status);
      assert.equal(result.remaining, 1);
    }
  });

  it("a network failure stops with the network category and no status", async () => {
    currentMode = "network";
    const result = await embedPendingBatch();
    assert.equal(result.embedded, 0);
    assert.equal(result.stop?.kind, "network");
    assert.equal(result.stop?.status, undefined);
    assert.equal(result.remaining, 1);
    currentMode = "http";
  });

  it("programming errors are NOT swallowed into a typed stop: they propagate", async () => {
    currentMode = "programming";
    await assert.rejects(() => embedPendingBatch(), /Cannot read properties of undefined/);
    currentMode = "http";
  });

  it("the success path is unchanged: embeddings saved, remaining honest, no stop", async () => {
    currentStatus = 200;
    const result = await embedPendingBatch();
    assert.equal(result.embedded, 1);
    assert.equal(result.stop, undefined);
    assert.equal(result.remaining, 0);
    assert.equal(await pendingEmbeddingCount(EMBEDDING_MODEL), 0);
  });

  it("a 200 with an unusable payload is invalid-response with NO fabricated HTTP status", async () => {
    await ingestText({ title: "fv baddim", body: `failure visibility bad dimension${pad}`, sourceType: "markdown" });
    const base = await pendingEmbeddingCount(EMBEDDING_MODEL);
    currentMode = "bad-dimension";
    const result = await embedPendingBatch();
    assert.equal(result.embedded, 0);
    assert.equal(result.stop?.kind, "invalid-response");
    assert.equal(result.stop?.status, undefined, "no HTTP error was observed; none may be shown");
    assert.ok(!result.stop?.message.includes("400"));
    assert.equal(result.remaining, base, "nothing embedded; the full pending count stays visible");
    currentMode = "http";
  });

  it("the eval aborts ENTIRELY before any query/judge call when embedding stops", async () => {
    currentStatus = 400;
    const before = generationCalls;
    await assert.rejects(() => runRagasEval(), EvalEmbedStopError);
    assert.equal(generationCalls, before, "zero query/judge generation calls after an embedding stop");
    currentStatus = 200;
  });

  it("egress denial proof: every request made during these tests hit only the mocked boundary", async () => {
    const outside = egressLog.filter(
      (u) => !u.includes("/embeddings") && !u.includes("/models") &&
        !u.includes("/chat/completions") && !u.includes("generateContent"),
    );
    assert.deepEqual(outside, [], "no request may leave the mocked provider boundary");
  });

  it("honest pending across several queued chunks when the provider rejects", async () => {
    const base = await pendingEmbeddingCount(EMBEDDING_MODEL);
    for (let i = 0; i < 3; i += 1) {
      await ingestText({ title: `fv multi ${i}`, body: `failure visibility batch ${i}${pad}`, sourceType: "markdown" });
    }
    currentStatus = 400;
    const result = await embedPendingBatch();
    assert.equal(result.embedded, 0);
    assert.equal(result.stop?.kind, "request-rejected");
    assert.equal(result.remaining, base + 3);
    assert.equal(await pendingEmbeddingCount(EMBEDDING_MODEL), base + 3);
    currentStatus = 200;
  });
});
