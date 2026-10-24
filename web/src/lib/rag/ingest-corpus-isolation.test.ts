import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestText } from "./ingest.server.ts";
import { getDocumentBySlug } from "./store.server.ts";

function body(anchor: string) {
  return [
    `Document anchored by ${anchor}.`,
    "",
    "Shared structural content so both imports look alike apart from their anchor.",
    ...Array.from({ length: 12 }, (_, i) => `Common filler sentence ${i + 1} about import hygiene.`),
  ].join("\n");
}

// Unique per run so the suite is idempotent against the persisted local
// stores (PGlite data dir and the memory tmp file both survive reruns).
const RUN = Math.random().toString(36).slice(2, 8);

describe("cross-corpus slug isolation", () => {
  it("two sources with the same slug hint become two documents, not one clobbered row", async () => {
    const a = await ingestText({ title: "Guide", body: body("anchor-alpine"), sourceType: "url", slugHint: `shared-guide-${RUN}`, sourceUri: `https://93.184.216.34/guide-a-${RUN}` });
    const b = await ingestText({ title: "Guide", body: body("anchor-boreal"), sourceType: "url", slugHint: `shared-guide-${RUN}`, sourceUri: `https://8.8.8.8/guide-b-${RUN}` });
    assert.notEqual(a.id, b.id, "second import must not hijack the first document's row");
    assert.notEqual(a.slug, b.slug, "second import must get a disambiguated slug");
    const docA = await getDocumentBySlug(a.slug);
    const docB = await getDocumentBySlug(b.slug);
    assert.ok(docA?.body.includes("anchor-alpine"), "first document lost its body");
    assert.ok(docB?.body.includes("anchor-boreal"), "second document lost its body");
    assert.notEqual(docA?.corpus_id, docB?.corpus_id, "different source URLs should land in different corpora");
  });

  it("re-ingesting one source updates only its own document", async () => {
    const a = await ingestText({ title: "Guide", body: body("anchor-cinder"), sourceType: "url", slugHint: `shared-guide-2-${RUN}`, sourceUri: `https://93.184.216.34/guide-c-${RUN}` });
    const b = await ingestText({ title: "Guide", body: body("anchor-delta"), sourceType: "url", slugHint: `shared-guide-2-${RUN}`, sourceUri: `https://8.8.8.8/guide-d-${RUN}` });
    const a2 = await ingestText({ title: "Guide", body: body("anchor-cinder-v2"), sourceType: "url", slugHint: `shared-guide-2-${RUN}`, sourceUri: `https://93.184.216.34/guide-c-${RUN}` });
    assert.equal(a2.id, a.id);
    assert.equal(a2.version, 2);
    const docB = await getDocumentBySlug(b.slug);
    assert.ok(docB?.body.includes("anchor-delta"), "unrelated document was rewritten by another source's re-ingest");
    assert.equal(docB?.version, 1);
  });
});
