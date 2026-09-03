import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import {
  ensureSeedDocuments,
  memoryTmpPath,
  resetMemoryForTests,
  saveChunkEmbeddings,
  loadSearchableChunks,
  listDocuments,
} from "./memory.server.ts";

describe("memory corpus persistence", () => {
  it("round-trips embeddings across a simulated cold start when durable", () => {
    const prevV = process.env.VERCEL;
    const prevD = process.env.DATABASE_URL;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.DATABASE_URL;
    resetMemoryForTests();
    try {
      unlinkSync(memoryTmpPath());
    } catch {
      // missing is fine
    }
    mkdirSync(dirname(memoryTmpPath()), { recursive: true });

    return (async () => {
      await ensureSeedDocuments();
      const before = await loadSearchableChunks();
      const target = before[0]!;
      await saveChunkEmbeddings([
        { id: target.chunk.id, embedding: [0.1, 0.2, 0.3], model: "gemini-embedding-2" },
      ]);
      resetMemoryForTests();
      const after = await loadSearchableChunks();
      const again = after.find((r) => r.chunk.id === target.chunk.id);
      assert.ok(again);
      assert.equal(again!.chunk.embedding, JSON.stringify([0.1, 0.2, 0.3]));
      const docs = await listDocuments();
      const health = docs.find((d) => d.id === target.chunk.document_id);
      assert.ok((health?.embeddedCount ?? 0) >= 1);
    })().finally(() => {
      resetMemoryForTests();
      if (prevV === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevV;
      if (prevD === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevD;
    });
  });

  it("does not expose embeddings in corpus health on ephemeral Vercel", async () => {
    const prevV = process.env.VERCEL;
    const prevD = process.env.DATABASE_URL;
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;
    resetMemoryForTests();
    try {
      await ensureSeedDocuments();
      const rows = await loadSearchableChunks();
      await saveChunkEmbeddings([
        { id: rows[0]!.chunk.id, embedding: [1, 2, 3], model: "gemini-embedding-2" },
      ]);
      const docs = await listDocuments();
      assert.ok(docs.every((d) => d.embeddedCount === 0));
      assert.ok(docs.every((d) => d.staleReasons.includes("ephemeral_storage")));
      const loaded = await loadSearchableChunks();
      assert.ok(loaded.every((r) => r.chunk.embedding == null));
    } finally {
      resetMemoryForTests();
      if (prevV === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevV;
      if (prevD === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevD;
    }
  });
});
