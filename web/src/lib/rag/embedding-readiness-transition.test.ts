import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBEDDING_MODEL } from "./types";

delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.DATABASE_URL;
const store = await import("./store.server");

async function document(slug: string) {
  const up = await store.upsertDocument({
    title: slug,
    slugHint: slug,
    body: "Queue backpressure prevents producers overwhelming workers. ".repeat(180),
    sourceType: "markdown",
    sourceUri: `test://${slug}`,
  });
  const rows = (await store.loadSearchableChunks({ kind: "corpus", corpusId: up.corpusId })).filter(
    (r) => r.chunk.document_id === up.id,
  );
  assert.ok(rows.length > 1);
  return { up, rows };
}

test("partial model replacement revokes an earlier complete indexing claim", async () => {
  const { up, rows } = await document("model-readiness");
  await store.saveChunkEmbeddings(
    rows.map((r) => ({ id: r.chunk.id, embedding: [0.1, 0.2], model: EMBEDDING_MODEL })),
  );
  assert.ok((await store.getDocumentBySlug(up.slug))?.indexed_at);
  await store.saveChunkEmbeddings([
    { id: rows[0]!.chunk.id, embedding: [0.3, 0.4], model: "replacement-model" },
  ]);
  const changed = await store.getDocumentBySlug(up.slug);
  assert.equal(changed?.embedding_model, null);
  assert.equal(changed?.indexed_at, null);
});

test("mixed-model batches mark each complete document with its actual model", async () => {
  const a = await document("batch-model-a");
  const b = await document("batch-model-b");
  await store.saveChunkEmbeddings([
    ...a.rows.map((r) => ({ id: r.chunk.id, embedding: [0.1, 0.2], model: "model-a" })),
    ...b.rows.map((r) => ({ id: r.chunk.id, embedding: [0.3, 0.4], model: "model-b" })),
  ]);
  assert.equal((await store.getDocumentBySlug(a.up.slug))?.embedding_model, "model-a");
  assert.equal((await store.getDocumentBySlug(b.up.slug))?.embedding_model, "model-b");
  assert.ok((await store.getDocumentBySlug(b.up.slug))?.indexed_at);
});

test("a metadata write failure rolls back every chunk in the embedding batch", async () => {
  const { up, rows } = await document("atomic-embedding-failure");
  const { getSql } = await import("../db");
  const sql = await getSql();
  await sql.query(`create function reject_readiness() returns trigger language plpgsql as $$
    begin raise exception 'injected readiness failure'; end $$`);
  await sql.query(`create trigger reject_readiness before update on documents
    for each row execute function reject_readiness()`);
  try {
    await assert.rejects(
      store.saveChunkEmbeddings(
        rows.map((r) => ({
          id: r.chunk.id,
          embedding: [0.1, 0.2],
          model: "atomic-model",
        })),
      ),
      /injected readiness failure/,
    );
  } finally {
    await sql.query("drop trigger reject_readiness on documents");
    await sql.query("drop function reject_readiness()");
  }
  const after = await sql<{
    embedding: string | null;
  }>`select embedding from chunks where document_id = ${up.id}`;
  assert.ok(after.every((r) => r.embedding === null));
  assert.equal((await store.getDocumentBySlug(up.slug))?.indexed_at, null);
});

test("duplicate ids retain last nonempty update and unknown ids do not affect readiness", async () => {
  const { up, rows } = await document("duplicate-embedding-update");
  await store.saveChunkEmbeddings([
    ...rows.map((r) => ({ id: r.chunk.id, embedding: [0.1, 0.2], model: "earlier-model" })),
    ...rows.map((r) => ({ id: r.chunk.id, embedding: [0.3, 0.4], model: "latest-model" })),
    { id: rows[0]!.chunk.id, embedding: [], model: "ignored-empty" },
    { id: "not-a-real-chunk", embedding: [0.1], model: "unknown-model" },
  ]);
  assert.equal((await store.getDocumentBySlug(up.slug))?.embedding_model, "latest-model");
  assert.ok((await store.getDocumentBySlug(up.slug))?.indexed_at);
});

test("concurrent partial batches converge on one complete readiness marker", async () => {
  const { up, rows } = await document("concurrent-embedding-update");
  await Promise.all(
    rows.map((r) =>
      store.saveChunkEmbeddings([
        { id: r.chunk.id, embedding: [0.1, 0.2], model: "concurrent-model" },
      ]),
    ),
  );
  const ready = await store.getDocumentBySlug(up.slug);
  assert.equal(ready?.embedding_model, "concurrent-model");
  assert.ok(ready?.indexed_at);
});

test("direct chunk replacement clears readiness, including an empty replacement", async () => {
  const { up, rows } = await document("direct-replacement-readiness");
  await store.saveChunkEmbeddings(
    rows.map((r) => ({ id: r.chunk.id, embedding: [0.1, 0.2], model: "ready-model" })),
  );
  assert.ok((await store.getDocumentBySlug(up.slug))?.indexed_at);
  await store.replaceChunks(up.id, "Replacement content. ".repeat(180), undefined, up.corpusId);
  assert.equal((await store.getDocumentBySlug(up.slug))?.indexed_at, null);
  const replacement = (
    await store.loadSearchableChunks({ kind: "corpus", corpusId: up.corpusId })
  ).filter((r) => r.chunk.document_id === up.id);
  await store.saveChunkEmbeddings(
    replacement.map((r) => ({ id: r.chunk.id, embedding: [0.2, 0.3], model: "ready-model" })),
  );
  assert.ok((await store.getDocumentBySlug(up.slug))?.indexed_at);
  assert.equal(await store.replaceChunks(up.id, "", undefined, up.corpusId), 0);
  assert.equal((await store.getDocumentBySlug(up.slug))?.embedding_model, null);
  assert.equal((await store.getDocumentBySlug(up.slug))?.indexed_at, null);
});
