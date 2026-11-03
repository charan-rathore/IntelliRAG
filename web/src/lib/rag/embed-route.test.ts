import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseEmbedRoute } from "./embed-route.ts";

describe("chooseEmbedRoute", () => {
  it("prefers a hosted key over the local pipeline", () => {
    assert.equal(chooseEmbedRoute(true, true), "hosted");
  });
  it("falls back to local embeddings when no key is configured", () => {
    assert.equal(chooseEmbedRoute(false, true), "local");
  });
  it("stays BM25-only when neither backend exists", () => {
    assert.equal(chooseEmbedRoute(false, false), "none");
  });
});
