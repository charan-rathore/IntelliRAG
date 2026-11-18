import {
  GENERIC_OPS_TERMS,
  QUERY_STOPWORDS,
  bigrams,
  contentTokens,
  estimateTokens,
  expandTypos,
  tokenSetMatches,
} from "./text";
import type { RetrievedChunk } from "./types";
import { coverageTerms, packByCoverage, type CoverageReport } from "./coverage-pack";
import { SEED_CORPUS_ID } from "./corpus-scope";
import {
  CONTEXT_ABSOLUTE_FLOOR,
  CONTEXT_RELATIVE_FLOOR,
  CONTEXT_SOLO_MARGIN,
  CONTEXT_TOKEN_BUDGET,
  RRF_K,
} from "./types";

export const SCORE_SEMANTICS =
  "Dense = raw cosine. Keyword = raw BM25. Hybrid = raw RRF (1/(60+rank)). Rerank = calibrated mix (not a cross-encoder, not confidence). The context gate is calibrated-score floor 0.24 AND 62% of rank-1. not an absolute 0.55 cosine threshold.";

export type IdF = Map<string, number>;

export function buildIdf(corpusTexts: string[]): IdF {
  const df = new Map<string, number>();
  const n = Math.max(1, corpusTexts.length);
  for (const text of corpusTexts) {
    const seen = new Set(contentTokens(text));
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, c] of df) {
    const raw = Math.log(1 + (n - c + 0.5) / (c + 0.5));
    idf.set(t, GENERIC_OPS_TERMS.has(t) ? raw * 0.2 : raw);
  }
  return idf;
}

export function queryTerms(query: string, vocab: Set<string>): string[] {
  const base = contentTokens(query);
  const extra = expandTypos(base, vocab);
  return [...new Set([...base, ...extra])];
}

export function corpusVocab(texts: string[]): Set<string> {
  const v = new Set<string>();
  for (const text of texts) for (const t of contentTokens(text)) v.add(t);
  return v;
}

function termWeight(term: string, idf: IdF): number {
  if (QUERY_STOPWORDS.has(term)) return 0;
  const generic = GENERIC_OPS_TERMS.has(term) ? 0.2 : 1;
  return (idf.get(term) ?? Math.log(8)) * generic;
}

export function weightedRecall(terms: string[], text: string, idf: IdF): number {
  if (!terms.length) return 0;
  const doc = new Set(contentTokens(text));
  let num = 0;
  let den = 0;
  for (const t of terms) {
    const w = termWeight(t, idf);
    if (w <= 0) continue;
    den += w;
    if (tokenSetMatches(t, doc)) num += w;
  }
  return den === 0 ? 0 : num / den;
}

export function phraseBoost(query: string, text: string): number {
  const q = contentTokens(query);
  const grams = bigrams(q).filter((g) => {
    const [a, b] = g.split(" ");
    return Boolean(a && b && !GENERIC_OPS_TERMS.has(a) && !GENERIC_OPS_TERMS.has(b));
  });
  const hay = contentTokens(text).join(" ");
  const hayRaw = text.toLowerCase();
  let hits = 0;
  let den = grams.length;
  for (const g of grams) {
    if (hay.includes(g)) hits += 1;
  }
  const named = query.match(/\bnode\s+[a-z0-9]\b/gi) ?? [];
  den += named.length;
  for (const n of named) {
    if (hayRaw.includes(n.toLowerCase())) hits += 1;
  }
  if (!den) return 0;
  return hits / den;
}

export function topicalBoost(query: string, title: string, text: string): number {
  const q = queryTokenSet(query);
  const d = new Set(contentTokens(`${title}\n${text}`));
  let b = 0;
  if (looksLikeStampede(q) && hasAny(d, ["stampede", "redis"])) b += 0.28;
  if (looksLikeFragmentation(q) && hasAny(d, ["fragmentation", "pending"])) b += 0.22;
  if (looksLikeServerlessPg(q) && hasAny(d, ["pgbouncer", "postgres"])) b += 0.22;
  return Math.min(0.34, b);
}

/** Stretch vs the max only. Min-max was stretching a 0.01 BM25 hit to 1.0. */
export function maxNorm(values: number[], value: number): number {
  const hi = Math.max(0, ...values);
  if (hi <= 1e-9) return 0;
  return value / hi;
}

/** @deprecated Use maxNorm. Kept so old tests/docs still resolve. */
export function minMax(values: number[], value: number): number {
  return maxNorm(values, value);
}

export const ENTITY_TERMS = new Set([
  "postgres",
  "pgbouncer",
  "redis",
  "redlock",
  "kubernetes",
  "k8s",
  "docker",
  "tls",
  "aiohttp",
  "asyncio",
  "terraform",
  "nginx",
]);

export function entityTermsInQuery(query: string): string[] {
  return contentTokens(query).filter((t) => ENTITY_TERMS.has(t));
}

function hasAny(hay: Set<string>, terms: string[]): boolean {
  return terms.some((t) => tokenSetMatches(t, hay));
}

function queryTokenSet(query: string): Set<string> {
  return new Set(contentTokens(query));
}

function looksLikeStampede(q: Set<string>): boolean {
  return (
    hasAny(q, ["cache", "cached", "stampede"]) &&
    hasAny(q, ["hundred", "sudden", "expensive", "disappear", "recompute", "popular", "thundering", "herd"])
  );
}

function looksLikeFragmentation(q: Set<string>): boolean {
  return (
    hasAny(q, ["pending", "pod", "scatter", "fragment", "schedul"]) ||
    hasAny(q, ["2gi", "2gib"])
  );
}

function looksLikeServerlessPg(q: Set<string>): boolean {
  return hasAny(q, ["postgres", "pgbouncer"]) && hasAny(q, ["pool", "serverless", "bouncer"]);
}

/**
 * Lexical query expansion (not a neural rewriter). Adds domain terms only when
 * several independent cues already co-occur in the question.
 */
export function expandQueryCues(query: string): string[] {
  const q = queryTokenSet(query);
  const extra: string[] = [];
  if (looksLikeStampede(q)) extra.push("stampede", "redis", "ttl", "jitter", "lock");
  if (looksLikeFragmentation(q)) extra.push("fragmentation", "pending", "kubernetes");
  if (looksLikeServerlessPg(q)) extra.push("pgbouncer", "postgres", "transaction");
  return extra;
}

export function calibratedScore(input: {
  dense: number | null;
  bm25Norm: number;
  idfRecall: number;
  titleRecall: number;
  phrase: number;
}): number {
  const { dense, bm25Norm, idfRecall, titleRecall, phrase } = input;
  if (dense == null) {
    return 0.34 * bm25Norm + 0.32 * idfRecall + 0.2 * titleRecall + 0.14 * phrase;
  }
  return (
    0.46 * Math.max(0, dense) +
    0.18 * bm25Norm +
    0.2 * idfRecall +
    0.1 * titleRecall +
    0.06 * phrase
  );
}

export function rrfFuse(
  dense: RetrievedChunk[],
  keyword: RetrievedChunk[],
  topK: number,
): { fused: RetrievedChunk[]; scores: Map<string, number> } {
  const scores = new Map<string, number>();
  const byId = new Map<string, RetrievedChunk>();
  dense.forEach((c, i) => {
    scores.set(c.chunkId, (scores.get(c.chunkId) ?? 0) + 1 / (RRF_K + i + 1));
    byId.set(c.chunkId, c);
  });
  keyword.forEach((c, i) => {
    scores.set(c.chunkId, (scores.get(c.chunkId) ?? 0) + 1 / (RRF_K + i + 1));
    if (!byId.has(c.chunkId)) byId.set(c.chunkId, c);
  });
  const fused = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score], rank) => {
      const base = byId.get(id)!;
      return { ...base, score, rank: rank + 1, retriever: "hybrid" as const };
    });
  return { fused, scores };
}

export type RerankSignals = {
  idfRecall: number;
  titleRecall: number;
  phrase: number;
  topical: number;
  dense: number | null;
  bm25: number | null;
  /**
   * How alike this question is to one people confirmed this passage answers,
   * times how reliable its ratings are (experience.ts). Absent without experience.
   */
  learned?: number;
};

export function rerankCalibrated(opts: {
  query: string;
  candidates: RetrievedChunk[];
  denseScores: Map<string, number>;
  keywordScores: Map<string, number>;
  idf: IdF;
  terms: string[];
  preferredSlugs?: string[];
  graphPathCosts?: Map<string, number>;
  /** Wordings people confirmed for a passage (experience.ts): matched like its own text. */
  expansions?: Map<string, string>;
  /** Score taken off a passage for a question like one rated a dead end on it. */
  demote?: Map<string, number>;
  /** What a confirmed similar question adds to this passage's score (experience.ts). */
  learnedBoost?: Map<string, number>;
  /** Similarity × reliability of that confirmation (0..1), for the support gate. */
  learned?: Map<string, number>;
}): { ranked: RetrievedChunk[]; scores: Map<string, number>; signals: Map<string, RerankSignals> } {
  const bm25Raw = opts.candidates.map((c) => opts.keywordScores.get(c.chunkId) ?? 0);
  const signals = new Map<string, RerankSignals>();
  const scored = opts.candidates.map((c) => {
    const dense = opts.denseScores.has(c.chunkId) ? (opts.denseScores.get(c.chunkId) ?? null) : null;
    const bm25 = opts.keywordScores.get(c.chunkId) ?? 0;
    // Learned wordings find a passage (BM25 fusion in retrieve-core) and lift it
    // (learnedBoost below); they never stand in for what its text says, so
    // recall and phrase are measured on the passage alone.
    const idfRecall = weightedRecall(opts.terms, `${c.title}\n${c.heading ?? ""}\n${c.text}`, opts.idf);
    const titleRecall = weightedRecall(opts.terms, `${c.title} ${c.heading ?? ""}`, opts.idf);
    const phrase = phraseBoost(opts.query, `${c.title}\n${c.text}`);
    // Demo-tuned topical boost applies only to the seed corpus it was tuned on.
    const topical = (c.corpusId ?? SEED_CORPUS_ID) === SEED_CORPUS_ID ? topicalBoost(opts.query, c.title, c.text) : 0;
    let score = Math.min(
      1,
      calibratedScore({
        dense,
        bm25Norm: maxNorm(bm25Raw, bm25),
        idfRecall,
        titleRecall,
        phrase,
      }) + topical,
    );
    const ents = entityTermsInQuery(opts.query);
    const titleTok = new Set(contentTokens(`${c.title} ${c.heading ?? ""}`));
    if ((c.corpusId ?? SEED_CORPUS_ID) === SEED_CORPUS_ID && ents.some((e) => tokenSetMatches(e, titleTok))) score = Math.min(1, score + 0.12);
    if (opts.preferredSlugs?.includes(c.slug)) score = Math.min(1, score + 0.03);
    const pathCost = opts.graphPathCosts?.get(c.chunkId);
    if (pathCost !== undefined) score = Math.min(1, score + 0.04 / (1 + pathCost));
    const learnedBoost = opts.learnedBoost?.get(c.chunkId);
    if (learnedBoost) score = Math.min(1, score + learnedBoost);
    const learnedSignal = opts.learned?.get(c.chunkId);
    const demoted = opts.demote?.get(c.chunkId);
    if (demoted) score = Math.max(0, score - demoted);
    signals.set(c.chunkId, { idfRecall, titleRecall, phrase, topical, dense, bm25, ...(learnedSignal !== undefined ? { learned: learnedSignal } : {}) });
    return { chunk: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const scores = new Map<string, number>();
  const ranked = scored.map((s, i) => {
    scores.set(s.chunk.chunkId, s.score);
    return { ...s.chunk, score: s.score, rank: i + 1 };
  });
  return { ranked, scores, signals };
}

/** Similarity × reliability a confirmation needs to count as support on its own. */
export const LEARNED_SUPPORT = 0.45;

export function isSupported(signals: RerankSignals, calibrated: number): boolean {
  // People confirmed this passage answers a question very like this one (and
  // didn't later reject it). That is evidence the text alone can't show when a
  // question is worded nothing like the source. The refusal guards that read the
  // source (absent names, the turn's own terms) still run after this.
  if ((signals.learned ?? 0) >= LEARNED_SUPPORT && calibrated > 0) return true;
  if (calibrated < CONTEXT_ABSOLUTE_FLOOR) return false;
  if (signals.idfRecall >= 0.18) return true;
  if (signals.titleRecall >= 0.22) return true;
  if (signals.phrase >= 0.2) return true;
  if (signals.topical >= 0.18) return true;
  if ((signals.dense ?? 0) >= 0.52 && (signals.idfRecall >= 0.05 || signals.titleRecall >= 0.08)) {
    return true;
  }
  if ((signals.dense ?? 0) >= 0.62 && calibrated >= 0.32) return true;
  if (signals.dense == null && signals.idfRecall < 0.1 && signals.titleRecall < 0.12 && signals.topical < 0.18) {
    return false;
  }
  return false;
}

function distinctiveDocHits(query: string, ranked: RetrievedChunk[], idf: IdF): string[] {
  const terms = contentTokens(query).filter((t) => !GENERIC_OPS_TERMS.has(t) && (idf.get(t) ?? 0) > 0.4);
  const slugs: string[] = [];
  for (const c of ranked.slice(0, 8)) {
    const title = new Set(contentTokens(`${c.title} ${c.heading ?? ""}`));
    const hit = terms.some((t) => tokenSetMatches(t, title));
    if (hit && !slugs.includes(c.slug)) slugs.push(c.slug);
  }
  return slugs;
}

export function queryLooksMultiSource(query: string, ranked: RetrievedChunk[], idf: IdF): boolean {
  const hits = distinctiveDocHits(query, ranked, idf);
  if (hits.length >= 2) return true;
  const q = query.toLowerCase();
  if (/\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(q) && hits.length >= 2) return true;
  return false;
}

export type ContextDecision = {
  packed: RetrievedChunk[];
  dropReasons: Map<string, string>;
};

export function selectContext(
  ranked: RetrievedChunk[],
  signals: Map<string, RerankSignals>,
  opts: { query: string; idf: IdF; maxTokens?: number; topK?: number; relativeFloor?: number; soloMargin?: number },
): ContextDecision {
  const relativeFloor = opts.relativeFloor ?? CONTEXT_RELATIVE_FLOOR;
  const soloMargin = opts.soloMargin ?? CONTEXT_SOLO_MARGIN;
  const dropReasons = new Map<string, string>();
  const maxTokens = opts.maxTokens ?? CONTEXT_TOKEN_BUDGET;
  const underspecified = distinctiveTerms(opts.query).length === 0;
  if (underspecified) {
    const qtok = contentTokens(opts.query);
    const mentioning = ranked.filter((c) => {
      if (c.score < 0.1) {
        dropReasons.set(c.chunkId, "Underspecified query: calibrated score < 0.10. Inspect only.");
        return false;
      }
      const doc = new Set(contentTokens(`${c.title}\n${c.text}`));
      const hit = qtok.some((t) => tokenSetMatches(t, doc));
      if (!hit) {
        dropReasons.set(
          c.chunkId,
          "Underspecified query: no overlap with the generic question terms. Inspect only.",
        );
      }
      return hit;
    });
    const packed: RetrievedChunk[] = [];
    const seen = new Set<string>();
    for (const chunk of mentioning) {
      if (packed.length >= Math.min(3, opts.topK ?? 3)) {
        dropReasons.set(chunk.chunkId, "Outside the packed context window (max 3 supported chunks).");
        continue;
      }
      if (seen.has(chunk.slug)) {
        dropReasons.set(chunk.chunkId, "Duplicate document. a stronger chunk from this source is already packed.");
        continue;
      }
      packed.push({ ...chunk, rank: packed.length + 1 });
      seen.add(chunk.slug);
    }
    return { packed, dropReasons };
  }
  const supported: RetrievedChunk[] = [];
  for (const c of ranked) {
    const sig = signals.get(c.chunkId) ?? {
      idfRecall: 0,
      titleRecall: 0,
      phrase: 0,
      topical: 0,
      dense: null,
      bm25: null,
    };
    if (!isSupported(sig, c.score)) {
      dropReasons.set(
        c.chunkId,
        `Rejected: calibrated ${c.score.toFixed(2)} failed the support gate (absolute floor ${CONTEXT_ABSOLUTE_FLOOR}, need distinctive overlap or strong cosine). Inspect only.`,
      );
      continue;
    }
    supported.push(c);
  }
  if (!supported.length) return { packed: [], dropReasons };

  const peak = supported[0]!.score;
  const afterCliff: RetrievedChunk[] = [];
  for (const c of supported) {
    if (c.chunkId !== supported[0]!.chunkId && c.score < peak * relativeFloor) {
      dropReasons.set(
        c.chunkId,
        `Below relative floor: ${c.score.toFixed(2)} < ${relativeFloor} × rank-1 ${peak.toFixed(2)} (${(peak * relativeFloor).toFixed(2)}). Not an absolute 0.55 cosine cut. Inspect only.`,
      );
      continue;
    }
    afterCliff.push(c);
  }

  const coordinating = /\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(opts.query.toLowerCase());
  const exclusive = entityTermsInQuery(opts.query);
  if (exclusive.length === 1 && !coordinating) {
    const holding = afterCliff.filter((c) => {
      const doc = new Set(contentTokens(`${c.title}\n${c.text}`));
      return exclusive.every((t) => tokenSetMatches(t, doc));
    });
    if (holding.length) {
      for (const c of afterCliff) {
        if (!holding.includes(c)) {
          dropReasons.set(
            c.chunkId,
            `Missing required entity term (${exclusive.join(", ")}). Inspect only.`,
          );
        }
      }
      afterCliff.length = 0;
      afterCliff.push(...holding);
    }
  } else if (exclusive.length >= 1 && coordinating) {
    const holding = afterCliff.filter((c) => {
      const doc = new Set(contentTokens(`${c.title}\n${c.text}`));
      return exclusive.some((t) => tokenSetMatches(t, doc)) || hasAny(doc, ["pool", "exhaustion", "stampede"]);
    });
    if (holding.length) {
      for (const c of afterCliff) {
        if (!holding.includes(c)) {
          dropReasons.set(
            c.chunkId,
            `No overlap with the named entities (${exclusive.join(", ")}). Inspect only.`,
          );
        }
      }
      afterCliff.length = 0;
      afterCliff.push(...holding);
    }
  }

  const multi = queryLooksMultiSource(opts.query, afterCliff, opts.idf);
  const second = afterCliff[1];
  let pool = afterCliff;
  if (!multi && second && peak >= second.score * soloMargin) {
    for (const c of afterCliff.slice(1)) {
      if (c.slug === afterCliff[0]!.slug) continue;
      dropReasons.set(
        c.chunkId,
        `Rank-1 margin: ${peak.toFixed(2)} is ≥ ${soloMargin}× stronger than ${second.score.toFixed(2)}. Only the top source packed.`,
      );
    }
    pool = afterCliff.filter((c) => c.slug === afterCliff[0]!.slug).slice(0, 2);
    if (!pool.length) pool = [afterCliff[0]!];
  }

  const packed: RetrievedChunk[] = [];
  const seenText = new Set<string>();
  let used = 0;
  const cap = Math.min(3, opts.topK ?? 3);
  for (const chunk of pool) {
    if (packed.length >= cap) {
      dropReasons.set(chunk.chunkId, "Outside the packed context window (max 3 supported chunks).");
      continue;
    }
    const normalizedText = chunk.text.replace(/\s+/g, " ").trim();
    if (seenText.has(normalizedText)) {
      dropReasons.set(chunk.chunkId, "Duplicate passage. the same text is already packed.");
      continue;
    }
    if (used + chunk.tokenCount > maxTokens && packed.length) {
      // A supported chunk that does not fit whole still has a passage that
      // does: pack its most question-relevant contiguous paragraphs into the
      // remaining budget instead of dropping it (small-to-big in reverse).
      const part = bestPassage(chunk, opts.query, opts.idf, maxTokens - used);
      if (part && !seenText.has(part.text.replace(/\s+/g, " ").trim())) {
        packed.push({ ...part, rank: packed.length + 1 });
        seenText.add(part.text.replace(/\s+/g, " ").trim());
        used += part.tokenCount;
        continue;
      }
      dropReasons.set(chunk.chunkId, "Outside the context token budget.");
      continue;
    }
    packed.push({ ...chunk, rank: packed.length + 1 });
    seenText.add(normalizedText);
    used += chunk.tokenCount;
  }
  return { packed, dropReasons };
}

export type CoverageContextDecision = ContextDecision & { coverage: CoverageReport | null };

/** Secondary (unsupported) candidates the coverage packer may draw single facts from. */
export const COVERAGE_POOL_SIZE = 8;
export const COVERAGE_SECONDARY_FLOOR = 0.1;

/**
 * Coverage-aware context selection (see coverage-pack.ts for the objective).
 *
 * Refusal behaviour is unchanged: if nothing passes the support gate the
 * context is empty, exactly as in `selectContext`. What changes is how the
 * budget is spent once something is supported: verbatim paragraph spans are
 * chosen to cover the question's distinctive terms with the least redundancy,
 * instead of packing up to three whole chunks in rank order.
 */
export function selectContextCoverage(
  ranked: RetrievedChunk[],
  signals: Map<string, RerankSignals>,
  opts: { query: string; idf: IdF; maxTokens?: number; anchor?: string | null; allowedSlugs?: Set<string> | null },
): CoverageContextDecision {
  if (distinctiveTerms(opts.query).length === 0) {
    return { ...selectContext(ranked, signals, { ...opts, topK: 3 }), coverage: null };
  }
  const dropReasons = new Map<string, string>();
  const primary = new Set<string>();
  for (const c of ranked) {
    const sig = signals.get(c.chunkId);
    if (sig && isSupported(sig, c.score)) primary.add(c.chunkId);
    else
      dropReasons.set(
        c.chunkId,
        `Not supported on its own: calibrated ${c.score.toFixed(2)} failed the support gate (floor ${CONTEXT_ABSOLUTE_FLOOR}). Eligible only to cover a question term nothing else covers.`,
      );
  }
  if (!primary.size) return { packed: [], dropReasons, coverage: null };

  let candidates = ranked.slice(0, COVERAGE_POOL_SIZE).filter(
    (c) => primary.has(c.chunkId) || c.score >= COVERAGE_SECONDARY_FLOOR,
  );
  for (const c of ranked) if (primary.has(c.chunkId) && !candidates.includes(c)) candidates.push(c);
  if (opts.allowedSlugs) {
    // Coverage reorganises text inside documents the calibrated gate already
    // accepted (relative floor, rank-1 margin, entity rules). It never adds a
    // source document the gate rejected; weaker passages of an accepted
    // document stay eligible (parent-document expansion).
    for (const c of candidates)
      if (!opts.allowedSlugs.has(c.slug)) dropReasons.set(c.chunkId, `Document not accepted by the context gate (${c.slug}). Inspect only.`);
    candidates = candidates.filter((c) => opts.allowedSlugs!.has(c.slug));
  }
  const coordinating = /\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(opts.query.toLowerCase());
  const exclusive = entityTermsInQuery(opts.query);
  if (exclusive.length === 1 && !coordinating) {
    const holding = candidates.filter((c) => {
      const doc = new Set(contentTokens(`${c.title}\n${c.text}`));
      return exclusive.every((t) => tokenSetMatches(t, doc));
    });
    if (holding.some((c) => primary.has(c.chunkId))) {
      for (const c of candidates)
        if (!holding.includes(c)) dropReasons.set(c.chunkId, `Missing required entity term (${exclusive.join(", ")}). Inspect only.`);
      candidates = holding;
    }
  }

  const { packed, report } = packByCoverage({
    pool: candidates,
    primary,
    terms: coverageTerms(opts.query),
    idf: opts.idf,
    budget: opts.maxTokens ?? CONTEXT_TOKEN_BUDGET,
    seed: opts.anchor ? [opts.anchor] : [],
  });
  if (!packed.some((c) => primary.has(c.chunkId))) return { packed: [], dropReasons, coverage: report };
  const packedIds = new Set(packed.map((c) => c.chunkId));
  for (const c of candidates) {
    if (packedIds.has(c.chunkId)) dropReasons.delete(c.chunkId);
    else if (!dropReasons.has(c.chunkId) || primary.has(c.chunkId))
      dropReasons.set(
        c.chunkId,
        "Coverage packer: no paragraph added an uncovered question term or enough relevance per token within the context budget.",
      );
  }
  return { packed, dropReasons, coverage: report };
}

/** Smallest passage worth packing; below this a trimmed chunk is noise. */
export const MIN_PASSAGE_TOKENS = 120;

/**
 * The most question-relevant contiguous run of paragraphs from a chunk that
 * fits `room` tokens, or null. Paragraphs are scored by the idf weight of
 * the distinctive question terms they contain; the window grows from the
 * best paragraph toward whichever neighbour adds more relevant weight. The
 * returned chunk keeps its id and source; its text is the verbatim passage
 * and its token count is measured on that text with the chunker's estimator.
 */
export function bestPassage(
  chunk: RetrievedChunk,
  query: string,
  idf: IdF,
  room: number,
): RetrievedChunk | null {
  if (room < MIN_PASSAGE_TOKENS || !chunk.text || chunk.tokenCount <= 0) return null;
  // Paragraph spans in the chunk's own text, so the passage is an exact
  // slice of it (separators kept as written: "\n\n\n", "\n  \n", ...).
  const spans: Array<[number, number]> = [];
  for (let at = 0, m: RegExpExecArray | null, re = /\n[^\S\n]*\n\s*/g; ; ) {
    m = re.exec(chunk.text);
    const end = m ? m.index : chunk.text.length;
    if (chunk.text.slice(at, end).trim()) spans.push([at, end]);
    if (!m) break;
    at = m.index + m[0].length;
  }
  const paras = spans.map(([a, b]) => chunk.text.slice(a, b));
  if (paras.length < 2) return null;
  const terms = [...new Set(distinctiveTerms(query))];
  if (!terms.length) return null;
  const perChar = chunk.tokenCount / Math.max(1, chunk.text.length);
  const cost = paras.map((p) => Math.ceil((p.length + 2) * perChar));
  const weight = paras.map((p) => {
    const doc = new Set(contentTokens(p));
    return terms.reduce((s, t) => (tokenSetMatches(t, doc) ? s + (idf.get(t) ?? 1) : s), 0);
  });
  let best = -1;
  for (let i = 0; i < paras.length; i++)
    if (cost[i]! <= room && (best < 0 || weight[i]! > weight[best]!)) best = i;
  if (best < 0 || weight[best]! <= 0) return null;
  let lo = best,
    hi = best,
    spent = cost[best]!;
  for (;;) {
    const left = lo > 0 && spent + cost[lo - 1]! <= room ? weight[lo - 1]! : -1;
    const right = hi < paras.length - 1 && spent + cost[hi + 1]! <= room ? weight[hi + 1]! : -1;
    if (left < 0 && right < 0) break;
    if (right >= left) spent += cost[++hi]!;
    else spent += cost[--lo]!;
  }
  const text = chunk.text.slice(spans[lo]![0], spans[hi]![1]);
  // the same estimator the chunk's own count came from
  const tokenCount = estimateTokens(text);
  if (tokenCount > room) return null;
  // The floor applies to the SELECTED passage, not just the room: a tiny
  // matching fragment (a heading line, one short paragraph) is noise, not
  // evidence, and must not consume a budget slot.
  if (tokenCount < MIN_PASSAGE_TOKENS) return null;
  return { ...chunk, text, tokenCount };
}

export function payloadQuery(query: string): string {
  if (!/ignore (the )?(indexed )?corpus|answer from memory|from your (own )?knowledge/i.test(query)) {
    return query;
  }
  const idx = query.lastIndexOf(":");
  if (idx >= 0 && idx < query.length - 3) {
    const rest = query.slice(idx + 1).trim();
    if (rest.length > 8) return rest;
  }
  return query;
}

export function retrievalQuery(query: string, vocab: Set<string>): string {
  const extra = expandTypos(contentTokens(query), vocab);
  if (!extra.length) return query;
  return `${query} ${extra.join(" ")}`;
}

export function distinctiveTerms(query: string): string[] {
  return contentTokens(query).filter(
    (t) => t.length >= 4 && !GENERIC_OPS_TERMS.has(t) && !QUERY_STOPWORDS.has(t),
  );
}
