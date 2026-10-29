import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runDevelopment } from "./development-run.mjs";
const cases = JSON.parse(
  readFileSync(new URL("./cases.json", import.meta.url), "utf8"),
);
function fixture(cost, counters, fail = false) {
  return Object.assign(
    async (request) => {
      counters.calls++;
      if (fail) throw Error("fixture HTTP401");
      await request.onReceipt({ usage: { cost }, envelope: { fixture: true } });
      const source = request.sources[0],
        line = source.lines[0];
      return {
        summary: "Fixture only",
        items: [
          {
            kind: "fact",
            text: "Fixture quote",
            evidence: [
              {
                sourceId: source.sourceId,
                hash: source.hash,
                start: line.start,
                end: line.end,
                quote: line.text,
              },
            ],
          },
        ],
        draft: { subject: "Review", body: "Fixture only" },
      };
    },
    { auditConfig: { model: "fixture", endpoint: "https://example.invalid" } },
  );
}
test("invalid approval or sink failure prevents provider", async () => {
  const counters = { calls: 0 };
  for (const approvedUSD of [undefined, NaN, Infinity, 0, -1, 0.26])
    await assert.rejects(
      runDevelopment({
        cases,
        approvedUSD,
        provider: fixture(0, counters),
        save: async () => {},
      }),
    );
  await assert.rejects(
    runDevelopment({
      cases,
      approvedUSD: 0.25,
      provider: fixture(0, counters),
      save: async () => {
        throw Error("disk failed");
      },
    }),
  );
  assert.equal(counters.calls, 0);
});
test("first transport error or missing invalid cost stops remaining development requests", async () => {
  for (const [cost, fail] of [
    [0, true],
    [undefined, false],
    [NaN, false],
    [-1, false],
    [0.26, false],
  ]) {
    const counters = { calls: 0 };
    const saved = [];
    await assert.rejects(
      runDevelopment({
        cases,
        approvedUSD: 0.25,
        provider: fixture(cost, counters, fail),
        save: async (r) => saved.push(structuredClone(r)),
      }),
    );
    assert.equal(counters.calls, 1);
    assert.equal(saved.at(-1).status, "failed");
  }
});
test("sequential six dev only with zero cost accepted, and cap stops next request", async () => {
  const counters = { calls: 0 };
  const saved = [];
  const result = await runDevelopment({
    cases,
    approvedUSD: 0.25,
    provider: fixture(0, counters),
    save: async (r) => saved.push(structuredClone(r)),
  });
  assert.equal(counters.calls, 6);
  assert.equal(result.reportedCostUSD, 0);
  assert.deepEqual(
    result.receipts.map((r) => r.id),
    cases.slice(0, 6).map((r) => r.id),
  );
  const capped = { calls: 0 };
  await assert.rejects(
    runDevelopment({
      cases,
      approvedUSD: 0.25,
      provider: fixture(0.25, capped),
      save: async () => {},
    }),
  );
  assert.equal(capped.calls, 1);
});
test("semantic failure, duplicate/missing usage and mid/final sink failures stop after first call", async () => {
  for (const mode of [
    "semantic",
    "duplicate",
    "omit",
    "response-recorded",
    "needs-human-review",
  ]) {
    const counters = { calls: 0 };
    const base = fixture(0.01, counters);
    const provider = Object.assign(
      async (request) => {
        if (mode === "omit")
          return base({ ...request, onReceipt: async () => {} });
        if (mode === "duplicate")
          return base({
            ...request,
            onReceipt: async (r) => {
              await request.onReceipt(r);
              await request.onReceipt(r);
            },
          });
        const result = await base(request);
        return mode === "semantic" ? {} : result;
      },
      { auditConfig: base.auditConfig },
    );
    await assert.rejects(
      runDevelopment({
        cases,
        approvedUSD: 0.25,
        provider,
        save: async (r) => {
          if (r.status === mode) throw Error("sink failed");
        },
      }),
    );
    assert.equal(counters.calls, 1, mode);
  }
});
test("fractional cumulative exhaustion retains both receipts and stops before third call", async () => {
  const counters = { calls: 0 };
  const saved = [];
  await assert.rejects(
    runDevelopment({
      cases: [...cases].reverse(),
      approvedUSD: 0.25,
      provider: fixture(0.125, counters),
      save: async (r) => saved.push(structuredClone(r)),
    }),
  );
  assert.equal(counters.calls, 2);
  assert.equal(saved.filter((r) => r.status === "response-recorded").length, 2);
  assert.equal(saved.at(-1).status, "failed");
});
test("native transport wire-sink failure makes zero fetch calls", async () => {
  const { createSynthesisProvider } = await import("../provider.mjs");
  let calls = 0;
  const saved = [];
  const provider = createSynthesisProvider({
    apiKey: "fixture-only",
    model: "fixture",
    endpoint: "https://example.invalid/v1/chat/completions",
    fetchImpl: async () => {
      calls++;
      throw Error("should not reach fetch");
    },
  });
  await assert.rejects(
    runDevelopment({
      cases,
      approvedUSD: 0.25,
      provider,
      save: async (r) => {
        saved.push(structuredClone(r));
        if (r.status === "wire-request-recorded") throw Error("disk full");
      },
    }),
  );
  assert.equal(calls, 0);
  assert.equal(saved.filter((r) => r.status === "request-recorded").length, 1);
  assert.equal(saved.at(-1).status, "failed");
});
