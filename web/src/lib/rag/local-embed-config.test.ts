import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLocalEmbedEnabled, selectedEmbedModel } from "./local-embed.server.ts";

describe("resolveLocalEmbedEnabled", () => {
  it("defaults on for a persistent node process (the fallback's target)", () => {
    assert.equal(resolveLocalEmbedEnabled({ serverless: false }), true);
  });
  it("defaults off on serverless: no silent model download per cold start", () => {
    assert.equal(resolveLocalEmbedEnabled({ serverless: true }), false);
  });
  it("an operator can force it on after checking the runtime fits", () => {
    assert.equal(resolveLocalEmbedEnabled({ RAG_LOCAL_EMBED: "on", serverless: true }), true);
  });
  it("an operator can disable it anywhere", () => {
    assert.equal(resolveLocalEmbedEnabled({ RAG_LOCAL_EMBED: "off", serverless: false }), false);
  });
});

describe("selectedEmbedModel (pending-count keying)", () => {
  it("keys pending counts on the hosted model when a key exists", () => {
    assert.equal(selectedEmbedModel(true, { serverless: false }), "gemini-embedding-2");
  });
  it("keys pending counts on the local model when local would embed", () => {
    assert.equal(selectedEmbedModel(false, { serverless: false }), "Xenova/bge-small-en-v1.5");
    assert.equal(selectedEmbedModel(false, { RAG_LOCAL_EMBED: "on", serverless: true }), "Xenova/bge-small-en-v1.5");
  });
  it("stays on the hosted model when nothing will embed", () => {
    assert.equal(selectedEmbedModel(false, { RAG_LOCAL_EMBED: "off", serverless: false }), "gemini-embedding-2");
  });
});
