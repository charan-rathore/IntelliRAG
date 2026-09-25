import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jevSecondOpinion } from "./jev-decision.ts";

const envOn = { JEV_DECISION: "1", TYPESAFE_API_KEY: "test-key" } as NodeJS.ProcessEnv;
const gate = { kind: "positive" as const, supportHitCount: 3, supportTermCount: 5 };
const passages = [{ title: "p-queue", text: "concurrency limits and interval cap" }];

function mockFetch(choice: string, confidence: number) {
  return (async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: { grounding_decision: { type: "choice", choice, probabilities: { answer: 0.1, refuse: 0.8, clarify: 0.1 }, confidence } },
        usage: { input_tokens: 300, output_tokens: 20 },
      }),
      { status: 200 },
    )) as typeof fetch;
}

describe("jev second opinion", () => {
  it("is a no-op without the flag", async () => {
    let called = 0;
    const fetchImpl = (async () => { called += 1; throw new Error("should not be called"); }) as typeof fetch;
    const r = await jevSecondOpinion({ question: "q", passages, gate, fetchImpl, env: {} as NodeJS.ProcessEnv });
    assert.equal(r.kind, "positive");
    assert.equal(r.verdict.applied, false);
    assert.equal(called, 0);
  });

  it("never upgrades a non-positive gate", async () => {
    let called = 0;
    const fetchImpl = (async () => { called += 1; return new Response("{}"); }) as typeof fetch;
    const r = await jevSecondOpinion({ question: "q", passages, gate: { kind: "insufficient" }, fetchImpl, env: envOn });
    assert.equal(r.kind, "insufficient");
    assert.equal(called, 0);
  });

  it("downgrades to insufficient on a confident refuse", async () => {
    const r = await jevSecondOpinion({ question: "q", passages, gate, fetchImpl: mockFetch("refuse", 0.85), env: envOn });
    assert.equal(r.kind, "insufficient");
    assert.equal(r.verdict.applied, true);
    assert.deepEqual(r.verdict.usage, { input_tokens: 300, output_tokens: 20 });
  });

  it("downgrades to ambiguous on a confident clarify", async () => {
    const r = await jevSecondOpinion({ question: "q", passages, gate, fetchImpl: mockFetch("clarify", 0.9), env: envOn });
    assert.equal(r.kind, "ambiguous");
    assert.equal(r.verdict.applied, true);
  });

  it("keeps the lexical decision when confidence is below threshold", async () => {
    const r = await jevSecondOpinion({ question: "q", passages, gate, fetchImpl: mockFetch("refuse", 0.4), env: envOn });
    assert.equal(r.kind, "positive");
    assert.equal(r.verdict.applied, false);
  });

  it("keeps the lexical decision when jev says answer", async () => {
    const r = await jevSecondOpinion({ question: "q", passages, gate, fetchImpl: mockFetch("answer", 0.95), env: envOn });
    assert.equal(r.kind, "positive");
    assert.equal(r.verdict.applied, false);
  });

  it("falls back to the lexical decision on network failure", async () => {
    const fetchImpl = (async () => { throw new Error("network down"); }) as typeof fetch;
    const r = await jevSecondOpinion({ question: "q", passages, gate, fetchImpl, env: envOn });
    assert.equal(r.kind, "positive");
    assert.equal(r.verdict.applied, false);
    assert.match(r.verdict.error!, /network down/);
  });

  it("falls back to the lexical decision on http errors", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 401 })) as typeof fetch;
    const r = await jevSecondOpinion({ question: "q", passages, gate, fetchImpl, env: envOn });
    assert.equal(r.kind, "positive");
    assert.match(r.verdict.error!, /401/);
  });
});

describe("calibrateThreshold", () => {
  it("picks the lowest bucket with verdicts and zero answerable hits", async () => {
    const { calibrateThreshold } = await import("./jev-decision.ts");
    const records = [
      { id: "a", answerable: false, lexicalKind: "positive" as const, jevChoice: "refuse" as const, jevConfidence: 0.9 },
      { id: "b", answerable: true, lexicalKind: "positive" as const, jevChoice: "refuse" as const, jevConfidence: 0.6 },
      { id: "c", answerable: false, lexicalKind: "positive" as const, jevChoice: "refuse" as const, jevConfidence: 0.75 },
    ];
    const r = calibrateThreshold(records);
    // 0.5-0.7 bucket hit an answerable question, so the safe edge is 0.7
    assert.equal(r.threshold, 0.7);
    assert.equal(r.measured, true);
  });

  it("falls back to the conservative default with no usable verdicts", async () => {
    const { calibrateThreshold } = await import("./jev-decision.ts");
    const r = calibrateThreshold([
      { id: "a", answerable: true, lexicalKind: "positive" as const, jevChoice: "answer" as const, jevConfidence: 0.95 },
      { id: "b", answerable: false, lexicalKind: "positive" as const, error: "jev timeout" },
    ]);
    assert.equal(r.threshold, 0.7);
    assert.equal(r.measured, false);
  });
});
