// Real-model smoke for the local-embedding integration. OPT-IN, manual:
//   cd web && npx tsx scripts/smoke-local-embed.mts
// Downloads the bge-small model (~30MB q8) on first run, uses an isolated
// throwaway file-backed PGLite under /tmp, and needs no API key or account.
(globalThis as any).__intelliragPgliteTestDir = "/tmp/smoke-pglite-" + Date.now();
const { ingestText, embedPendingBatch } = await import("../src/lib/rag/ingest.server.ts");
const { retrieve } = await import("../src/lib/rag/retrieve.server.ts");
const { localEmbed, LOCAL_EMBED_MODEL } = await import("../src/lib/rag/local-embed.server.ts");

const t0 = performance.now();
const [probe] = await localEmbed(["smoke probe"], "query");
console.log("model loaded, dims:", probe?.length, "download+load ms:", Math.round(performance.now() - t0));

const doc = await ingestText({
  title: "Rotating API keys",
  body: "To rotate an API key, create a replacement key first, deploy it, then revoke the old key. Rotation without overlap causes downtime. Keys rotated quarterly reduce exposure windows significantly.",
  sourceType: "markdown",
});
console.log("ingested:", JSON.stringify({slug: doc.slug, corpusId: doc.corpusId}));

const batch = await embedPendingBatch();
console.log("embed batch:", JSON.stringify(batch));
if (batch.model !== "Xenova/bge-small-en-v1.5") throw new Error("expected local model, got " + batch.model);
if (batch.embedded < 1) throw new Error("nothing embedded");

const [qv] = await localEmbed(["how do I rotate an api key"], "query");
const result = await retrieve({
  query: "how do I rotate an api key",
  queryVector: Array.from(qv!),
  mode: "hybrid",
  topK: 5,
  embeddingModel: LOCAL_EMBED_MODEL,
  preferredSlugs: [],
  corpus: doc.corpusId,
});
console.log("retrieval stages dense hits:", result.stages.dense.length, "top chunk:", result.chunks[0]?.slug, result.chunks[0]?.retriever, result.chunks[0]?.score.toFixed(3));
console.log("dense diagnostics:", JSON.stringify(result.dense));
if (!result.stages.dense.length) throw new Error("dense stage empty - integration not live");
console.log("SMOKE PASS");
