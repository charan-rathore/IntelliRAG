import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Durable-path ingestion lifecycle qualification (PGlite, real transactions).
// Characterizes the pending -> partially embedded -> ready state machine the
// architecture review asked for: interrupted embedding must resume
// idempotently, a document must not present as indexed before every chunk
// carries an embedding, and re-import must reset readiness atomically.

delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.DATABASE_URL; // local PGlite path, not ephemeral memory

const store = await import("./store.server.ts");

const BODY_V1 =
  "Rate limiting controls how many tasks run at once. " +
  "The concurrency option caps parallel workers. ".repeat(120);
const BODY_V2 =
  "Backpressure stops producers when consumers fall behind. " +
  "A full queue rejects new work until space frees. ".repeat(120);

function staleReasonsOf(healths: Awaited<ReturnType<typeof store.listDocuments>>, slug: string) {
  const doc = healths.find((d) => d.slug === slug);
  assert.ok(doc, `document ${slug} should exist`);
  return doc;
}

describe("durable ingestion lifecycle", () => {
  before(async () => {
    await store.ensureSeedDocuments();
  });

  it("a fresh import is pending, never indexed, and resumes to ready idempotently", async () => {
    const slug = "lifecycle-basic";
    const up = await store.upsertDocument({
      title: "Lifecycle Basic",
      slugHint: slug,
      body: BODY_V1,
      sourceType: "markdown",
      sourceUri: "test://lifecycle-basic",
    });
    assert.ok(up.chunkCount > 1, "test body should produce several chunks");

    // pending state: chunks exist, none embedded, document not indexed
    let health = staleReasonsOf(await store.listDocuments(), slug);
    assert.equal(health.indexedAt, null);
    assert.ok(health.staleReasons.includes("never_indexed"));
    assert.equal(health.embeddedCount, 0);
    const pendingBefore = await store.pendingEmbeddingCount();
    assert.ok(pendingBefore >= up.chunkCount);

    // interrupted import: only the first chunk gets an embedding
    const chunks = (await store.loadSearchableChunks({ kind: "corpus", corpusId: up.corpusId }))
      .filter((r) => r.slug === slug);
    assert.equal(chunks.length, up.chunkCount);
    await store.saveChunkEmbeddings([
      { id: chunks[0]!.chunk.id, embedding: [0.1, 0.2], model: "gemini-embedding-2" },
    ]);
    health = staleReasonsOf(await store.listDocuments(), slug);
    assert.equal(health.indexedAt, null, "partial embedding must not mark the document indexed");
    assert.ok(health.staleReasons.includes("missing_embeddings"));
    assert.ok(health.staleReasons.includes("never_indexed"));

    // resume: embed the rest; only then may the document become ready
    await store.saveChunkEmbeddings(
      chunks.slice(1).map((c) => ({ id: c.chunk.id, embedding: [0.1, 0.2], model: "gemini-embedding-2" })),
    );
    health = staleReasonsOf(await store.listDocuments(), slug);
    assert.ok(health.indexedAt, "fully embedded document should be indexed");
    assert.ok(!health.staleReasons.includes("never_indexed"));
    assert.ok(!health.staleReasons.includes("missing_embeddings"));
    assert.equal(health.embeddedCount, up.chunkCount);

    // idempotent completion: saving the same embeddings again stays ready, no dup chunks
    await store.saveChunkEmbeddings(
      chunks.slice(1).map((c) => ({ id: c.chunk.id, embedding: [0.1, 0.2], model: "gemini-embedding-2" })),
    );
    const again = (await store.loadSearchableChunks({ kind: "corpus", corpusId: up.corpusId }))
      .filter((r) => r.slug === slug);
    assert.equal(again.length, up.chunkCount, "no duplicate chunks after re-saving embeddings");
  });

  it("re-importing the same body is a no-op skip; a changed body resets readiness", async () => {
    const slug = "lifecycle-reimport";
    const up1 = await store.upsertDocument({
      title: "Lifecycle Reimport",
      slugHint: slug,
      body: BODY_V1,
      sourceType: "markdown",
      sourceUri: "test://lifecycle-reimport",
    });
    const chunks = (await store.loadSearchableChunks({ kind: "corpus", corpusId: up1.corpusId }))
      .filter((r) => r.slug === slug);
    await store.saveChunkEmbeddings(
      chunks.map((c) => ({ id: c.chunk.id, embedding: [0.3, 0.4], model: "gemini-embedding-2" })),
    );
    let health = staleReasonsOf(await store.listDocuments(), slug);
    assert.ok(health.indexedAt);
    const indexedAtV1 = health.indexedAt;

    // same body again: skipped, version unchanged, still indexed
    const up2 = await store.upsertDocument({
      title: "Lifecycle Reimport",
      slugHint: slug,
      body: BODY_V1,
      sourceType: "markdown",
      sourceUri: "test://lifecycle-reimport",
    });
    assert.equal(up2.skipped, true);
    assert.equal(up2.version, up1.version);
    health = staleReasonsOf(await store.listDocuments(), slug);
    assert.equal(String(health.indexedAt), String(indexedAtV1), "no-op re-import must not reset readiness");

    // changed body: version bumps, embeddings cleared, readiness revoked
    const up3 = await store.upsertDocument({
      title: "Lifecycle Reimport",
      slugHint: slug,
      body: BODY_V2,
      sourceType: "markdown",
      sourceUri: "test://lifecycle-reimport",
    });
    assert.equal(up3.version, up1.version + 1);
    health = staleReasonsOf(await store.listDocuments(), slug);
    assert.equal(health.indexedAt, null, "changed body must revoke readiness until re-embedded");
    assert.ok(health.staleReasons.includes("never_indexed"));
    const reloaded = (await store.loadSearchableChunks({ kind: "corpus", corpusId: up1.corpusId }))
      .filter((r) => r.slug === slug);
    assert.ok(reloaded.length > 0);
    assert.ok(
      reloaded.every((r) => r.chunk.embedding === null),
      "replaced chunks must start unembedded (keyword-only until re-indexed)",
    );
    assert.ok(reloaded.every((r) => r.chunk.text.includes("Backpressure") || !r.chunk.text.includes("Rate limiting")),
      "searchable text must be the new body, not the old one");
  });
});
