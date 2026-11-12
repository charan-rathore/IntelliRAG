import { test } from "node:test";
import assert from "node:assert/strict";
import { graphStatePath } from "./storage.ts";

test("graph snapshots support isolated process paths while retaining the existing default", () => {
  const previous = process.env.INTELLIRAG_GRAPH_PATH;
  try {
    delete process.env.INTELLIRAG_GRAPH_PATH;
    assert.equal(graphStatePath(), "/tmp/intellirag-graphify.json");
    process.env.INTELLIRAG_GRAPH_PATH = " /tmp/private-graph/session.json ";
    assert.equal(graphStatePath(), "/tmp/private-graph/session.json");
    process.env.INTELLIRAG_GRAPH_PATH = "   ";
    assert.equal(graphStatePath(), "/tmp/intellirag-graphify.json");
  } finally {
    if (previous === undefined) delete process.env.INTELLIRAG_GRAPH_PATH;
    else process.env.INTELLIRAG_GRAPH_PATH = previous;
  }
});
