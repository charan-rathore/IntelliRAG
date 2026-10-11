import assert from "node:assert/strict";
import test from "node:test";
import { compactContext, splitUnits } from "./compact";
import type { RetrievedChunk } from "./types";

function chunk(id: string, text: string, score: number): RetrievedChunk {
  return {
    chunkId: id,
    documentId: "d",
    slug: "d",
    title: "d",
    text,
    heading: null,
    score,
    rank: 1,
    retriever: "keyword",
    tokenCount: Math.ceil(text.length / 4),
    indexedAt: null,
    embeddingModel: null,
    filepath: null,
    language: null,
    symbol: null,
    chunkKind: "prose",
    corpusId: "c",
  };
}
const idf = new Map<string, number>([
  ["jitter", 3],
  ["retry", 1],
  ["filler", 0.2],
]);

test("splitUnits splits lines and sentences", () => {
  assert.deepEqual(splitUnits("One. Two.\nThree"), ["One.", "Two.", "Three"]);
});

test("chunks that already fit are returned untouched", () => {
  const out = compactContext({
    query: "jitter",
    terms: ["jitter"],
    idf,
    ranked: [chunk("a", "Jitter spreads retries.", 1)],
    keywordScores: new Map([["a", 1]]),
    denseScores: new Map(),
    maxTokens: 1000,
  });
  assert.equal(out[0]!.text, "Jitter spreads retries.");
});

test("over budget: keeps the answering sentence from a lower-ranked chunk and drops filler", () => {
  const filler = Array.from(
    { length: 40 },
    (_, i) => `Filler sentence number ${i} about nothing.`,
  ).join(" ");
  const top = chunk("top", `${filler} Retry basics.`, 1);
  const low = chunk("low", `${filler} The jitter option randomizes retry delays.`, 0.5);
  const out = compactContext({
    query: "jitter retry",
    terms: ["jitter", "retry"],
    idf,
    ranked: [top, low],
    keywordScores: new Map([
      ["top", 2],
      ["low", 1],
    ]),
    denseScores: new Map(),
    maxTokens: 120,
  });
  const text = out.map((c) => c.text).join("\n");
  assert.ok(text.includes("The jitter option randomizes retry delays."));
  assert.ok(out.reduce((n, c) => n + c.tokenCount, 0) <= 120);
});

test("text under a matching heading is kept even without shared words", () => {
  const filler = Array.from(
    { length: 40 },
    (_, i) => `Filler sentence number ${i} about nothing.`,
  ).join(" ");
  const c = chunk("a", `${filler}\n### How do I stop jitter?\nUse the abort signal instead.`, 1);
  const out = compactContext({
    query: "stop jitter",
    terms: ["stop", "jitter"],
    idf,
    ranked: [c],
    keywordScores: new Map([["a", 1]]),
    denseScores: new Map(),
    maxTokens: 60,
  });
  assert.ok(out[0]!.text.includes("Use the abort signal instead."));
});
