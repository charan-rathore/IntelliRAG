import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { completeAnswer, joinPieces, trimToComplete, SHORTENED_NOTE, continuationPrompt } from "./answer-completion.ts";
import { GenerationError, validateCompletion } from "./generation-result.ts";

const budgetStop = (text: string) => () => validateCompletion({ text, stopReason: "length" });

describe("never ending mid-answer", () => {
  it("keeps the partial text on a budget stop", () => {
    try { budgetStop("Half an ans")(); assert.fail("should throw"); }
    catch (e) { assert.ok(e instanceof GenerationError); assert.equal(e.reason, "output_budget_exhausted"); assert.equal(e.partial, "Half an ans"); }
  });

  it("continues from where the model stopped and joins the pieces", async () => {
    const seen: string[] = [];
    const r = await completeAnswer({ turn: async (soFar) => {
      seen.push(soFar);
      if (!soFar) budgetStop("Use `onIdle()` when every job has finished, including the running ")();
      return "ones [1].";
    } });
    assert.equal(r.text, "Use `onIdle()` when every job has finished, including the running ones [1].");
    assert.equal(r.continued, 1);
    assert.equal(seen[1], "Use `onIdle()` when every job has finished, including the running ");
    assert.ok(continuationPrompt("Q?", seen[1]!).includes("Continue from exactly where it stops"));
  });

  it("drops a repeated overlap between pieces", () => {
    assert.equal(joinPieces("The queue pauses until resume is called", "until resume is called again."), "The queue pauses until resume is called again.");
  });

  it("after the last continuation, trims to whole sentences and says so", async () => {
    const r = await completeAnswer({ maxContinuations: 1, turn: async (soFar) => budgetStop(soFar ? " Second sentence is cut of" : "First sentence is whole.")() });
    assert.ok(r.shortened);
    assert.equal(r.text, `First sentence is whole.\n\n${SHORTENED_NOTE}`);
  });

  it("rethrows failures that aren't budget stops", async () => {
    await assert.rejects(completeAnswer({ turn: async () => validateCompletion({ text: "x", stopReason: "safety" }) }), /blocked/);
  });
});

describe("trimToComplete", () => {
  it("closes an unfinished code block", () => {
    assert.equal(trimToComplete("Run:\n```ts\nqueue.add(job)\nqueue.on"), "Run:\n```ts\nqueue.add(job)\n```");
  });
  it("drops a list item cut mid-line", () => {
    assert.equal(trimToComplete("Steps:\n- pause the queue.\n- add the jo"), "Steps:\n- pause the queue.");
  });
  it("backs up to the last full sentence", () => {
    assert.equal(trimToComplete("It waits for running tasks. Then it swaps the settings and resu"), "It waits for running tasks.");
  });
  it("leaves a finished answer alone", () => {
    assert.equal(trimToComplete("Done [2]."), "Done [2].");
  });
});
