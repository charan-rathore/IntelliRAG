import "./testing/close-database.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestText } from "./ingest.server.ts";
import { getDocumentBySlug, loadSearchableChunks } from "./store.server.ts";

const BODY = [
  "Metadata probe document without a heading of its own.",
  "",
  "A stable body used across re-ingestion metadata checks.",
  "It stays byte identical while title, filepath and kind change around it.",
  ...Array.from({ length: 12 }, (_, i) => `Filler sentence ${i + 1} keeps the document above the minimum size.`),
].join("\n");

async function chunksFor(docId: string) {
  const rows = await loadSearchableChunks({ kind: "all" });
  return rows.filter((r) => r.chunk.document_id === docId).map((r) => r.chunk);
}

describe("ingest skip path refreshes metadata", () => {
  it("refreshes the stored title when the same body is re-ingested under a new title", async () => {
    const first = await ingestText({ title: "Original Title", body: BODY, sourceType: "markdown", slugHint: "meta-refresh-title", sourceUri: "probe://meta-title" });
    const again = await ingestText({ title: "Better Title", body: BODY, sourceType: "markdown", slugHint: "meta-refresh-title", sourceUri: "probe://meta-title" });
    assert.equal(again.skipped, true, "identical body should still skip re-chunking");
    const stored = await getDocumentBySlug(first.slug);
    assert.equal(stored?.title, "Better Title");
    assert.equal(stored?.version, 1, "metadata refresh must not bump the version");
  });

  it("refreshes chunk filepath when the same body is re-ingested from a renamed file", async () => {
    const first = await ingestText({ title: "doc", body: BODY, sourceType: "github", slugHint: "meta-refresh-path", sourceUri: "probe://meta-path", filepath: "docs/old-name.md" });
    const before = await chunksFor(first.id);
    const again = await ingestText({ title: "doc", body: BODY, sourceType: "github", slugHint: "meta-refresh-path", sourceUri: "probe://meta-path", filepath: "docs/new-name.md" });
    assert.equal(again.skipped, true);
    const after = await chunksFor(first.id);
    assert.ok(after.length > 0);
    assert.ok(after.every((c) => c.filepath === "docs/new-name.md"), `stale filepath: ${after[0]?.filepath}`);
    assert.deepEqual(after.map((c) => c.id).sort(), before.map((c) => c.id).sort(), "metadata refresh must not re-chunk");
  });

  it("treats a language label change on prose as metadata, not a re-chunk", async () => {
    const first = await ingestText({ title: "prosedoc", body: BODY, sourceType: "github", slugHint: "meta-refresh-lang", sourceUri: "probe://meta-lang", chunkKind: "prose" });
    const before = await chunksFor(first.id);
    const again = await ingestText({ title: "prosedoc", body: BODY, sourceType: "github", slugHint: "meta-refresh-lang", sourceUri: "probe://meta-lang", chunkKind: "prose", language: "markdown" });
    assert.equal(again.skipped, true, "prose chunking does not depend on the language label");
    const after = await chunksFor(first.id);
    assert.ok(after.every((c) => c.language === "markdown"), `stale language: ${after[0]?.language}`);
    assert.deepEqual(after.map((c) => c.id).sort(), before.map((c) => c.id).sort(), "language label refresh must not re-chunk");
  });

  it("does NOT skip when the chunk kind changes, because chunking output differs", async () => {
    const first = await ingestText({ title: "kinddoc", body: BODY, sourceType: "github", slugHint: "meta-refresh-kind", sourceUri: "probe://meta-kind", chunkKind: "prose" });
    const again = await ingestText({ title: "kinddoc", body: BODY, sourceType: "github", slugHint: "meta-refresh-kind", sourceUri: "probe://meta-kind", chunkKind: "code", language: "markdown" });
    assert.equal(again.skipped, false, "a kind change must re-chunk, not skip");
    const after = await chunksFor(first.id);
    assert.ok(after.every((c) => c.chunk_kind === "code"));
  });
});
