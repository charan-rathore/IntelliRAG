import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linearFuse } from "./ranking.ts";

const h = (id: string, score: number) => ({ id, score });

describe("linearFuse", () => {
  it("alpha 1 reproduces the dense order and alpha 0 the keyword order", () => {
    const dense = [h("a", 0.9), h("b", 0.5), h("c", 0.1)];
    const kw = [h("c", 12), h("b", 6), h("a", 1)];
    assert.deepEqual(linearFuse(dense, kw, 1, 3).map((x) => x.id), ["a", "b", "c"]);
    assert.deepEqual(linearFuse(dense, kw, 0, 3).map((x) => x.id), ["c", "b", "a"]);
  });

  it("a chunk found by one retriever only is still returned", () => {
    const out = linearFuse([h("a", 0.8)], [h("z", 3)], 0.5, 5).map((x) => x.id);
    assert.deepEqual(new Set(out), new Set(["a", "z"]));
  });

  it("keeps the margin that rank-only fusion throws away", () => {
    // Dense is far ahead on x; keyword barely prefers y. Scores, not ranks, decide.
    const dense = [h("x", 0.95), h("y", 0.2), h("w", 0.19)];
    const kw = [h("y", 10), h("x", 9.9), h("w", 0)];
    assert.equal(linearFuse(dense, kw, 0.5, 3)[0]!.id, "x");
  });

  it("handles empty lists, equal scores and topK deterministically", () => {
    assert.deepEqual(linearFuse([], [], 0.5, 3), []);
    const flat = linearFuse([h("b", 1), h("a", 1)], [], 0.5, 1);
    assert.equal(flat.length, 1);
    assert.equal(flat[0]!.id, "a");
  });
});
