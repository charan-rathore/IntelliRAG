import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stageIndex } from "./stage-progress.ts";

describe("stage progress", () => {
  it("maps real pipeline events to three forward-only steps", () => {
    assert.equal(stageIndex({ stage: "retrieving", hasSources: false, hasText: false }), 0);
    assert.equal(stageIndex({ stage: "graph-lookup", hasSources: false, hasText: false }), 0);
    assert.equal(stageIndex({ stage: "graph-cache", hasSources: false, hasText: false }), 0);
    assert.equal(stageIndex({ stage: "generating", hasSources: true, hasText: false }), 1);
    assert.equal(stageIndex({ stage: "generating", hasSources: true, hasText: true }), 2);
  });
});
