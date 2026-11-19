/**
 * Case memory for code: which files earlier questions turned out to be about.
 *
 * When a question is resolved (an issue fixed, a source confirmed), the files
 * that answered it are filed against its text. A new question then borrows
 * from the earlier ones that read like it: "similar bug reports were fixed in
 * similar files" (BugLocator, Zhou et al., ICSE 2012), plus a small prior for
 * files that keep needing fixes, decayed with age (FixCache, Kim et al., ICSE
 * 2007).
 *
 * How much to trust this memory isn't fixed in code. During sleep (sleep.ts)
 * the memory replays its own history: each past case is ranked using only the
 * cases before it, under a few candidate weights, and the weights that would
 * have ranked the real answers highest are kept, but only if they beat the
 * weights in use by a margin (the SIM selector: accept the best evaluated
 * candidate or keep the current one). Every choice is journaled with what it
 * predicted and what it got.
 */
import { contentTokens } from "./text";

export interface Case { q: string; files: string[]; at: number }
export interface CaseWeights { similar: number; prior: number }
/** Off until sleep has evidence that the memory helps on this corpus. */
export const DEFAULT_CASE_WEIGHTS: CaseWeights = { similar: 0, prior: 0 };

export interface CaseJournalEntry {
  at: number;
  cases: number;
  current: CaseWeights;
  proposed: CaseWeights;
  /** Replay MRR of the files the past cases were really about. */
  currentScore: number;
  proposedScore: number;
  accepted: boolean;
  rationale: string;
}

export interface CaseMemoryState { version: 1; cases: Case[]; weights: CaseWeights; journal: CaseJournalEntry[] }
export const emptyCaseMemory = (): CaseMemoryState => ({ version: 1, cases: [], weights: { ...DEFAULT_CASE_WEIGHTS }, journal: [] });

const MAX_TERMS = 200;

/** Sparse tf-idf vectors over the cases, rebuilt as cases arrive (they're few). */
function vectorize(texts: string[]): { vecs: Array<Map<string, number>>; idf: (t: string) => number } {
  const toks = texts.map((t) => contentTokens(t).slice(0, 4 * MAX_TERMS));
  const df = new Map<string, number>();
  for (const ts of toks) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = texts.length + 1;
  const idf = (t: string) => Math.log(n / ((df.get(t) ?? 0) + 1)) + 1;
  const vecs = toks.map((ts) => {
    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, f] of tf) { const w = (1 + Math.log(f)) * idf(t); v.set(t, w); norm += w * w; }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  return { vecs, idf };
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) { const x = big.get(t); if (x) s += w * x; }
  return s;
}

/**
 * Evidence for each file from the earlier cases: Σ over the k most similar
 * cases of similarity / (files in that case), and a decayed fix-count prior.
 */
export function caseEvidence(cases: Case[], question: string, opts: { k?: number; halfLife?: number } = {}): { similar: Map<string, number>; prior: Map<string, number> } {
  const k = opts.k ?? 8, halfLife = opts.halfLife ?? 30;
  const similar = new Map<string, number>(), prior = new Map<string, number>();
  if (!cases.length) return { similar, prior };
  const { vecs } = vectorize([...cases.map((c) => c.q), question]);
  const qv = vecs.at(-1)!;
  const sims = cases.map((c, i) => ({ c, s: cosine(qv, vecs[i]!) })).filter((x) => x.s > 0.05).sort((a, b) => b.s - a.s).slice(0, k);
  for (const { c, s } of sims) for (const f of c.files) similar.set(f, (similar.get(f) ?? 0) + s / c.files.length);
  const latest = cases.at(-1)!.at;
  for (const c of cases) {
    const w = Math.pow(0.5, (latest - c.at) / halfLife);
    for (const f of c.files) prior.set(f, (prior.get(f) ?? 0) + w);
  }
  const maxPrior = Math.max(1, ...prior.values());
  for (const [f, v] of prior) prior.set(f, v / maxPrior);
  return { similar, prior };
}

/** Re-rank a file list with case evidence: base is reciprocal rank, memory adds on top. */
export function rerankWithCases(files: string[], ev: ReturnType<typeof caseEvidence>, w: CaseWeights): string[] {
  const score = new Map<string, number>();
  files.forEach((f, i) => score.set(f, 1 / (60 + i + 1)));
  const scale = 1 / 61;
  for (const [f, v] of ev.similar) score.set(f, (score.get(f) ?? 0) + w.similar * scale * v);
  for (const [f, v] of ev.prior) if (score.has(f)) score.set(f, score.get(f)! + w.prior * scale * v);
  return [...score].sort((a, b) => b[1] - a[1]).map(([f]) => f);
}

/** Candidate weights the sleep step evaluates. */
export const CASE_GRID: CaseWeights[] = [0, 0.25, 0.5, 1, 2].flatMap((similar) => [0, 0.1, 0.25].map((prior) => ({ similar, prior })));

/**
 * Sleep for case memory: replay history prequentially under each candidate
 * weighting, keep the best only if it beats the current weights by `margin`
 * in MRR over at least `minCases` replayed cases.
 */
export function consolidateCases(
  state: CaseMemoryState,
  rankBase: (q: string) => string[],
  opts: { margin?: number; minCases?: number; at?: number; grid?: CaseWeights[] } = {},
): CaseMemoryState {
  const margin = opts.margin ?? 0.03, minCases = opts.minCases ?? 8;
  const at = opts.at ?? Date.now();
  if (state.cases.length < minCases) return state;
  const bases = state.cases.map((c) => rankBase(c.q));
  const replay = (w: CaseWeights) => {
    let mrr = 0, n = 0;
    state.cases.forEach((c, i) => {
      if (i < 2) return;
      const ranked = rerankWithCases(bases[i]!, caseEvidence(state.cases.slice(0, i), c.q), w);
      const r = ranked.findIndex((f) => c.files.includes(f));
      mrr += r < 0 ? 0 : 1 / (r + 1);
      n++;
    });
    return n ? mrr / n : 0;
  };
  const currentScore = replay(state.weights);
  let best = state.weights, bestScore = currentScore;
  for (const w of opts.grid ?? CASE_GRID) {
    const s = replay(w);
    if (s > bestScore + 1e-9) { best = w; bestScore = s; }
  }
  const accepted = bestScore >= currentScore + margin;
  const entry: CaseJournalEntry = {
    at, cases: state.cases.length, current: state.weights, proposed: best, currentScore, proposedScore: bestScore, accepted,
    rationale: accepted
      ? `replaying ${state.cases.length} past cases, these weights rank the real answers higher (MRR ${currentScore.toFixed(3)} → ${bestScore.toFixed(3)})`
      : `no candidate beat the current weights by ${margin} MRR on replay; kept them`,
  };
  return { ...state, weights: accepted ? best : state.weights, journal: [...state.journal, entry].slice(-20) };
}

export function addCase(state: CaseMemoryState, c: Omit<Case, "at"> & { at?: number }): CaseMemoryState {
  const at = c.at ?? (state.cases.at(-1)?.at ?? 0) + 1;
  return { ...state, cases: [...state.cases, { q: c.q.slice(0, 4000), files: [...new Set(c.files)], at }].slice(-2000) };
}
