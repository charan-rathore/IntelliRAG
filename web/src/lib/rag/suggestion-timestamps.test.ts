import assert from "node:assert/strict";
import { it } from "node:test";
import {
  suggestionToPublic,
  rankSuggestions,
  type SuggestionRow,
} from "./suggested-questions-memory.ts";
it("normalizes database Date timestamps before ranking alongside memory strings", () => {
  const row: SuggestionRow = {
    id: "new",
    corpus_id: "test",
    document_slug: "policy",
    question: "Who approves?",
    question_hash: "a",
    source: "predicted",
    ask_count: 0,
    last_asked_at: new Date("2026-10-29T00:00:00Z"),
    created_at: new Date("2026-10-29T00:00:00Z"),
    updated_at: new Date("2026-10-29T00:00:00Z"),
  };
  const newer = suggestionToPublic(row);
  const older = suggestionToPublic({
    ...row,
    id: "old",
    question: "When is release?",
    created_at: "2026-10-28T00:00:00.000Z",
    last_asked_at: null,
  });
  assert.equal(newer.createdAt, "2026-10-29T00:00:00.000Z");
  assert.equal(newer.lastAskedAt, "2026-10-29T00:00:00.000Z");
  assert.deepEqual(
    rankSuggestions([older, newer], 5).map((x) => x.id),
    ["new", "old"],
  );
  assert.equal(older.lastAskedAt, null);
});
