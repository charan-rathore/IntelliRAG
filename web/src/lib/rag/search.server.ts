/**
 * The search bar's server side: instant results over a corpus's chunks with
 * the code-search engine (code-search.ts), plus "did you mean" and completions.
 * The engine also learns from experience: questions people confirmed a passage
 * answers become query→code associations, so search improves with use too.
 */
import { CodeSearchIndex, DEFAULT_SEARCH, didYouMean, learnAssociations, parseSearchQuery, snippet, suggest, surfaceVocab, type SearchDoc } from "./code-search";
import { parseCorpusScope, type CorpusScope } from "./corpus-scope";
import { loadSearchableChunks } from "./store.server";
import { ensureGraph } from "./graphify/persist.server";
import type { SearchRow } from "./retrieve-core";
import { DefinitionIndex, devEntities } from "./dev-entities";
import { caseEvidence, emptyCaseMemory, type CaseMemoryState } from "./case-memory";

interface Built { key: string; index: CodeSearchIndex; vocab: Map<string, number>; rows: Map<string, SearchRow>; defs: DefinitionIndex; cases: CaseMemoryState }

/** How much a file the question's code names counts, against reciprocal-rank scores (tuned on SWE-bench Lite dev repos). */
const LINK_WEIGHT = 0.005;
const fileOf = (r: SearchRow) => r.chunk.filepath ?? r.slug;

/**
 * Re-rank passages: reciprocal rank from the text match, plus files the
 * question's code names (dev-entities.ts), plus what earlier resolved
 * questions say (case-memory.ts), at the weights the last sleep accepted.
 */
function blend(b: Built, q: string, hits: Array<{ id: string; score: number; matched: string[] }>) {
  const link = b.defs.link(devEntities(q));
  const ev = b.cases.cases.length && (b.cases.weights.similar || b.cases.weights.prior) ? caseEvidence(b.cases.cases, q) : null;
  const fileCase = new Map<string, number>();
  if (ev) {
    for (const [chunkId, v] of ev.similar) { const r = b.rows.get(chunkId); if (r) fileCase.set(fileOf(r), (fileCase.get(fileOf(r)) ?? 0) + b.cases.weights.similar * v); }
    for (const [chunkId, v] of ev.prior) { const r = b.rows.get(chunkId); if (r) fileCase.set(fileOf(r), (fileCase.get(fileOf(r)) ?? 0) + b.cases.weights.prior * v); }
  }
  if (!link.size && !fileCase.size) return hits;
  const scored = hits.map((h, i) => {
    const f = fileOf(b.rows.get(h.id)!);
    return { h, s: 1 / (60 + i + 1) + LINK_WEIGHT * (link.get(f) ?? 0) + (fileCase.get(f) ?? 0) / 61 };
  });
  return scored.sort((x, y) => y.s - x.s).map((x) => x.h);
}
const CACHE = new Map<string, Built>();

export interface SearchResult {
  chunkId: string;
  slug: string;
  title: string;
  path: string | null;
  heading: string | null;
  symbol: string | null;
  language: string | null;
  score: number;
  matched: string[];
  snippet: { text: string; marks: Array<[number, number]>; startLine: number };
}

async function build(corpus: string | null): Promise<Built> {
  const scope: CorpusScope = parseCorpusScope(corpus);
  const rows = (await loadSearchableChunks(scope)) as SearchRow[];
  const state = await ensureGraph();
  const corpusId = scope.kind === "corpus" ? scope.corpusId : null;
  const pairs: Array<{ query: string; doc: string }> = [];
  const byId = new Map(rows.map((r) => [r.chunk.id, r]));
  for (const e of Object.values(state.experience?.entries ?? {})) {
    if (corpusId && e.corpusId !== corpusId) continue;
    const row = byId.get(e.chunkId);
    if (!row) continue;
    for (const a of e.asked) if (a.vote > 0) pairs.push({ query: a.q, doc: row.chunk.text });
  }
  const caseState = corpusId ? state.cases?.[corpusId] : undefined;
  const key = `${caseState?.cases.length ?? 0}:${JSON.stringify(caseState?.weights ?? null)}:${rows.length}:${rows[0]?.chunk.id ?? ""}:${rows.at(-1)?.chunk.id ?? ""}:${rows.reduce((n, r) => n + r.chunk.text.length, 0)}:${pairs.length}`;
  const cacheKey = scope.kind === "all" ? "*" : scope.corpusId;
  const hit = CACHE.get(cacheKey);
  if (hit && hit.key === key) return hit;
  const docs: SearchDoc[] = rows.map((r) => ({
    id: r.chunk.id,
    name: r.chunk.symbol ?? null,
    doc: r.chunk.chunk_kind === "code" ? null : r.chunk.heading,
    body: r.chunk.text,
    path: r.chunk.filepath ?? r.slug,
    lang: r.chunk.language,
    kind: r.chunk.chunk_kind === "code" ? "code" : "prose",
  }));
  // With few confirmed pairs a PMI table is noise: require a few per term.
  const associations = pairs.length >= 20 ? learnAssociations(pairs, { minCount: 2 }) : null;
  const built: Built = {
    key, index: new CodeSearchIndex(docs, DEFAULT_SEARCH, associations), vocab: surfaceVocab(docs), rows: byId,
    defs: new DefinitionIndex(rows.map((r) => ({ path: fileOf(r), text: r.chunk.text }))),
    cases: (corpusId && state.cases?.[corpusId]) || emptyCaseMemory(),
  };
  CACHE.set(cacheKey, built);
  return built;
}

export async function searchCorpus(input: { q: string; corpus: string | null; limit?: number }) {
  const started = performance.now();
  const b = await build(input.corpus);
  // A pasted issue or stack trace is text to match, not operators: its
  // "-flags" and quotes would otherwise filter everything out.
  const pasted = input.q.length > 160 || input.q.includes("\n");
  const parsed = pasted ? { words: [input.q], phrases: [], exclude: [] } : parseSearchQuery(input.q);
  // Rank deeper than shown, so files the question names can climb into view.
  const limit = Math.min(50, input.limit ?? 20);
  const hits = blend(b, input.q, b.index.search(parsed, Math.max(100, limit))).slice(0, limit);
  const terms = [...b.index.queryTerms(parsed.words).keys()];
  const results: SearchResult[] = hits.map((h) => {
    const r = b.rows.get(h.id)!;
    return {
      chunkId: h.id, slug: r.slug, title: r.title, path: r.chunk.filepath ?? null, heading: r.chunk.heading, symbol: r.chunk.symbol ?? null,
      language: r.chunk.language, score: Number(h.score.toFixed(3)), matched: h.matched, snippet: snippet(r.chunk.text, terms),
    };
  });
  const words = parsed.words.join(" ");
  return {
    query: input.q,
    parsed,
    results,
    didYouMean: !pasted && results.length < 3 && words ? didYouMean(words, b.vocab) : null,
    searched: b.index.size,
    tookMs: Math.round(performance.now() - started),
  };
}

export async function suggestCorpus(input: { prefix: string; corpus: string | null }) {
  const b = await build(input.corpus);
  const state = await ensureGraph();
  const asked = [...new Set(state.memory.filter((m) => m.outcome !== "dead_end").map((m) => m.question))];
  return suggest(input.prefix, b.vocab, { asked, limit: 8 });
}

/**
 * A ranker for the sleep cycle's replay: question → passage ids (or files),
 * using the same text match and code links as the search bar, without case
 * memory (which is what's being re-weighed).
 */
export async function rankFiles(corpusId: string, opts: { by: "passage" | "file" }) {
  const b = await build(corpusId);
  const noCases: Built = { ...b, cases: emptyCaseMemory() };
  return (q: string) => {
    const hits = blend(noCases, q, b.index.search(parseSearchQuery(q.replace(/[-"]/g, " ")), 100));
    if (opts.by === "passage") return hits.map((h) => h.id);
    const seen: string[] = [];
    for (const h of hits) { const f = fileOf(b.rows.get(h.id)!); if (!seen.includes(f)) seen.push(f); }
    return seen;
  };
}
