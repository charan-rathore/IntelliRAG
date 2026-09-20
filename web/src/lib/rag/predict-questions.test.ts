import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { predictQuestionsFromDocument } from "./predict-questions.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pQueue = readFileSync(
  join(here, "../../../../eval/repo-support/fixtures/p-queue.md"),
  "utf8",
);

describe("predictQuestionsFromDocument", () => {
  it("returns at least three questions for the p-queue README", () => {
    const predicted = predictQuestionsFromDocument(pQueue, { title: "p-queue", min: 3 });
    assert.ok(predicted.length >= 3, `expected >=3, got ${predicted.length}`);
    for (const item of predicted) {
      assert.ok(item.question.endsWith("?") || /^(how|what|when|why)/i.test(item.question));
      assert.ok(item.question.length >= 18);
      assert.ok(item.question.length <= 180);
    }
  });

  it("prefers FAQ and howto phrasing when present", () => {
    const body = `# Widget

## FAQ

- Q: How do I rotate API keys safely?
- Q: What happens if the queue pauses mid-job?

## Configuration

Set concurrency and timeout carefully.

### pause()

Stops starting new work.

**Warning:** Waiting for idle while paused can stall queued jobs.
`;
    const predicted = predictQuestionsFromDocument(body, { title: "Widget", min: 3 });
    assert.ok(predicted.length >= 3);
    const joined = predicted.map((p) => p.question.toLowerCase()).join(" | ");
    assert.match(joined, /rotate api keys|queue pauses|pause|idle|stall|concurrency|configuration/);
  });

  it("still yields three fallbacks for a nearly empty document", () => {
    const predicted = predictQuestionsFromDocument(
      "Short note about Orion Queue utilities for draining work.",
      { title: "Orion Queue", min: 3 },
    );
    assert.equal(predicted.length, 3);
    assert.ok(predicted.every((p) => /orion queue/i.test(p.question)));
  });
});
