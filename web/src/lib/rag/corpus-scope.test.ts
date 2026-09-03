import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_CORPORA,
  corpusIdForInput,
  githubCorpusId,
  parseCorpusScope,
  SEED_CORPUS_ID,
} from "./corpus-scope.ts";

describe("corpus scope", () => {
  it("defaults to seed-lab and treats all as explicit", () => {
    assert.deepEqual(parseCorpusScope(undefined), { kind: "corpus", corpusId: SEED_CORPUS_ID });
    assert.deepEqual(parseCorpusScope(""), { kind: "corpus", corpusId: SEED_CORPUS_ID });
    assert.deepEqual(parseCorpusScope(ALL_CORPORA), { kind: "all" });
  });

  it("builds github corpus ids from repo + short sha", () => {
    assert.equal(githubCorpusId("pgvector/pgvector", "master@e48241b"), "github:pgvector/pgvector@e48241b");
    assert.equal(
      corpusIdForInput({ sourceType: "github", originRepo: "pgvector/pgvector", originRef: "master@e48241b" }),
      "github:pgvector/pgvector@e48241b",
    );
    assert.equal(corpusIdForInput({ sourceType: "seed" }), SEED_CORPUS_ID);
  });
});
