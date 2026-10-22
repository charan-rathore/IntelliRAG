/**
 * Unicode form must not decide whether a document can be found.
 *
 * "München" stored in decomposed form (NFD - common in PDF text extraction,
 * macOS filenames, and some web sources) tokenized as ["mu", "nchen"] while
 * the same word typed in composed form (NFC) tokenizes as ["münchen"]:
 * zero lexical overlap, so a document about Munich was invisible to the
 * person searching for Munich. The unicode tokenizer fix (#45) covered
 * non-ASCII scripts but not normalization form.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokenize, contentTokens } from "./text.ts";
import { BM25Index } from "./bm25.ts";

describe("unicode normalization", () => {
  it("tokenizes NFD and NFC input to the same tokens", () => {
    const nfc = tokenize("München café".normalize("NFC"));
    const nfd = tokenize("München café".normalize("NFD"));
    assert.deepEqual(nfd, nfc, `NFD ${JSON.stringify(nfd)} !== NFC ${JSON.stringify(nfc)}`);
  });

  it("keeps decomposed words whole instead of splitting at the combining mark", () => {
    const tokens = tokenize("München".normalize("NFD"));
    assert.ok(tokens.includes("münchen"), JSON.stringify(tokens));
    assert.ok(!tokens.includes("nchen"), JSON.stringify(tokens));
  });

  it("BM25 finds an NFD document with an NFC query", () => {
    const body = "München hosts the October fair every year".normalize("NFD");
    const index = new BM25Index([
      { id: "doc-munich", text: body },
      { id: "doc-other", text: "Redis cache stampede protection notes" },
    ]);
    const hits = index.search("München".normalize("NFC"), 2);
    assert.ok(hits.length > 0, "no hits for an NFC query over an NFD document");
    assert.equal(hits[0]!.id, "doc-munich");
    assert.ok(hits[0]!.score > 0);
  });

  it("ascii behavior is unchanged", () => {
    assert.deepEqual(contentTokens("Redis cache stampede"), ["redi", "cache", "stampede"]);
  });
});
