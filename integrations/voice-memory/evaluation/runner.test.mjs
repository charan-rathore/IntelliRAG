import { test } from "node:test";
import assert from "node:assert/strict";
import { runEvaluation } from "./runner.mjs";
const cases = Array.from({ length: 12 }, (_, i) => ({
  id: "case-" + i,
  documents: [
    {
      title: "Note",
      text: "Security sign-off remains pending for the pilot launch. No completed approval is stated.",
    },
  ],
  question: "pilot security",
}));
test("no provider or output sink means zero evaluation requests", async () => {
  await assert.rejects(runEvaluation({ cases }), /Explicit/);
});
test("held-out split is not silently mixed with development and failures saved", async () => {
  const saved = [];
  const receipt = await runEvaluation({
    cases,
    provider: async () => {
      throw Error("fixture failure");
    },
    save: async (r) => saved.push(r),
  });
  assert.equal(saved.length, 6);
  assert.equal(receipt[0].id, "case-6");
  assert.ok(
    saved.every((r) => r.status === "failed" && r.modelQualityScore === null),
  );
});
test("request bound prevents provider calls before evaluation starts", async () => {
  let calls = 0;
  await assert.rejects(
    runEvaluation({
      cases,
      maxRequests: 1,
      provider: async () => {
        calls++;
      },
      save: async () => {},
    }),
    /request bound/,
  );
  assert.equal(calls, 0);
});
test("invalid request budgets reject before any provider or sink effect", async () => {
  let calls = 0;
  for (const maxRequests of [NaN, Infinity, 0, -1, 1.5, "6", 13]) {
    await assert.rejects(
      runEvaluation({
        cases,
        maxRequests,
        provider: async () => {
          calls++;
        },
        save: async () => {
          calls++;
        },
      }),
      /integer|range/,
    );
  }
  assert.equal(calls, 0);
});
