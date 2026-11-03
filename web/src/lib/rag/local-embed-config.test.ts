import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLocalEmbedEnabled } from "./local-embed.server.ts";

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
