import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildIdf } from "./ranking.ts";
import { classifyTurn, mustRefuse, planTurn, sessionFocus, topicStart, type SessionTurn } from "./session-intent.ts";

const CORPUS = [
  "timeout: Per-operation timeout in milliseconds. The timeout begins when the operation is dequeued.",
  "intervalCap: The max number of runs in the given interval of time.",
  "strict: Whether to use strict mode for rate limiting (sliding window algorithm).",
  ".addAll(fns, options?) Same as .add(), but accepts an array of sync or async functions.",
  "signal: AbortSignal for cancellation of the operation. If the operation is already running, the signal will need to be handled by the operation itself.",
  ".onIdle() Returns a promise that settles when the queue becomes empty, and all promises have completed.",
  "priority: Operations with greater priority will be scheduled first.",
];
const idf = buildIdf(CORPUS);
const turn = (query: string, extra: Partial<SessionTurn> = {}): SessionTurn => ({ query, packed: [], ...extra });

describe("reading a turn", () => {
  it("treats the first question as fresh", () => {
    assert.equal(classifyTurn("How do I cancel a queued task with an AbortSignal?", [], idf), "fresh");
  });

  it("recognises elliptical follow-ups", () => {
    const h = [turn("How do I cancel a queued task with an AbortSignal?")];
    for (const q of ["What if it is already running?", "And to be told every time?", "Why not just call clear instead?"]) {
      assert.equal(classifyTurn(q, h, idf), "follow-up", q);
    }
  });

  it("recognises an explicit change of topic", () => {
    const h = [turn("How do I set a per-task timeout?")];
    assert.equal(classifyTurn("Separately: how do I run tasks without awaiting each add in a for loop?", h, idf), "switch");
    assert.equal(classifyTurn("Different question. What does strict mode do to intervalCap?", h, idf), "switch");
  });

  it("treats a full question with nothing in common as a new topic", () => {
    const h = [turn("How do I set a per-operation timeout in milliseconds?")];
    assert.equal(classifyTurn("Which tasks with greater priority are scheduled first?", h, idf), "switch");
  });
});

describe("planning the search", () => {
  it("searches a follow-up together with the earlier questions on its topic", () => {
    const h = [turn("How do I cancel a queued task with an AbortSignal?")];
    const plan = planTurn("What if it is already running?", h, idf);
    assert.equal(plan.mode, "follow-up");
    assert.equal(plan.usedContext, true);
    assert.match(plan.resolved, /AbortSignal/);
    assert.match(plan.resolved, /already running/);
  });

  it("starts again after a topic switch", () => {
    const h = [turn("How do I set a per-task timeout?"), turn("Separately: how do I run tasks without awaiting each add in a for loop?")];
    assert.equal(topicStart(h, idf), 1);
    const plan = planTurn("What does it return?", h, idf);
    assert.doesNotMatch(plan.resolved, /timeout/);
    assert.match(plan.resolved, /for loop/);
  });

  it("leaves refused turns out of the search", () => {
    const h = [turn("How does rate limiting work?"), turn("What uptime do the maintainers guarantee?", { refused: true })];
    const plan = planTurn("And how is the interval reset?", h, idf);
    assert.doesNotMatch(plan.resolved, /uptime/);
  });

  it("does not change a fresh question", () => {
    const plan = planTurn("How do I give every task a five second timeout?", [], idf);
    assert.equal(plan.resolved, "How do I give every task a five second timeout?");
    assert.equal(plan.usedContext, false);
  });
});

describe("what the session is about", () => {
  it("weights terms the evidence confirmed above how the question happened to be phrased", () => {
    const h = [turn("How do I give every task a five second timeout?", { packed: [{ chunkId: "t", text: CORPUS[0]!, heading: "timeout" }] })];
    const focus = sessionFocus(h, idf);
    assert.ok((focus.get("timeout")?.weight ?? 0) > (focus.get("every")?.weight ?? 0));
  });

  it("decays older turns", () => {
    const h = [
      turn("How does priority scheduling work?", { packed: [{ chunkId: "p", text: CORPUS[6]!, heading: "priority" }] }),
      turn("And the timeout?", { packed: [{ chunkId: "t", text: CORPUS[0]!, heading: "timeout" }] }),
    ];
    const focus = sessionFocus(h, idf);
    assert.ok(focus.get("timeout")!.weight > focus.get("priority")!.weight);
  });

  it("pulls toward what was marked helpful and drops what was marked unhelpful", () => {
    const packed = [{ chunkId: "s", text: CORPUS[2]!, heading: "strict" }, { chunkId: "a", text: CORPUS[3]!, heading: ".addAll(fns, options?)" }];
    const h = [turn("How do I limit the rate?", { packed, feedback: { s: 1, a: -1 } })];
    const focus = sessionFocus(h, idf);
    assert.ok(focus.has("slid") || focus.has("sliding") || focus.has("window"), [...focus.keys()].join(","));
    assert.ok(!focus.has("addall"));
  });
});

describe("protecting refusals", () => {
  it("refuses when context found passages but none mention what this turn asks", () => {
    const h = [turn("How does rate limiting work?")];
    const plan = planTurn("And what uptime guarantee do they make?", h, idf);
    assert.equal(mustRefuse(plan, [CORPUS[1]!, CORPUS[2]!]), true);
  });

  it("keeps an answerable follow-up whose own terms the evidence covers", () => {
    const h = [turn("How do I cancel a queued task with an AbortSignal?")];
    const plan = planTurn("What if it is already running?", h, idf);
    assert.equal(mustRefuse(plan, [CORPUS[4]!]), false);
  });

  it("never refuses on its own account when no context was used", () => {
    const plan = planTurn("What uptime guarantee is there?", [], idf);
    assert.equal(mustRefuse(plan, [CORPUS[1]!]), false);
  });
});
