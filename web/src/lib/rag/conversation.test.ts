import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { historyFrom, HISTORY_TURNS, type AskedTurn } from "./conversation.ts";

const answer = (asked: string, extra: Partial<AskedTurn> = {}): AskedTurn => ({
  role: "assistant", asked, corpusId: "repo", coverage: "grounded",
  chunks: [{ chunkId: `${asked}:1`, text: `passage for ${asked}`, heading: "h" }], ...extra,
});

describe("the conversation sent with a question", () => {
  it("sends finished answers on the same source, oldest first", () => {
    const h = historyFrom([{ role: "user" }, answer("a"), answer("b", { corpusId: "other" }), answer("c")], "repo");
    assert.deepEqual(h.map((t) => t.query), ["a", "c"]);
  });

  it("leaves out answers still streaming or that failed", () => {
    const h = historyFrom([answer("a", { stage: "retrieving" }), answer("b", { error: "boom" }), answer("c")], "repo");
    assert.deepEqual(h.map((t) => t.query), ["c"]);
  });

  it("marks refusals, so their words never steer the next search", () => {
    assert.equal(historyFrom([answer("a", { coverage: "refused", chunks: [] })], "repo")[0]?.refused, true);
  });

  it("turns a thumbs-up or a dead end into feedback on that answer's passages", () => {
    const [up] = historyFrom([answer("a", { feedback: "useful" })], "repo");
    assert.deepEqual(up?.feedback, { "a:1": 1 });
    const [down] = historyFrom([answer("a", { feedback: "dead_end" })], "repo");
    assert.deepEqual(down?.feedback, { "a:1": -1 });
  });

  it("starts where the person chose a new topic, and keeps only the last turns", () => {
    const many = Array.from({ length: 12 }, (_, i) => answer(`q${i}`));
    assert.equal(historyFrom(many, "repo").length, HISTORY_TURNS);
    assert.deepEqual(historyFrom(many, "repo", 10).map((t) => t.query), ["q10", "q11"]);
  });
});
