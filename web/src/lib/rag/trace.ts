import { tokenize } from "./text";
import type {
  CoverageKind,
  LayerLatencies,
  RetrievalCandidate,
  RetrievalMode,
  RetrievalStageScores,
  RetrievalTrace,
} from "./types";

const STOP = new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "are",
  "was",
  "were",
  "into",
  "your",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "do",
  "does",
  "is",
  "it",
  "as",
]);

export function overlapTerms(query: string, text: string, limit = 5): string[] {
  const q = tokenize(query).filter((t) => t.length > 2 && !STOP.has(t));
  const doc = new Set(tokenize(text));
  const hits: string[] = [];
  for (const t of q) {
    if (doc.has(t) && !hits.includes(t)) hits.push(t);
    if (hits.length >= limit) break;
  }
  return hits;
}

export function normalizeMap(values: Map<string, number>, id: string): number | null {
  const raw = values.get(id);
  if (raw == null) return null;
  let max = 0;
  for (const v of values.values()) if (v > max) max = v;
  if (max <= 0) return 0;
  return raw / max;
}

export function scoresFor(
  id: string,
  dense: Map<string, number>,
  keyword: Map<string, number>,
  hybrid: Map<string, number>,
  rerank: Map<string, number>,
): RetrievalStageScores {
  return {
    dense: dense.has(id) ? dense.get(id)! : null,
    keyword: keyword.has(id) ? keyword.get(id)! : null,
    hybrid: hybrid.has(id) ? hybrid.get(id)! : null,
    rerank: rerank.has(id) ? rerank.get(id)! : null,
  };
}

export function dropReason(opts: {
  usedInContext: boolean;
  afterCliff: boolean;
  afterMmr: boolean;
}): string | undefined {
  if (opts.usedInContext) return undefined;
  if (!opts.afterCliff) return "Below the rank-1 score cliff — kept for inspection, not sent to Flash";
  if (!opts.afterMmr) return "Outside the top context window (retrieve many, generate from few)";
  return "Outside the context token budget";
}

export function coverageOf(opts: {
  refused: boolean;
  grounded: boolean;
  answer: string;
}): CoverageKind {
  if (opts.refused) return "refused";
  if (/^not in the indexed corpus/i.test(opts.answer.trim())) return "refused";
  if (opts.grounded) return "grounded";
  return "refused";
}

export function bottleneckOf(latencies: LayerLatencies): keyof LayerLatencies | null {
  let best: keyof LayerLatencies | null = null;
  let max = -1;
  for (const [k, v] of Object.entries(latencies)) {
    if (typeof v === "number" && v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

export function buildTrace(opts: {
  query: string;
  mode: RetrievalMode;
  candidates: RetrievalCandidate[];
  usedCount: number;
}): RetrievalTrace {
  return {
    query: opts.query,
    mode: opts.mode,
    candidateCount: opts.candidates.length,
    usedCount: opts.usedCount,
    candidates: opts.candidates,
  };
}
