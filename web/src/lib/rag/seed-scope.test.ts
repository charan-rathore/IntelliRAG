import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retrieveFromRows, type SearchRow } from "./retrieve-core.ts";
import { rerankCalibrated, buildIdf } from "./ranking.ts";
import { SEED_CORPUS_ID } from "./corpus-scope.ts";
import type { RetrievedChunk } from "./types.ts";
import type { ChunkRow } from "./types.ts";

const ephemeral = { backend: "pglite" as const, durable: false, denseAvailable: false, warning: null };

function chunk(over: Partial<RetrievedChunk> & Pick<RetrievedChunk, "chunkId" | "corpusId">): RetrievedChunk {
  return {
    documentId: over.chunkId, slug: over.chunkId, title: "Doc", heading: null,
    text: "", score: 0, rank: 1, retriever: "keyword", tokenCount: 20, indexedAt: null,
    embeddingModel: null, filepath: null, language: null, symbol: null, chunkKind: "prose",
    ...over,
  };
}

function row(corpusId: string, id: string, slug: string, title: string, text: string): SearchRow {
  const chunkRow: ChunkRow = {
    id, document_id: `doc-${id}`, ordinal: 0, text, token_count: 20, heading: null,
    embedding: null, embedding_model: null, content_hash: id, created_at: "2026-01-01",
    filepath: null, language: null, symbol: null, chunk_kind: "prose", corpus_id: corpusId,
  };
  return { title, slug, indexedAt: null, corpusId, chunk: chunkRow };
}

const QUERY = "Our cache suddenly recomputes hundreds of expensive values when a popular key disappears";
const TERMS = ["cache", "suddenly", "recomputes", "hundreds", "expensive", "values", "popular", "key", "disappears"];

describe("demo-tuned ranking aids are scoped to the seed corpus", () => {
  it("topical boost applies to seed chunks but not to an identical ingested chunk", () => {
    const text = "redis cache stampede protection: recompute once with a lock and jittered ttl";
    const candidates = [
      chunk({ chunkId: "seed-1", corpusId: SEED_CORPUS_ID, text }),
      chunk({ chunkId: "gh-1", corpusId: "github:acme/infra@deadbeef", text }),
    ];
    const { ranked, signals } = rerankCalibrated({
      query: QUERY, candidates, denseScores: new Map(), keywordScores: new Map(),
      idf: buildIdf([text]), terms: TERMS,
    });
    assert.ok(signals.get("seed-1")!.topical > 0, "seed chunk keeps the demo-tuned topical boost");
    assert.equal(signals.get("gh-1")!.topical, 0, "ingested chunk gets no topical boost");
    assert.equal(ranked[0]!.chunkId, "seed-1");
  });

  it("cue expansion only fires for seed-corpus scope", () => {
    const makeRows = (corpusId: string) => [
      row(corpusId, "a", "doc-a", "Cache notes", "cache recompute expensive popular key disappear"),
      row(corpusId, "b", "doc-b", "Unrelated", "redis ttl jitter lock stampede"),
    ];
    const gh = retrieveFromRows({
      query: QUERY, queryVector: null, mode: "keyword", topK: 2, embeddingModel: null,
      rows: makeRows("github:acme/infra@deadbeef"), storage: ephemeral,
      corpusScope: { kind: "corpus", corpusId: "github:acme/infra@deadbeef" },
    });
    assert.equal(gh.chunks[0]!.chunkId, "a", "without cue expansion the on-topic doc wins");
    const seed = retrieveFromRows({
      query: QUERY, queryVector: null, mode: "keyword", topK: 2, embeddingModel: null,
      rows: makeRows(SEED_CORPUS_ID), storage: ephemeral,
      corpusScope: { kind: "corpus", corpusId: SEED_CORPUS_ID },
    });
    assert.equal(seed.chunks[0]!.chunkId, "b", "seed scope keeps the demo-tuned cue expansion");
  });
});
