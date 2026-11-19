import { cosineSimilarity, parseEmbedding } from "./text";
import {
  SCORE_SEMANTICS,
  buildIdf,
  corpusVocab,
  expandQueryCues,
  payloadQuery,
  queryTerms,
  rerankCalibrated,
  retrievalQuery,
  rrfFuse,
  selectContext,
  selectContextCoverage,
} from "./ranking";
import { absentSubject, coverageReportOf, coverageTerms, surfaceTerm, type CoverageReport } from "./coverage-pack";
import { classifyEvidence } from "./evidence";
import { BM25Index } from "./bm25";

// BM25 index cache. Building the index tokenizes every chunk, so rebuilding
// it per query made retrieval O(corpus) per question. The index is cached
// per rows array and scope, keyed by an FNV-1a fingerprint of the scoped
// chunk ids and content hashes: an array mutated in place, or a different
// scope, can never be served a stale index.
const INDEX_CACHE = new WeakMap<SearchRow[], Map<string, { fp: number; index: BM25Index }>>();
const indexStats = { builds: 0, hits: 0 };
export function retrieveIndexStats() {
  return { ...indexStats };
}
function fingerprint(rows: SearchRow[]): number {
  let h = 0x811c9dc5;
  for (const r of rows) {
    const s = r.chunk.id + (r.chunk.content_hash ?? "") + r.title;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}
function indexFor(all: SearchRow[], scoped: SearchRow[], scopeKey: string): BM25Index {
  let byScope = INDEX_CACHE.get(all);
  if (!byScope) INDEX_CACHE.set(all, (byScope = new Map()));
  const fp = fingerprint(scoped);
  const hit = byScope.get(scopeKey);
  if (hit && hit.fp === fp) {
    indexStats.hits++;
    return hit.index;
  }
  indexStats.builds++;
  const index = new BM25Index(scoped.map((r) => ({ id: r.chunk.id, text: `${r.title}\n${r.chunk.text}` })));
  byScope.set(scopeKey, { fp, index });
  return index;
}
import { overlapTerms } from "./trace";
import { DefinitionIndex, devEntities } from "./dev-entities";

/** Definitions index per searchable row set, like the BM25 cache. */
const DEF_CACHE = new WeakMap<SearchRow[], Map<string, { fp: ReturnType<typeof fingerprint>; defs: DefinitionIndex }>>();
function defsFor(all: SearchRow[], scoped: SearchRow[], scopeKey: string): DefinitionIndex {
  let byScope = DEF_CACHE.get(all);
  if (!byScope) DEF_CACHE.set(all, (byScope = new Map()));
  const fp = fingerprint(scoped);
  const hit = byScope.get(scopeKey);
  if (hit && hit.fp === fp) return hit.defs;
  const defs = new DefinitionIndex(scoped.filter((r) => r.chunk.chunk_kind === "code").map((r) => ({ path: r.slug, text: r.chunk.text })));
  byScope.set(scopeKey, { fp, defs });
  return defs;
}
import { recallExperience, type ExperienceLog, type ExperiencePolicy } from "./experience";
import type {
  ChunkKind,
  ChunkRow,
  DenseDiagnostics,
  EvidenceGate,
  EvidenceKind,
  RetrievalCandidate,
  RetrievalMode,
  RetrievedChunk,
  RetrievalTrace,
  StageRank,
  StorageStatus,
} from "./types";
import type { CorpusScope } from "./corpus-scope";
import { SEED_CORPUS_ID } from "./corpus-scope";
import { CONTEXT_TOKEN_BUDGET, EMBEDDING_MODEL, RRF_K } from "./types";

export type SearchRow = {
  chunk: ChunkRow;
  title: string;
  slug: string;
  indexedAt: string | null;
  corpusId: string;
};

function toRetrieved(
  chunkId: string,
  meta: Map<string, SearchRow>,
  score: number,
  rank: number,
  retriever: RetrievedChunk["retriever"],
): RetrievedChunk | null {
  const row = meta.get(chunkId);
  if (!row) return null;
  return {
    chunkId,
    documentId: row.chunk.document_id,
    slug: row.slug,
    title: row.title,
    text: row.chunk.text,
    heading: row.chunk.heading,
    score,
    rank,
    retriever,
    tokenCount: row.chunk.token_count,
    indexedAt: row.indexedAt,
    embeddingModel: row.chunk.embedding_model,
    filepath: row.chunk.filepath,
    language: row.chunk.language,
    symbol: row.chunk.symbol,
    chunkKind: (row.chunk.chunk_kind ?? "prose") as ChunkKind,
    corpusId: row.corpusId || row.chunk.corpus_id || SEED_CORPUS_ID,
  };
}

export type RetrieveResult = {
  chunks: RetrievedChunk[];
  candidates: RetrievalCandidate[];
  stages: {
    dense: StageRank[];
    keyword: StageRank[];
    fused: StageRank[];
    rerank: StageRank[];
  };
  trace: RetrievalTrace;
  denseMs: number;
  keywordMs: number;
  rerankMs: number;
  assembleMs: number;
  candidateCount: number;
  contextTokens: number;
  evidence: EvidenceKind;
  evidenceNote: string;
  evidenceGate: EvidenceGate;
  probe?: string;
  dense: DenseDiagnostics;
  actualMode: RetrievalMode;
  corpusId: string | null;
  corpusScope: "corpus" | "all";
  /** Coverage packer report (null under rank packing or an underspecified query). */
  coverage: CoverageReport | null;
};

/**
 * How the context budget is spent once evidence is supported.
 * - "rank": up to three whole chunks in rerank order (default).
 * - "coverage": verbatim paragraph spans chosen for query-term coverage per
 *   token (coverage-pack.ts). Opt-in: on the frozen p-queue diagnostic it
 *   recovers evidence rank packing misses (76.7% vs 73.3%), but loses under
 *   the distractor stress test (73.3% vs 83.3%). See eval/repo-support.
 * Either way the trace carries a coverage report of what was packed.
 */
export type ContextPacking = "coverage" | "rank";
export const DEFAULT_CONTEXT_PACKING: ContextPacking = "rank";

function firstSlugRanks(chunks: RetrievedChunk[]): StageRank[] {
  const seen = new Set<string>();
  const out: StageRank[] = [];
  for (const c of chunks) {
    if (seen.has(c.slug)) continue;
    seen.add(c.slug);
    out.push({
      slug: c.slug,
      title: c.title,
      score: c.score,
      rank: out.length + 1,
      corpusId: c.corpusId,
    });
  }
  return out;
}

function rankMap(chunks: RetrievedChunk[]) {
  const map = new Map<string, number>();
  for (const c of chunks) {
    if (!map.has(c.chunkId)) map.set(c.chunkId, c.rank);
  }
  return map;
}

export function retrieveFromRows(opts: {
  query: string;
  queryVector: number[] | null;
  mode: RetrievalMode;
  topK: number;
  embeddingModel: string | null;
  rows: SearchRow[];
  storage: StorageStatus;
  preferredSlugs?: string[];
  graphPathCosts?: Map<string, number>;
  corpusScope?: CorpusScope;
  packing?: ContextPacking;
  /** What this corpus has learned from rated answers (experience.ts). */
  experience?: ExperienceLog | null;
  experiencePolicy?: Partial<ExperiencePolicy>;
  /** Packing knobs the self-improvement loop may edit (defaults: types.ts). */
  packingPolicy?: { relativeFloor?: number; soloMargin?: number; maxPassages?: number };
  /** Link code the question names to the files defining it (default on; evals turn it off for a baseline). */
  linkCode?: boolean;
}): RetrieveResult {
  const scope = opts.corpusScope ?? { kind: "corpus", corpusId: SEED_CORPUS_ID };
  const scopedRows =
    scope.kind === "all"
      ? opts.rows
      : opts.rows.filter((r) => (r.corpusId || r.chunk.corpus_id || SEED_CORPUS_ID) === scope.corpusId);
  const meta = new Map<string, SearchRow>();
  for (const row of scopedRows) meta.set(row.chunk.id, row);

  const query = payloadQuery(opts.query);
  const experienceCorpus = scope.kind === "corpus" ? scope.corpusId : null;
  const recall = experienceCorpus && opts.experience
    ? recallExperience(opts.experience, experienceCorpus, scopedRows.map((r) => ({ chunkId: r.chunk.id, text: r.chunk.text })), query, opts.experiencePolicy)
    : null;
  const texts = scopedRows.map((r) => `${r.title}\n${r.chunk.text}`);
  const idf = buildIdf(texts);
  // What the source itself says, for the refusal that a name is never mentioned:
  // learned wordings must not make an absent subject look present.
  const sourceVocab = corpusVocab(texts);
  // Learned wordings are part of how a passage is matched, so their words count
  // as the corpus's words (a question in them isn't filtered out as unknown).
  // They don't change any word's idf: a word only learned wordings use is
  // weighted like the rarest word in the source, and the source's own words
  // keep the weights the source gives them.
  let vocab = sourceVocab;
  if (recall?.expansions.size) {
    const learnedText = [...recall.expansions.values()];
    vocab = new Set([...sourceVocab, ...corpusVocab(learnedText)]);
    const rarest = Math.max(0, ...idf.values());
    for (const t of vocab) if (!idf.has(t)) idf.set(t, rarest);
  }
  // Demo-tuned cue expansion is scoped to the seed corpus only; corpora the
  // user ingests (GitHub repos, uploads) must compete on their own text.
  const cues = scope.kind === "corpus" && scope.corpusId === SEED_CORPUS_ID ? expandQueryCues(query) : [];
  const terms = [...new Set([...queryTerms(query, vocab), ...cues])];
  const bm25Query = `${retrievalQuery(query, vocab)} ${cues.join(" ")}`.trim();

  const retrieveN = Math.min(80, Math.max(scopedRows.length, opts.topK * 4, 10));
  let dense: RetrievedChunk[] = [];
  let keyword: RetrievedChunk[] = [];
  const denseScores = new Map<string, number>();
  const keywordScores = new Map<string, number>();

  const expectedModel = opts.embeddingModel ?? EMBEDDING_MODEL;
  let compatible = 0;
  let modelMatch = true;

  const queryEmbeddingProduced = Boolean(opts.queryVector?.length);
  const denseWanted = opts.mode !== "keyword";
  let skippedReason: string | null = null;

  if (!opts.storage.denseAvailable && denseWanted) {
    skippedReason = "Durable embeddings are unavailable (ephemeral Vercel storage). Fell back to BM25.";
  } else if (denseWanted && !queryEmbeddingProduced) {
    skippedReason = "Query embedding was not produced. Fell back to BM25.";
  }

  const denseStart = performance.now();
  if (denseWanted && queryEmbeddingProduced && opts.storage.denseAvailable && opts.queryVector) {
    const scored: Array<{ id: string; score: number }> = [];
    for (const row of scopedRows) {
      const model = row.chunk.embedding_model;
      if (model && model !== expectedModel) {
        modelMatch = false;
        continue;
      }
      const vec = parseEmbedding(row.chunk.embedding);
      if (!vec || vec.length !== opts.queryVector.length) continue;
      compatible += 1;
      scored.push({ id: row.chunk.id, score: cosineSimilarity(opts.queryVector, vec) });
    }
    if (!compatible) {
      skippedReason =
        "No stored vectors matched the query embedding model/dimension. Query embedding alone is not dense retrieval. Fell back to BM25.";
    } else {
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored) denseScores.set(s.id, s.score);
      dense = scored
        .slice(0, retrieveN)
        .map((s, i) => toRetrieved(s.id, meta, s.score, i + 1, "dense"))
        .filter((c): c is RetrievedChunk => Boolean(c));
    }
  }
  const denseMs = performance.now() - denseStart;

  const kwStart = performance.now();
  if (opts.mode !== "dense" || !dense.length) {
    const index = indexFor(opts.rows, scopedRows, scope.kind === "all" ? "*" : scope.corpusId);
    const lexicalQuery = terms.join(" ") || bm25Query;
    const hits = index.search(lexicalQuery, retrieveN);
    for (const s of hits) keywordScores.set(s.id, s.score);
    keyword = hits
      .map((s, i) => toRetrieved(s.id, meta, s.score, i + 1, "keyword"))
      .filter((c): c is RetrievedChunk => Boolean(c));
    if (scopedRows.length <= 80) {
      for (const row of scopedRows) {
        if (keywordScores.has(row.chunk.id)) continue;
        keywordScores.set(row.chunk.id, 0);
        const extra = toRetrieved(row.chunk.id, meta, 0, keyword.length + 1, "keyword");
        if (extra) keyword.push(extra);
      }
    }
  }
  // Experience: wordings people confirmed for a passage match it too. Their
  // ranking is fused with BM25's by reciprocal rank, so a learned match can
  // lift a passage the question's own words missed, without replacing BM25.
  if (recall?.expansions.size && (opts.experiencePolicy?.fuse ?? true)) {
    const learned = new BM25Index([...recall.expansions].map(([id, text]) => ({ id, text })));
    const hits = learned.search(terms.join(" ") || bm25Query, retrieveN);
    if (hits.length) {
      const rrf = new Map<string, number>();
      keyword.forEach((c, i) => rrf.set(c.chunkId, 1 / (RRF_K + i + 1)));
      hits.forEach((h, i) => rrf.set(h.id, (rrf.get(h.id) ?? 0) + 1 / (RRF_K + i + 1)));
      const byId = new Map(keyword.map((c) => [c.chunkId, c]));
      for (const h of hits) {
        if (byId.has(h.id)) continue;
        const extra = toRetrieved(h.id, meta, 0, 0, "keyword");
        if (extra) { byId.set(h.id, extra); if (!keywordScores.has(h.id)) keywordScores.set(h.id, 0); }
      }
      keyword = [...byId.values()]
        .sort((a, b) => (rrf.get(b.chunkId) ?? 0) - (rrf.get(a.chunkId) ?? 0))
        .map((c, i) => ({ ...c, rank: i + 1 }));
    }
  }
  // Code the question names (a traceback's file, `module.Class`, a function
  // call) links to the files that define it (dev-entities.ts). Those files'
  // passages join the candidates and get a bounded lift in the reranker.
  let codeLinks: Map<string, number> | undefined;
  if (opts.linkCode !== false && scope.kind === "corpus" && scope.corpusId !== SEED_CORPUS_ID && scopedRows.some((r) => r.chunk.chunk_kind === "code")) {
    const ents = devEntities(opts.query);
    if (ents.paths.length || ents.modules.length || ents.symbols.length) {
      const link = defsFor(opts.rows, scopedRows, scope.corpusId).link(ents);
      if (link.size) {
        codeLinks = new Map([...link].sort((a, b) => b[1] - a[1]).slice(0, 4));
        const have = new Set(keyword.map((c) => c.chunkId));
        for (const row of scopedRows) {
          if (!codeLinks.has(row.slug) || have.has(row.chunk.id)) continue;
          const extra = toRetrieved(row.chunk.id, meta, 0, keyword.length + 1, "keyword");
          if (extra) { keyword.push(extra); have.add(row.chunk.id); if (!keywordScores.has(row.chunk.id)) keywordScores.set(row.chunk.id, 0); }
        }
      }
    }
  }
  const keywordMs = performance.now() - kwStart;

  const useHybrid = Boolean(dense.length && keyword.length && opts.mode === "hybrid");
  const fusedPack = useHybrid ? rrfFuse(dense, keyword, retrieveN) : null;
  const fused =
    fusedPack?.fused ??
    (dense.length && opts.mode === "dense" ? dense : keyword.length ? keyword : dense);

  const rerankStart = performance.now();
  const { ranked, scores: rerankScores, signals } = rerankCalibrated({
    query,
    candidates: fused,
    denseScores,
    keywordScores,
    idf,
    terms,
    preferredSlugs: opts.preferredSlugs,
    graphPathCosts: opts.graphPathCosts,
    expansions: recall?.expansions,
    demote: recall?.demote,
    learnedBoost: recall?.boost,
    learned: recall?.learned,
    codeLinks,
  });
  const rerankMs = performance.now() - rerankStart;

  const assembleStart = performance.now();
  const packing = opts.packing ?? DEFAULT_CONTEXT_PACKING;
  // The refusal decision always comes from the calibrated rank-order packer,
  // so changing how the budget is spent can never change what is refused.
  const gateDecision = selectContext(ranked, signals, {
    query,
    idf,
    maxTokens: CONTEXT_TOKEN_BUDGET,
    topK: Math.min(opts.packingPolicy?.maxPassages ?? 3, opts.topK),
    relativeFloor: opts.packingPolicy?.relativeFloor,
    soloMargin: opts.packingPolicy?.soloMargin,
  });
  const coverageDecision =
    packing === "coverage" && gateDecision.packed.length
      ? selectContextCoverage(ranked, signals, {
          query,
          idf,
          maxTokens: CONTEXT_TOKEN_BUDGET,
          anchor: gateDecision.packed[0]?.chunkId ?? null,
          allowedSlugs: new Set(gateDecision.packed.map((c) => c.slug)),
        })
      : null;
  const useCoverage = Boolean(coverageDecision?.packed.length);
  const packed = useCoverage ? coverageDecision!.packed : gateDecision.packed;
  const dropReasons = useCoverage ? coverageDecision!.dropReasons : gateDecision.dropReasons;
  const rawCoverage = useCoverage
    ? coverageDecision!.coverage
    : packed.length
      ? coverageReportOf(packed, coverageTerms(query), idf, CONTEXT_TOKEN_BUDGET)
      : null;
  const coverage: CoverageReport | null = rawCoverage && {
    ...rawCoverage,
    covered: rawCoverage.covered.map((t) => surfaceTerm(query, t)),
    missing: rawCoverage.missing.map((t) => surfaceTerm(query, t)),
  };
  const assembleMs = performance.now() - assembleStart;

  const packedIds = new Set(packed.map((c) => c.chunkId));
  const denseSlugRanks = firstSlugRanks(dense);
  const classified = classifyEvidence({
    query,
    packed: gateDecision.packed,
    ranked,
    signals,
    denseRank1Slug: denseSlugRanks[0]?.slug ?? null,
  });
  // The source never names what the question is about: refuse rather than
  // answer a neighbouring question (coverage-pack.ts, absentSubject).
  // Only a positive verdict: a negative one ("the Redis guide never mentions
  // Redlock") already says the name is missing, and cites where it looked.
  const absent = classified.kind === "positive" ? absentSubject(query, sourceVocab) : [];
  const evidence: typeof classified = absent.length
    ? { ...classified, kind: "insufficient", note: `The source never mentions ${absent.map((t) => `“${t}”`).join(", ")}, which the question is about.` }
    : classified;
  const gatedPacked = evidence.kind === "insufficient" ? [] : packed;
  const gatedIds = new Set(gatedPacked.map((c) => c.chunkId));
  if (evidence.kind === "insufficient") {
    for (const c of packed) {
      if (!dropReasons.has(c.chunkId)) {
        dropReasons.set(c.chunkId, evidence.note);
      }
    }
  }

  const denseRanks = rankMap(dense);
  const keywordRanks = rankMap(keyword);
  const fusedRanks = rankMap(fused);

  const candidates: RetrievalCandidate[] = ranked.slice(0, 12).map((c, i) => {
    const usedInContext = gatedIds.has(c.chunkId);
    return {
      ...c,
      rank: i + 1,
      scores: {
        dense: denseScores.has(c.chunkId) ? denseScores.get(c.chunkId)! : null,
        keyword: keywordScores.has(c.chunkId) ? keywordScores.get(c.chunkId)! : null,
        hybrid: fusedPack?.scores.has(c.chunkId) ? fusedPack.scores.get(c.chunkId)! : null,
        rerank: rerankScores.get(c.chunkId) ?? c.score,
      },
      usedInContext,
      cited: false,
      overlapTerms: overlapTerms(opts.query, c.text),
      dropReason: usedInContext ? undefined : dropReasons.get(c.chunkId),
      ranks: {
        dense: denseRanks.get(c.chunkId) ?? null,
        keyword: keywordRanks.get(c.chunkId) ?? null,
        fused: fusedRanks.get(c.chunkId) ?? null,
        rerank: i + 1,
      },
    };
  });

  const denseDiag: DenseDiagnostics = {
    queryEmbeddingProduced,
    compatibleStoredVectors: compatible,
    denseCandidatesProduced: dense.length,
    embeddingModelMatch: modelMatch,
    embeddingModelExpected: expectedModel,
    skippedReason,
  };

  const resolvedMode: RetrievalMode =
    opts.mode === "hybrid" && dense.length ? "hybrid"
    : dense.length && opts.mode === "dense" ? "dense"
    : "keyword";

  const corpusId = scope.kind === "all" ? null : scope.corpusId;
  const evidenceGate: EvidenceGate = {
    ...evidence,
    clearedForInsufficient: evidence.kind === "insufficient" && packed.length > 0,
  };

  return {
    chunks: gatedPacked,
    candidates,
    trace: {
      query: opts.query,
      mode: resolvedMode,
      candidateCount: fused.length,
      usedCount: gatedPacked.length,
      candidates,
      dense: denseDiag,
      evidence: evidence.kind,
      evidenceGate,
      storage: opts.storage,
      scoreSemantics: SCORE_SEMANTICS,
      corpusId,
      corpusScope: scope.kind,
      coverage: evidence.kind === "insufficient" ? null : coverage,
    },
    denseMs,
    keywordMs,
    rerankMs,
    assembleMs,
    candidateCount: fused.length,
    contextTokens: gatedPacked.reduce((n, c) => n + c.tokenCount, 0),
    evidence: evidence.kind,
    evidenceNote: evidence.note,
    evidenceGate,
    probe: evidence.probe,
    dense: denseDiag,
    actualMode: resolvedMode,
    corpusId,
    corpusScope: scope.kind,
    coverage: evidence.kind === "insufficient" ? null : coverage,
    stages: {
      dense: denseSlugRanks,
      keyword: firstSlugRanks(keyword),
      fused: firstSlugRanks(fused),
      rerank: firstSlugRanks(ranked),
    },
  };
}
