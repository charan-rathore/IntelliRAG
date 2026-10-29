import { test } from "node:test";
import assert from "node:assert/strict";
import { plannedCost } from "./cost-bound.mjs";
test("explicit proposed comparison arithmetic, not actual spend", () => {
  const base = {
    cases: 12,
    inputTokensPerCase: 8000,
    outputTokensPerCase: 1500,
  };
  assert.equal(
    plannedCost({ ...base, inputUSDPerMillion: 0.3, outputUSDPerMillion: 2.5 }),
    0.0738,
  );
  assert.equal(
    plannedCost({ ...base, inputUSDPerMillion: 3, outputUSDPerMillion: 15 }),
    0.558,
  );
});
test("invalid bound rejected", () =>
  assert.throws(() =>
    plannedCost({
      cases: -1,
      inputTokensPerCase: 1,
      outputTokensPerCase: 1,
      inputUSDPerMillion: 1,
      outputUSDPerMillion: 1,
    }),
  ));
test("finite operands cannot yield accepted infinite cost", () => {
  assert.throws(
    () =>
      plannedCost({
        cases: Number.MAX_VALUE,
        inputTokensPerCase: Number.MAX_VALUE,
        outputTokensPerCase: 1,
        inputUSDPerMillion: 1,
        outputUSDPerMillion: 1,
      }),
    /overflow/,
  );
});
