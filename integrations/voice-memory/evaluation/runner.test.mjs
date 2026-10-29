import { test } from "node:test";
import assert from "node:assert/strict";
import { runEvaluation } from "./runner.mjs";
import { readFileSync } from "node:fs";
const realCases = JSON.parse(
  readFileSync(new URL("./cases.json", import.meta.url), "utf8"),
);
const cases = realCases.map((item) => ({
  id: item.id,
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
  assert.equal(receipt[0].id, "unrelated-source");
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
test("stable IDs survive reordering and auditable request persists before provider", async () => {
  const saved = [];
  const provider = Object.assign(
    async (request) => {
      assert.equal(saved.at(-1).status, "request-recorded");
      assert.ok(saved.at(-1).audit.request.sources[0].hash);
      assert.match(request.instructions, /UTF-16/);
      await request.onReceipt({
        usage: { prompt_tokens: 10 },
        envelope: { fixture: true },
      });
      throw Error("fixture semantic failure");
    },
    { auditConfig: { model: "fixture", endpoint: "https://example.invalid" } },
  );
  const receipts = await runEvaluation({
    cases: [...cases].reverse(),
    provider,
    save: async (r) => saved.push(structuredClone(r)),
  });
  assert.equal(receipts[0].id, "unrelated-source");
  assert.equal(saved.filter((r) => r.status === "request-recorded").length, 6);
  assert.equal(saved.filter((r) => r.status === "response-recorded").length, 6);
  assert.equal(saved.at(-1).audit.receipt.usage.prompt_tokens, 10);
});
