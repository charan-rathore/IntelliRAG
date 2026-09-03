import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "./intents.ts";
import { classifyEvidence, INSUFFICIENT_ANSWER } from "./evidence.ts";
import { getStorageStatus } from "./storage.ts";
import type { RetrievedChunk } from "./types.ts";

function chunk(partial: Partial<RetrievedChunk> & { slug: string; title: string; text: string }): RetrievedChunk {
  return {
    chunkId: partial.chunkId ?? partial.slug,
    documentId: partial.documentId ?? partial.slug,
    heading: partial.heading ?? null,
    score: partial.score ?? 0.8,
    rank: partial.rank ?? 1,
    retriever: partial.retriever ?? "hybrid",
    tokenCount: partial.tokenCount ?? 120,
    indexedAt: partial.indexedAt ?? null,
    embeddingModel: partial.embeddingModel ?? "gemini-embedding-2",
    filepath: partial.filepath ?? null,
    language: partial.language ?? null,
    symbol: partial.symbol ?? null,
    chunkKind: partial.chunkKind ?? "prose",
    slug: partial.slug,
    title: partial.title,
    text: partial.text,
    corpusId: partial.corpusId ?? "seed-lab",
  };
}

describe("intents", () => {
  it("does not regex-route weather, Mongolia, or photosynthesis", () => {
    assert.equal(classifyIntent("What's the weather in Tokyo?"), "document");
    assert.equal(classifyIntent("What is the capital of Mongolia?"), "document");
    assert.equal(classifyIntent("Explain how photosynthesis works."), "document");
  });

  it("still treats greetings as guide intents", () => {
    assert.equal(classifyIntent("hello"), "greeting");
  });
});

describe("evidence", () => {
  it("marks empty packs as insufficient", () => {
    const e = classifyEvidence({
      query: "What is the capital of Mongolia?",
      packed: [],
      ranked: [],
      signals: new Map(),
    });
    assert.equal(e.kind, "insufficient");
    assert.match(INSUFFICIENT_ANSWER, /Not in the indexed corpus/);
  });

  it("marks Redlock as negative evidence when the Redis guide is packed", () => {
    const redis = chunk({
      slug: "redis-cache",
      title: "Redis Cache Stampede and TTL Guide",
      text: "Use SET key:lock NX EX 10. Single-flight lock. TTL jitter.",
      score: 0.82,
    });
    const e = classifyEvidence({
      query: "Does the Redis guide recommend Redlock?",
      packed: [redis],
      ranked: [redis],
      signals: new Map(),
    });
    assert.equal(e.kind, "negative_not_found");
    assert.equal(e.probe, "redlock");
  });
});

describe("storage status", () => {
  it("disables dense on Vercel without DATABASE_URL", () => {
    const prevV = process.env.VERCEL;
    const prevD = process.env.DATABASE_URL;
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;
    try {
      const s = getStorageStatus();
      assert.equal(s.backend, "ephemeral");
      assert.equal(s.durable, false);
      assert.equal(s.denseAvailable, false);
    } finally {
      if (prevV === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevV;
      if (prevD === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevD;
    }
  });

  it("uses Neon when DATABASE_URL is set", () => {
    const prevV = process.env.VERCEL;
    const prevD = process.env.DATABASE_URL;
    process.env.VERCEL = "1";
    process.env.DATABASE_URL = "postgres://example";
    try {
      const s = getStorageStatus();
      assert.equal(s.backend, "neon");
      assert.equal(s.denseAvailable, true);
    } finally {
      if (prevV === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevV;
      if (prevD === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevD;
    }
  });
});
