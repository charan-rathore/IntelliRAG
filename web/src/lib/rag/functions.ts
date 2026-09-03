import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PLATFORM_AUDIT } from "./corpus";
import { loadLastEvalSummary } from "./eval.server";
import { graphSnapshot, recordOutcome } from "./graphify/persist.server";
import { embedPendingBatch, ingestFromUrl, ingestText } from "./ingest.server";
import { keyStatus, setMemoryKeys } from "./keys.server";
import {
  deleteDocument,
  getDocumentBySlug,
  listCorpora,
  listDocuments,
  pendingEmbeddingCount,
  recentTraces,
} from "./store.server";
import { EMBEDDING_MODEL, GENERATION_MODEL } from "./types";
import { getStorageStatus } from "./storage";

export const getLabSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const keys = keyStatus();
  const empty = {
    documents: [] as Awaited<ReturnType<typeof listDocuments>>,
    corpora: [] as Awaited<ReturnType<typeof listCorpora>>,
    pendingEmbeddings: 0,
    traces: [] as Awaited<ReturnType<typeof recentTraces>>,
    audit: PLATFORM_AUDIT,
    generationModel: GENERATION_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    lastEval: loadLastEvalSummary(),
    storage: getStorageStatus(),
    graph: {
      nodeCount: 0,
      edgeCount: 0,
      memoryCount: 0,
      cacheCount: 0,
      preferred: 0,
      contested: 0,
      nodes: [] as Awaited<ReturnType<typeof graphSnapshot>>["nodes"],
      links: [] as Awaited<ReturnType<typeof graphSnapshot>>["links"],
      learning: null as Awaited<ReturnType<typeof graphSnapshot>>["learning"],
    },
    ...keys,
  };
  try {
    const documents = await listDocuments();
    const corpora = await listCorpora();
    const pending = await pendingEmbeddingCount(EMBEDDING_MODEL);
    const traces = await recentTraces(6);
    const graph = await graphSnapshot();
    return { ...empty, documents, corpora, pendingEmbeddings: pending, traces, graph };
  } catch (err) {
    console.error("[intellirag] snapshot failed", err);
    return empty;
  }
});

export const saveLabKeys = createServerFn({ method: "POST" })
  .validator(
    z.object({
      gemini: z.string().max(2000).optional(),
      openrouter: z.string().max(2000).optional(),
      clearGemini: z.boolean().optional(),
      clearOpenRouter: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    return setMemoryKeys(data);
  });

export const ingestPastedDocument = createServerFn({ method: "POST" })
  .validator(
    z.object({
      title: z.string().min(1).max(160),
      body: z.string().min(40).max(60_000),
    }),
  )
  .handler(async ({ data }) => {
    return ingestText({
      title: data.title,
      body: data.body,
      sourceType: "markdown",
    });
  });

export const ingestRemoteUrl = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().url() }))
  .handler(async ({ data }) => {
    const remote = await ingestFromUrl(data.url);
    return remote;
  });

export const embedNextBatch = createServerFn({ method: "POST" })
  .validator(z.object({}))
  .handler(async () => {
    return embedPendingBatch();
  });

export const removeDocument = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await deleteDocument(data.id);
    return { ok: true as const };
  });

export const getSourceDocument = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const doc = await getDocumentBySlug(data.slug);
    if (!doc) return null;
    return {
      slug: doc.slug,
      title: doc.title,
      body: doc.body,
      sourceType: doc.source_type,
      sourceUri: doc.source_uri,
      version: doc.version,
      indexedAt: doc.indexed_at,
    };
  });

export const submitGraphFeedback = createServerFn({ method: "POST" })
  .validator(
    z.object({
      question: z.string().min(1).max(4000),
      outcome: z.enum(["useful", "dead_end", "corrected"]),
      correction: z.string().max(8000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    return recordOutcome({
      question: data.question,
      outcome: data.outcome,
      correction: data.correction,
    });
  });
