import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseEmbedRoute, resolveEmbedRoute } from "./embed-route.ts";

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

describe("resolveEmbedRoute", () => {
  it("never probes the local pipeline when a hosted key exists (no eager 30MB load)", async () => {
    let probed = false;
    const route = await resolveEmbedRoute(true, async () => {
      probed = true;
      return true;
    });
    assert.equal(route, "hosted");
    assert.equal(probed, false);
  });
  it("probes local only without a hosted key", async () => {
    assert.equal(await resolveEmbedRoute(false, async () => true), "local");
    assert.equal(await resolveEmbedRoute(false, async () => false), "none");
  });
});
