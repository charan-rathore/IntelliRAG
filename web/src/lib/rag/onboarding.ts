import type { CoverageKind, RetrievalCandidate } from "./types";

/** Guided empty-state demos. Keep questions in sync with intents + seed corpus. */
export type DemoRun = {
  id: string;
  question: string;
  kind: CoverageKind;
  audience: "SRE" | "RAG engineer";
  promise: string;
  expect: string;
  primary?: boolean;
};

export const DEMO_RUNS: DemoRun[] = [
  {
    id: "redis-stampede",
    question: "How do you stop a Redis cache stampede?",
    kind: "grounded",
    audience: "SRE",
    promise: "Cited lock and TTL from the Redis runbook. Unrelated Linux notes stay Inspect only.",
    expect: "Grounded · Used: redis-cache · SET NX EX",
    primary: true,
  },
  {
    id: "k8s-incident",
    question: "What caused the Kubernetes pod scheduling failures?",
    kind: "grounded",
    audience: "SRE",
    promise: "Root cause from the incident note, not a generic scheduler lecture.",
    expect: "Grounded · resource fragmentation",
  },
  {
    id: "weather-refuse",
    question: "What's the weather in Tokyo?",
    kind: "refused",
    audience: "RAG engineer",
    promise: "Off-corpus questions are refused after retrieval finds no support — not because of a weather regex.",
    expect: "Refused · not in indexed corpus",
  },
];

export const PRIMARY_DEMO = DEMO_RUNS.find((d) => d.primary) ?? DEMO_RUNS[0];

export const PIPELINE_STEPS = [
  { id: "ask", label: "Ask", detail: "A runbook question." },
  { id: "embed", label: "Embed", detail: "Same 768-d as the index." },
  { id: "hybrid", label: "Hybrid", detail: "Dense + BM25 + RRF." },
  { id: "pack", label: "Pack", detail: "Calibrated gate, not a fixed top-3." },
  { id: "answer", label: "Cite or refuse", detail: "Flash uses packed sources." },
] as const;

export const TRUST_MARKS = [
  { id: "same-model", label: "Same embedding model for index and query" },
  { id: "pack", label: "Dynamic context from calibrated scores, not a noisy top-k" },
  { id: "cite", label: "Citations, or an honest refusal" },
  { id: "keys", label: "API keys stay on the server" },
] as const;

export const RUN_STORY = [
  "You ask a runbook question.",
  "Hybrid retrieval scores every chunk (cosine, BM25, RRF, then a calibrated lexical/title mix — not a cross-encoder, not MMR).",
  "Context packing uses an absolute calibrated floor plus a relative drop vs rank-1. That is not “similarity ≥ 0.55”.",
  "Flash cites [Source N] only when evidence supports the claim. Otherwise: Not in the indexed corpus.",
  "Lab shows Used vs Inspect only, so you can see why a chunk was dropped.",
] as const;

export const COACH_COPY: Record<CoverageKind, { title: string; body: string }> = {
  grounded: {
    title: "That was a live retrieval, not a canned reply.",
    body: "Grounded means Flash only used the packed sources. Open Lab to see Used vs Inspect only — retrieved chunks that missed the score cliff never reach the model.",
  },
  general: {
    title: "Not in the indexed corpus.",
    body: "Flash answered from general knowledge and said so. A runbook question will pack sources and come back Grounded.",
  },
  refused: {
    title: "The lab refused instead of inventing an answer.",
    body: "Retrieval found no supporting evidence. The answer is Not in the indexed corpus — not a weather-keyword shortcut.",
  },
  guide: {
    title: "That was console help, not a retrieved answer.",
    body: "Ask a runbook question to watch hybrid retrieval pack three chunks and cite them.",
  },
};

function sampleCandidate(
  partial: Pick<
    RetrievalCandidate,
    | "chunkId"
    | "slug"
    | "title"
    | "text"
    | "score"
    | "rank"
    | "scores"
    | "usedInContext"
    | "overlapTerms"
    | "dropReason"
  >,
): RetrievalCandidate {
  return {
    documentId: `sample-${partial.slug}`,
    heading: null,
    retriever: "hybrid",
    tokenCount: 180,
    indexedAt: null,
    embeddingModel: "gemini-embedding-2",
    cited: partial.usedInContext,
    filepath: null,
    language: null,
    symbol: null,
    chunkKind: "prose",
    corpusId: "seed-lab",
    ranks: {
      dense: null,
      keyword: partial.rank,
      fused: null,
      rerank: partial.rank,
    },
    ...partial,
  };
}

/** Annotated sample so the empty Lab is not a blank page. Labeled in the UI as a sample. */
export const SAMPLE_TRACE_QUESTION = PRIMARY_DEMO.question;

export const SAMPLE_CANDIDATES: RetrievalCandidate[] = [
  sampleCandidate({
    chunkId: "sample-redis",
    slug: "redis-cache",
    title: "Redis Cache Stampede and TTL Guide",
    text: "Use SET key:lock NX EX to elect a single recompute. Stampede happens when a hot key expires and every client rebuilds it at once.",
    score: 0.93,
    rank: 1,
    scores: { dense: 0.84, keyword: 0.91, hybrid: 0.88, rerank: 0.93 },
    usedInContext: true,
    overlapTerms: ["redis", "stampede", "lock", "ttl"],
  }),
  sampleCandidate({
    chunkId: "sample-http",
    slug: "http-caching",
    title: "HTTP Caching and CDN Notes",
    text: "Cache-Control and CDN TTLs for immutable assets. Related to expiry, not a Redis stampede lock.",
    score: 0.41,
    rank: 2,
    scores: { dense: 0.38, keyword: 0.22, hybrid: 0.31, rerank: 0.41 },
    usedInContext: false,
    overlapTerms: ["cache", "ttl"],
    dropReason: "Below the relative floor vs rank-1 calibrated score — inspect only. Not an absolute 0.55 cosine cut.",
  }),
  sampleCandidate({
    chunkId: "sample-linux",
    slug: "linux-perf",
    title: "Linux Performance Tuning",
    text: "CPU steal, iowait, and vmstat. Lexical hit on “cache” from page cache, not Redis.",
    score: 0.16,
    rank: 3,
    scores: { dense: 0.21, keyword: 0.12, hybrid: 0.16, rerank: 0.11 },
    usedInContext: false,
    overlapTerms: ["cache"],
    dropReason: "No stampede overlap. Keyword score 0.12 — retrieved, then dropped.",
  }),
];
