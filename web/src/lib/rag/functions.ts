import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PLATFORM_AUDIT } from "./corpus";
import { loadLastEvalSummary } from "./eval.server";
import { graphSnapshot, recordOutcome, recordSourcePick } from "./graphify/persist.server";
import { embedPendingBatch, ingestFromUrl, ingestText } from "./ingest.server";
import { keyStatus, resolveRuntime, setMemoryKeys } from "./keys.server";
import { selectedEmbedModel } from "./local-embed.server";
import {
  deleteDocument,
  getDocumentBySlug,
  listCorpora,
  listDocuments,
  pendingEmbeddingCount,
  recentTraces,
} from "./store.server";
import { listSuggestedQuestions } from "./suggested-questions.server";
import { EMBEDDING_MODEL, GENERATION_MODEL } from "./types";
import { getStorageStatus } from "./storage";
import { REPO_DEMO_CORPUS } from "./repo-demo";
import { assertCustomSourcesAllowed, assertVisitorKeysAllowed } from "./deployment-mode";
import { currentPosture } from "./deployment-posture.server";

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
    lastEval: await loadLastEvalSummary(),
    storage: getStorageStatus(),
    deployment: currentPosture(),
    suggestions: [] as Awaited<ReturnType<typeof listSuggestedQuestions>>,
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
    const pending = await pendingEmbeddingCount(selectedEmbedModel(Boolean(resolveRuntime().embed)));
    const traces = await recentTraces(6);
    const graph = await graphSnapshot();
    const suggestions = await listSuggestedQuestions(REPO_DEMO_CORPUS, 6);
    return { ...empty, documents, corpora, pendingEmbeddings: pending, traces, graph, suggestions };
  } catch (err) {
    console.error("[intellirag] snapshot failed", err);
    return empty;
  }
});

export const getCorpusSuggestions = createServerFn({ method: "GET" })
  .validator(z.object({ corpusId: z.string().min(1).max(500), limit: z.number().int().min(3).max(12).optional() }))
  .handler(async ({ data }) => {
    return listSuggestedQuestions(data.corpusId, data.limit ?? 6);
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
    if (data.gemini || data.openrouter) {
      assertVisitorKeysAllowed(currentPosture(), "Adding a model key");
    }
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
    assertCustomSourcesAllowed(currentPosture(), "Importing a source");
    return ingestText({
      title: data.title,
      body: data.body,
      sourceType: "markdown",
    });
  });

export const ingestRemoteUrl = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().url() }))
  .handler(async ({ data }) => {
    assertCustomSourcesAllowed(currentPosture(), "Importing a source");
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
    assertCustomSourcesAllowed(currentPosture(), "Removing a source");
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

export const searchSources = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().trim().min(1).max(500), corpus: z.string().max(600).nullable().optional(), limit: z.number().int().min(1).max(50).optional() }))
  .handler(async ({ data }) => {
    const { searchCorpus } = await import("./search.server");
    return searchCorpus({ q: data.q, corpus: data.corpus ?? null, limit: data.limit });
  });

export const suggestSearch = createServerFn({ method: "GET" })
  .validator(z.object({ prefix: z.string().max(200), corpus: z.string().max(600).nullable().optional() }))
  .handler(async ({ data }) => {
    const { suggestCorpus } = await import("./search.server");
    return suggestCorpus({ prefix: data.prefix, corpus: data.corpus ?? null });
  });

export const submitSourcePick = createServerFn({ method: "POST" })
  .validator(
    z.object({
      question: z.string().min(1).max(4000),
      corpusId: z.string().max(500),
      chunkId: z.string().min(1).max(500),
      text: z.string().min(1).max(40000),
    }),
  )
  .handler(async ({ data }) => {
    const out = await recordSourcePick(data);
    if (data.corpusId) {
      const { maybeSleep } = await import("./sleep.server");
      await maybeSleep(data.corpusId);
    }
    return out;
  });

/** What a corpus has learned: wake memory, sleep cycles, case memory. */
export const getCorpusMemory = createServerFn({ method: "GET" })
  .validator(z.object({ corpusId: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const { corpusMemory } = await import("./graphify/persist.server");
    const { SLEEP_EVERY } = await import("./sleep.server");
    const m = await corpusMemory(data.corpusId);
    const entries = Object.values(m.experience.entries).filter((e) => e.corpusId === data.corpusId);
    const asked = entries.flatMap((e) => e.asked.map((a) => ({ ...a, chunkId: e.chunkId })));
    return {
      wake: {
        confirmed: asked.filter((a) => !a.by && a.vote > 0).length,
        deadEnds: asked.filter((a) => !a.by && a.vote < 0).length,
        dreams: asked.filter((a) => a.by === "dream").length,
        passages: entries.length,
        recent: asked.filter((a) => !a.by).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6).map((a) => ({ q: a.q, vote: a.vote, at: a.at })),
      },
      sleeps: (m.journal?.cycles ?? []).slice(-8),
      totals: m.journal?.totals ?? {},
      cases: { count: m.cases.cases.length, weights: m.cases.weights, journal: m.cases.journal.slice(-6) },
      sinceSleep: m.sinceSleep,
      sleepEvery: SLEEP_EVERY,
    };
  });

/** Sleep now: replay, consolidate, dream, filter, journal. */
export const runSleep = createServerFn({ method: "POST" })
  .validator(z.object({ corpusId: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const { sleepCorpus } = await import("./sleep.server");
    return sleepCorpus(data.corpusId);
  });

export const submitGraphFeedback = createServerFn({ method: "POST" })
  .validator(
    z.object({
      question: z.string().min(1).max(4000),
      outcome: z.enum(["useful", "dead_end", "corrected"]),
      correction: z.string().max(8000).optional(),
      corpusId: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const snapshot = await recordOutcome({
      question: data.question,
      outcome: data.outcome,
      correction: data.correction,
      corpusId: data.corpusId,
    });
    if (data.corpusId) {
      const { maybeSleep } = await import("./sleep.server");
      await maybeSleep(data.corpusId);
    }
    return snapshot;
  });
