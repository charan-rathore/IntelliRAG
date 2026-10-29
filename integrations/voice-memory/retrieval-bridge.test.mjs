import { test } from "node:test";
import assert from "node:assert/strict";
import { importBundle, answerFromRetrieval } from "./dist/engine.mjs";
function fixture(
  text = "Pilot security approval remains pending. Maya owns security review.",
) {
  const bundle = importBundle([{ title: "Source", text }]);
  const source = bundle.sources[0];
  const found = {
    actualMode: "dense",
    corpusId: bundle.scope,
    corpusScope: "corpus",
    evidence: "positive",
    chunks: [
      {
        chunkId: "fixture",
        documentId: source.id,
        text: source.text,
        title: source.title,
        corpusId: bundle.scope,
        embeddingModel: "fixture-model",
        rank: 1,
        score: 1,
      },
    ],
  };
  return { bundle, source, found };
}
const expected = { actualMode: "dense", embeddingModel: "fixture-model" };
test("scoped retrieval roundtrip preserves original normalized UTF16 evidence without generation", () => {
  const { bundle, source, found } = fixture(
    "₹ 😀 Pilot security approval remains pending.\r\nMaya owns security review.",
  );
  const result = answerFromRetrieval(
    "security approval",
    bundle,
    found,
    expected,
  );
  assert.equal(result.refused, false);
  assert.equal(result.generation, false);
  assert.equal(result.actualMode, "dense");
  assert.equal(result.corpusId, bundle.scope);
  const e = result.evidence[0];
  assert.equal(e.hash, source.hash);
  assert.equal(source.text.slice(e.start, e.end), e.quote);
  assert.equal(e.end, source.text.length);
});
test("foreign documents altered text and repeated quotes produce no evidence sidecar", () => {
  for (const mode of ["foreign", "altered", "repeated"]) {
    const { bundle, found } = fixture(
      mode === "repeated"
        ? "Security review pending. Security review pending."
        : undefined,
    );
    if (mode === "foreign") found.chunks[0].documentId = "foreign";
    if (mode === "altered") found.chunks[0].text = "Security is approved.";
    if (mode === "repeated") found.chunks[0].text = "Security review pending.";
    const result = answerFromRetrieval("security", bundle, found, expected);
    assert.equal(result.refused, true);
    assert.deepEqual(result.evidence, []);
  }
});
test("wrong corpus forged mode or model fails closed before evidence", () => {
  for (const mode of [
    "topcorpus",
    "allscope",
    "chunkcorpus",
    "actualmode",
    "model",
  ]) {
    const { bundle, found } = fixture();
    if (mode === "topcorpus") found.corpusId = "other";
    if (mode === "allscope") found.corpusScope = "all";
    if (mode === "chunkcorpus") found.chunks[0].corpusId = "other";
    if (mode === "actualmode") found.actualMode = "hybrid";
    if (mode === "model") found.chunks[0].embeddingModel = "other-model";
    assert.throws(
      () => answerFromRetrieval("security", bundle, found, expected),
      /contract mismatch/,
    );
  }
});

test("unknown evidence enum fails closed and nonpositive gates never become supported from spans", () => {
  for (const evidence of [
    "sufficient",
    undefined,
    "ambiguous",
    "insufficient",
    "negative_not_found",
  ]) {
    const { bundle, found } = fixture();
    found.evidence = evidence;
    if (evidence === "sufficient" || evidence === undefined)
      assert.throws(
        () => answerFromRetrieval("security", bundle, found, expected),
        /evidence contract/,
      );
    else {
      const result = answerFromRetrieval("security", bundle, found, expected);
      assert.equal(result.refused, true);
      assert.deepEqual(result.evidence, []);
    }
  }
});
