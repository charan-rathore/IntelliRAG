/**
 * Query orchestration. classifyIntent only routes greetings and capability
 * questions. Off-topic / ungrounded questions are decided after retrieval via
 * evidence classification — not a weather/joke/recipe regex. Insufficient
 * evidence yields the deterministic string “Not in the indexed corpus.”
 */
import { EXAMPLE_QUESTIONS } from "./corpus";
import { INSUFFICIENT_ANSWER, negativeAnswer } from "./evidence";
import { embedQuery, GeminiError, generationModelLabel, streamGenerate } from "./gemini.server";
import { bumpCacheHit, findCachedAnswer, saveQueryResult } from "./graphify/persist.server";
import { resolveRuntime } from "./keys.server";
import { classifyIntent } from "./intents";
import { buildContext, retrieve } from "./retrieve.server";
import type { RetrieveResult } from "./retrieve-core";
import { getStorageStatus } from "./storage";
import { listDocuments, pendingEmbeddingCount, recordTrace } from "./store.server";
import { coverageOf } from "./trace";
import { parseCorpusScope, SEED_CORPUS_ID } from "./corpus-scope";
import type {
  Citation,
  CoverageKind,
  DenseDiagnostics,
  EvidenceGate,
  EvidenceKind,
  LayerLatencies,
  RetrievalCandidate,
  RetrievedChunk,
  RetrievalMode,
  StorageStatus,
} from "./types";
import { EMBEDDING_MODEL } from "./types";
import { snippet } from "./text";

export type QueryEvent =
  | { type: "stage"; name: string }
  | {
      type: "sources";
      chunks: RetrievedChunk[];
      candidates: RetrievalCandidate[];
      pendingEmbeddings: number;
      contextTokens: number;
      dense?: DenseDiagnostics;
      evidence?: EvidenceKind;
      storage?: StorageStatus;
      scoreSemantics?: string;
      actualMode?: RetrievalMode;
      stages?: RetrieveResult["stages"];
      corpusId?: string | null;
      corpusScope?: "corpus" | "all";
      evidenceGate?: EvidenceGate;
    }
  | { type: "token"; text: string }
  | {
      type: "done";
      answer: string;
      refused: boolean;
      citations: Citation[];
      latencies: LayerLatencies;
      model: string;
      embeddingModel: string | null;
      intent: string;
      coverage: CoverageKind;
      candidates: RetrievalCandidate[];
      contextTokens: number;
      cacheHit?: boolean;
      graphSlugs?: string[];
      dense?: DenseDiagnostics;
      evidence?: EvidenceKind;
      storage?: StorageStatus;
      scoreSemantics?: string;
      actualMode?: RetrievalMode;
      stages?: RetrieveResult["stages"];
      corpusId?: string | null;
      corpusScope?: "corpus" | "all";
      evidenceGate?: EvidenceGate;
    }
  | { type: "error"; message: string };

function citationsFrom(answer: string, chunks: RetrievedChunk[]): Citation[] {
  const found = new Set<number>();
  const re = /\[Source\s+(\d+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer))) {
    found.add(Number(m[1]));
  }
  return [...found]
    .sort((a, b) => a - b)
    .map((n) => {
      const chunk = chunks[n - 1];
      if (!chunk) return null;
      return {
        sourceIndex: n,
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        title: chunk.title,
        textSnippet: snippet(chunk.text),
      };
    })
    .filter((c): c is Citation => Boolean(c));
}

function markCited(
  candidates: RetrievalCandidate[],
  citations: Citation[],
): RetrievalCandidate[] {
  const citedIds = new Set(citations.map((c) => c.chunkId));
  return candidates.map((c) => ({ ...c, cited: citedIds.has(c.chunkId) }));
}

function guideDone(
  answer: string,
  intent: string,
  latencies: LayerLatencies,
): Extract<QueryEvent, { type: "done" }> {
  return {
    type: "done",
    answer,
    refused: false,
    citations: [],
    latencies,
    model: "console-guide",
    embeddingModel: null,
    intent,
    coverage: "guide",
    candidates: [],
    contextTokens: 0,
  };
}

export async function runQueryStream(
  input: {
    question: string;
    retrievalMode?: RetrievalMode;
    topK?: number;
    skipCache?: boolean;
    corpus?: string | null;
  },
  emit: (event: QueryEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const started = performance.now();
  const question = input.question.trim();
  if (!question) {
    emit({ type: "error", message: "Ask a question first." });
    return;
  }
  const intent = classifyIntent(question);
  const corpusScope = parseCorpusScope(input.corpus);
  const corpusKey = corpusScope.kind === "all" ? "all" : corpusScope.corpusId;
  const documents = await listDocuments();
  const scopedDocuments =
    corpusScope.kind === "all" ? documents : documents.filter((d) => d.corpusId === corpusScope.corpusId);
  const storage = getStorageStatus();

  if (intent === "greeting") {
    emit(
      guideDone(
        "Hey — I’m IntelliRAG. Indexed runbooks cover Kubernetes, asyncio, databases, Docker, Git, Redis, HTTP caching, Linux, Node, and SRE. I cite those sources when retrieval finds support. Questions without corpus evidence are refused — I will not answer from model memory and pretend it was grounded.\n\nTry: “What caused the Kubernetes pod scheduling failures?”",
        intent,
        { guide: performance.now() - started },
      ),
    );
    return;
  }

  if (intent === "capability") {
    const lines = [
      "I answer from indexed lab docs with citations. If retrieval finds no supporting evidence, I say “Not in the indexed corpus.” and do not invent citations.",
      "",
      "Indexed sources:",
      ...scopedDocuments.map((d) => `- ${d.title} (${d.embeddedCount}/${d.chunkCount} chunks embedded)`),
      storage.warning ? `\nStorage: ${storage.warning}` : "",
      "",
      "Try:",
      ...EXAMPLE_QUESTIONS.slice(0, 3).map((q) => `“${q}”`),
    ];
    emit(guideDone(lines.filter(Boolean).join("\n"), intent, { guide: performance.now() - started }));
    return;
  }

  const graphLook = input.skipCache ? { hit: null, preferred: [] as string[] } : await findCachedAnswer(question, corpusKey);
  if (graphLook.hit?.answer) {
    const graphMs = performance.now() - started;
    emit({ type: "stage", name: "graph-cache" });
    const chunks = (graphLook.hit.chunks as RetrievedChunk[]) ?? [];
    const candidates = (graphLook.hit.candidates as RetrievalCandidate[]) ?? [];
    emit({
      type: "sources",
      chunks,
      candidates,
      pendingEmbeddings: await pendingEmbeddingCount(EMBEDDING_MODEL),
      contextTokens: graphLook.hit.contextTokens,
      storage,
    });
    emit({ type: "token", text: graphLook.hit.answer });
    await bumpCacheHit(graphLook.hit.questionHash);
    emit({
      type: "done",
      answer: graphLook.hit.answer,
      refused: false,
      citations: (graphLook.hit.citations as Citation[]) ?? [],
      latencies: { graph: graphMs },
      model: "graphify-cache",
      embeddingModel: EMBEDDING_MODEL,
      intent,
      coverage: (graphLook.hit.coverage as CoverageKind) || "grounded",
      candidates,
      contextTokens: graphLook.hit.contextTokens,
      cacheHit: true,
      graphSlugs: graphLook.hit.sourceSlugs,
      storage,
    });
    return;
  }

  const runtime = resolveRuntime();
  emit({ type: "stage", name: "retrieving" });

  const embedStart = performance.now();
  let queryVector: number[] | null = null;
  let embeddingModel: string | null = null;
  const requested = input.retrievalMode ?? "hybrid";
  const canDense = storage.denseAvailable && requested !== "keyword";

  if (canDense && runtime.embed) {
    try {
      const embedded = await embedQuery(question);
      queryVector = embedded.vector;
      embeddingModel = embedded.model;
    } catch (err) {
      if (requested === "dense") {
        const message = err instanceof GeminiError ? err.message : "Embedding failed";
        emit({ type: "error", message });
        return;
      }
    }
  }
  const embedMs = performance.now() - embedStart;

  const mode: RetrievalMode = queryVector && requested !== "keyword" ? requested : "keyword";
  const retrieved = await retrieve({
    query: question,
    queryVector,
    mode,
    topK: input.topK ?? 5,
    embeddingModel: embeddingModel ?? EMBEDDING_MODEL,
    preferredSlugs: graphLook.preferred,
    corpus: input.corpus ?? SEED_CORPUS_ID,
  });
  const pending = await pendingEmbeddingCount(EMBEDDING_MODEL);
  emit({
    type: "sources",
    chunks: retrieved.chunks,
    candidates: retrieved.candidates,
    pendingEmbeddings: pending,
    contextTokens: retrieved.contextTokens,
    dense: retrieved.dense,
    evidence: retrieved.evidence,
    storage,
    scoreSemantics: retrieved.trace.scoreSemantics,
    actualMode: retrieved.actualMode,
    stages: retrieved.stages,
    corpusId: retrieved.corpusId,
    corpusScope: retrieved.corpusScope,
    evidenceGate: retrieved.evidenceGate,
  });

  const evidenceKind = retrieved.evidence;

  if (evidenceKind === "insufficient" || retrieved.chunks.length === 0) {
    const answer = INSUFFICIENT_ANSWER;
    emit({ type: "token", text: answer });
    const latencies = {
      embed: embedMs,
      dense: retrieved.denseMs,
      keyword: retrieved.keywordMs,
      rerank: retrieved.rerankMs,
      assemble: retrieved.assembleMs,
      generate: 0,
    };
    await recordTrace({
      question,
      retrievalMode: retrieved.actualMode,
      answer,
      refused: true,
      model: "grounding-gate",
      embeddingModel: embeddingModel ?? "none",
      layerLatencies: latencies,
      citationCount: 0,
      totalLatencyMs: performance.now() - started,
    });
    emit({
      type: "done",
      answer,
      refused: true,
      citations: [],
      latencies,
      model: "grounding-gate",
      embeddingModel,
      intent,
      coverage: "refused",
      candidates: retrieved.candidates,
      contextTokens: 0,
      cacheHit: false,
      graphSlugs: graphLook.preferred,
      dense: retrieved.dense,
      evidence: "insufficient",
      storage,
      scoreSemantics: retrieved.trace.scoreSemantics,
      actualMode: retrieved.actualMode,
      stages: retrieved.stages,
      corpusId: retrieved.corpusId,
      corpusScope: retrieved.corpusScope,
      evidenceGate: retrieved.evidenceGate,
    });
    return;
  }

  if (!runtime.generate) {
    emit({
      type: "error",
      message:
        retrieved.dense.skippedReason
          ? `${retrieved.dense.skippedReason} Add a server-side Gemini or OpenRouter key to generate answers.`
          : "Retrieved sources are ready. Add a server-side Gemini or OpenRouter key in Settings to generate.",
    });
    return;
  }

  if (evidenceKind === "negative_not_found") {
    const answer = negativeAnswer(retrieved.chunks[0]!.title, retrieved.probe || "that");
    emit({ type: "token", text: answer });
    const citations = citationsFrom(answer, retrieved.chunks);
    const candidates = markCited(retrieved.candidates, citations);
    const latencies = {
      embed: embedMs,
      dense: retrieved.denseMs,
      keyword: retrieved.keywordMs,
      rerank: retrieved.rerankMs,
      assemble: retrieved.assembleMs,
      generate: 0,
    };
    await recordTrace({
      question,
      retrievalMode: retrieved.actualMode,
      answer,
      refused: false,
      model: "negative-evidence",
      embeddingModel: embeddingModel ?? "none",
      layerLatencies: latencies,
      citationCount: citations.length,
      totalLatencyMs: performance.now() - started,
    });
    emit({
      type: "done",
      answer,
      refused: false,
      citations,
      latencies,
      model: "negative-evidence",
      embeddingModel,
      intent,
      coverage: "grounded",
      candidates,
      contextTokens: retrieved.contextTokens,
      cacheHit: false,
      dense: retrieved.dense,
      evidence: "negative_not_found",
      storage,
      scoreSemantics: retrieved.trace.scoreSemantics,
      actualMode: retrieved.actualMode,
      stages: retrieved.stages,
      corpusId: retrieved.corpusId,
      corpusScope: retrieved.corpusScope,
      evidenceGate: retrieved.evidenceGate,
    });
    return;
  }

  emit({ type: "stage", name: "generating" });
  const promptKind = evidenceKind === "ambiguous" ? "ambiguous" : "positive";
  const { system, user } = buildContext(question, retrieved.chunks, promptKind);
  const genStart = performance.now();
  let answer = "";
  try {
    answer = await streamGenerate({
      system,
      user,
      signal,
      onToken: (text) => emit({ type: "token", text }),
    });
  } catch (err) {
    const message = err instanceof GeminiError ? err.message : "Generation failed";
    emit({ type: "error", message });
    return;
  }
  const generateMs = performance.now() - genStart;
  const ungrounded = /^not in the indexed corpus/i.test(answer.trim());
  const citations = ungrounded ? [] : citationsFrom(answer, retrieved.chunks);
  const candidates = markCited(retrieved.candidates, citations);
  const coverage = coverageOf({ refused: ungrounded, grounded: !ungrounded, answer });
  const latencies = {
    embed: embedMs,
    dense: retrieved.denseMs,
    keyword: retrieved.keywordMs,
    rerank: retrieved.rerankMs,
    assemble: retrieved.assembleMs,
    generate: generateMs,
  };
  const modelUsed = generationModelLabel(runtime.generate.provider);
  await recordTrace({
    question,
    retrievalMode: retrieved.actualMode,
    answer,
    refused: ungrounded,
    model: modelUsed,
    embeddingModel: embeddingModel ?? "none",
    layerLatencies: latencies,
    citationCount: citations.length,
    totalLatencyMs: performance.now() - started,
  });
  const sourceSlugs = [...new Set(retrieved.chunks.map((c) => c.slug))];
  const sourceNodes = sourceSlugs.map((s) => `doc:${s}`);
  await saveQueryResult({
    question,
    answer,
    sourceNodes,
    sourceSlugs,
    coverage,
    citations,
    candidates,
    chunks: retrieved.chunks,
    contextTokens: retrieved.contextTokens,
    corpusId: corpusKey,
  });
  emit({
    type: "done",
    answer,
    refused: ungrounded,
    citations,
    latencies,
    model: modelUsed,
    embeddingModel,
    intent,
    coverage: ungrounded ? "refused" : coverage,
    candidates,
    contextTokens: retrieved.contextTokens,
    cacheHit: false,
    graphSlugs: graphLook.preferred,
    dense: retrieved.dense,
    evidence: evidenceKind,
    storage,
    scoreSemantics: retrieved.trace.scoreSemantics,
    actualMode: retrieved.actualMode,
    stages: retrieved.stages,
    corpusId: retrieved.corpusId,
    corpusScope: retrieved.corpusScope,
    evidenceGate: retrieved.evidenceGate,
  });
}
