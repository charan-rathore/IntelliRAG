/**
 * Coverage-aware, redundancy-penalised context packing under a token budget.
 *
 * Problem: the reader only sees what fits in the context budget. Ranking whole
 * chunks and packing them in order spends the budget on the top chunk's
 * filler paragraphs while a lower-ranked chunk that holds the one missing fact
 * is cut. Recall@k on the candidate list looks fine; what the reader gets does
 * not ("Recall Is Not Enough", Bala 2026, arXiv:2607.00725).
 *
 * Method: select verbatim paragraph spans, not whole chunks, by greedy
 * maximisation of
 *
 *   F(S) = Σ_t w_t · [t covered by S]            query-aspect coverage (set cover, submodular)
 *        + λ · Σ_{u∈S} rel(u)                     calibrated relevance of primary sources (modular)
 *        − β · Σ_{u,v∈S} sim(u, v)                pairwise redundancy (AdaGReS, arXiv:2512.25052)
 *
 * subject to Σ cost(u) ≤ budget, picking the unit with the best gain per token
 * (cost-benefit greedy for knapsack constraints, Lin & Bilmes, NAACL 2010/ACL 2011),
 * then keeping the better of the greedy set and the best single unit (the
 * Khuller-Moss-Naor fix that restores a constant-factor bound when β = 0).
 *
 * β is set per query from the candidate pool, AdaGReS-style: choose β so the
 * expected marginal gain of the k̄-th pick is about zero, where k̄ ≈ budget /
 * mean unit cost. We use the (k̄ − 1) denominator from the derivation.
 *
 * Invariants that keep citations exact:
 *  - each source contributes at most ONE contiguous span of its own text, so a
 *    packed passage is always a verbatim slice of the stored chunk;
 *  - a heading paragraph never stands alone, and a fenced code block is never split;
 *  - secondary sources (did not pass the support gate) earn no relevance credit:
 *    they enter only by covering a question aspect nothing packed covers yet.
 *
 * Similarity is lexical (cosine over content-token counts) so the packer works
 * identically with or without stored embeddings.
 */
import { contentTokens, estimateTokens, stemToken, tokenize, tokenSetMatches } from "./text";
import type { RetrievedChunk } from "./types";

export type CoverageUnitTrace = {
  chunkId: string;
  paragraphs: [number, number];
  gain: number;
  cost: number;
  covers: string[];
};

export type CoverageReport = {
  /** Distinctive question terms, idf-weighted, that the packed context contains. */
  covered: string[];
  /** Distinctive question terms no packed passage contains. */
  missing: string[];
  /** idf-weighted share of question terms covered, 0..1. A lexical proxy, not entailment. */
  ratio: number;
  beta: number;
  steps: CoverageUnitTrace[];
  usedTokens: number;
  budget: number;
  /** "greedy" or "single" (best single unit beat the greedy set). */
  winner: "greedy" | "single";
  /** Paragraphs added by the contiguous fill phase after greedy selection. */
  filled: number;
};

/**
 * English function words that carry no answerable aspect of a question.
 * Deliberately generic (not tuned to any corpus); domain words such as
 * "server" or "process" stay in, because a passage that mentions them can be
 * the one that answers the question.
 */
const FUNCTION_WORDS = new Set(
  ("about above across after again against all also among any because been before being below between both but can could did does doing done down during each either else even ever every few further had has have having here into its itself just like make many may might more most much must near need neither never now off often once only other otherwise our ours out over own per rather same should since some such than their them then there these they those though through thus too under until upon very was way were when where whether which while who whom whose will within without would yes yet your yours " +
    "able actually already always another anyone anything currently establish exactly instead really something still want wants we us use using used " +
    // Quantities in a question are the asker's parameters, not facts to find.
    "one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand single double half").split(" "),
);

/** Question aspects to cover: content tokens minus function words, deduplicated. */
export function coverageTerms(query: string): string[] {
  return [...new Set(contentTokens(query).filter((t) => t.length >= 3 && !FUNCTION_WORDS.has(t) && !/^\d+$/.test(t)))];
}

/** Map a coverage stem back to the word the asker typed, for display. */
export function surfaceTerm(query: string, stem: string): string {
  for (const w of tokenize(query)) if (stemToken(w) === stem) return w;
  return stem;
}

export type CoveragePackInput = {
  /** Candidates in rank order. */
  pool: RetrievedChunk[];
  /** chunkIds that passed the support gate. Others are coverage-only. */
  primary: Set<string>;
  terms: string[];
  idf: Map<string, number>;
  budget: number;
  maxSources?: number;
  lambda?: number;
  /** Override adaptive β (tests/ablations). */
  beta?: number;
  /**
   * chunkIds packed whole before greedy selection starts (the anchor). The
   * top-ranked supported chunk is the single most likely home of the answer;
   * fragmenting it to chase rarer terms is the dominant failure without one.
   */
  seed?: string[];
};

type Unit = {
  src: number;
  lo: number;
  hi: number;
  text: string;
  cost: number;
  terms: Set<string>;
  bag: Map<string, number>;
};

type Source = {
  chunk: RetrievedChunk;
  primary: boolean;
  spans: Array<[number, number]>;
  units: Unit[];
};

/** Paragraph spans of `text`, merged so headings carry their body and code fences stay whole. */
export function paragraphUnits(text: string): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  for (let at = 0, m: RegExpExecArray | null, re = /\n[^\S\n]*\n\s*/g; ; ) {
    m = re.exec(text);
    const end = m ? m.index : text.length;
    if (text.slice(at, end).trim()) raw.push([at, end]);
    if (!m) break;
    at = m.index + m[0].length;
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < raw.length; i++) {
    let [a, b] = raw[i]!;
    const fences = () => (text.slice(a, b).match(/^\s*```/gm) ?? []).length;
    const headingOnly = () => /^\s*#{1,6}\s/.test(text.slice(a, b)) && !text.slice(a, b).trim().includes("\n");
    while (i + 1 < raw.length && (fences() % 2 === 1 || headingOnly())) b = raw[++i]![1];
    out.push([a, b]);
  }
  return out;
}

function bagOf(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const t of contentTokens(text)) bag.set(t, (bag.get(t) ?? 0) + 1);
  return bag;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, v] of a) {
    na += v * v;
    const w = b.get(t);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function packByCoverage(input: CoveragePackInput): { packed: RetrievedChunk[]; report: CoverageReport } {
  const lambda = input.lambda ?? 0.6;
  const maxSources = input.maxSources ?? 4;
  const terms = [...new Set(input.terms)];
  const rawW = terms.map((t) => input.idf.get(t) ?? 1);
  const wSum = rawW.reduce((s, x) => s + x, 0) || 1;
  const weight = new Map(terms.map((t, i) => [t, rawW[i]! / wSum]));

  const sources: Source[] = input.pool.map((chunk, src) => {
    const spans = paragraphUnits(chunk.text);
    const units = spans.map(([a, b], i): Unit => {
      const text = chunk.text.slice(a, b);
      const doc = new Set(contentTokens(text));
      return {
        src,
        lo: i,
        hi: i,
        text,
        cost: estimateTokens(text),
        terms: new Set(terms.filter((t) => tokenSetMatches(t, doc))),
        bag: bagOf(text),
      };
    });
    return { chunk, primary: input.primary.has(chunk.chunkId), spans, units };
  });

  const rel = (u: Unit) => {
    const s = sources[u.src]!;
    if (!s.primary) return 0;
    // A paragraph that mentions no question term still carries some of its
    // source's relevance (definitions, the code example under a heading).
    return Math.max(0, s.chunk.score) * (u.terms.size ? 1 : 0.25);
  };

  // ---- adaptive β (AdaGReS): marginal gain of the k̄-th pick ≈ 0 ----
  const all = sources.flatMap((s) => s.units);
  let beta = input.beta ?? 0;
  if (input.beta == null && all.length > 1) {
    const top = [...all].sort((a, b) => rel(b) + cov(b, new Set()) - (rel(a) + cov(a, new Set()))).slice(0, 24);
    const meanCost = top.reduce((s, u) => s + u.cost, 0) / top.length;
    const kBar = Math.max(2, input.budget / Math.max(1, meanCost));
    const meanGain = top.reduce((s, u) => s + lambda * rel(u) + cov(u, new Set()), 0) / top.length;
    let simSum = 0;
    let pairs = 0;
    for (let i = 0; i < top.length; i++)
      for (let j = i + 1; j < top.length; j++) {
        simSum += cosine(top[i]!.bag, top[j]!.bag);
        pairs++;
      }
    const meanSim = pairs ? simSum / pairs : 0;
    beta = Math.min(2, Math.max(0, meanGain / ((kBar - 1) * meanSim + 1e-6)));
  }

  function cov(u: { terms: Set<string> }, covered: Set<string>): number {
    let g = 0;
    for (const t of u.terms) if (!covered.has(t)) g += weight.get(t) ?? 0;
    return g;
  }

  // Span state: one contiguous [lo, hi] per source.
  type State = Map<number, [number, number]>;
  const spanText = (s: Source, lo: number, hi: number) => s.chunk.text.slice(s.spans[lo]![0], s.spans[hi]![1]);

  function objective(state: State): { value: number; covered: Set<string>; tokens: number } {
    const covered = new Set<string>();
    let relSum = 0;
    let tokens = 0;
    const bags: Array<Map<string, number>> = [];
    for (const [src, [lo, hi]] of state) {
      const s = sources[src]!;
      tokens += estimateTokens(spanText(s, lo, hi));
      for (let i = lo; i <= hi; i++) {
        const u = s.units[i]!;
        for (const t of u.terms) covered.add(t);
        relSum += rel(u);
        bags.push(u.bag);
      }
    }
    let red = 0;
    for (let i = 0; i < bags.length; i++) for (let j = i + 1; j < bags.length; j++) red += cosine(bags[i]!, bags[j]!);
    let c = 0;
    for (const t of covered) c += weight.get(t) ?? 0;
    return { value: c + lambda * relSum - beta * red, covered, tokens };
  }

  const state: State = new Map();
  const steps: CoverageUnitTrace[] = [];
  for (const id of input.seed ?? []) {
    const src = sources.findIndex((s) => s.chunk.chunkId === id);
    if (src < 0 || !sources[src]!.units.length) continue;
    const next = new Map(state);
    next.set(src, [0, sources[src]!.units.length - 1]);
    if (objective(next).tokens > input.budget) continue;
    state.set(src, [0, sources[src]!.units.length - 1]);
    steps.push({ chunkId: id, paragraphs: [0, sources[src]!.units.length - 1], gain: 0, cost: objective(state).tokens, covers: [] });
  }
  let current = objective(state);
  for (;;) {
    let best: { src: number; lo: number; hi: number; gain: number; cost: number; ratio: number; covers: string[] } | null = null;
    for (const s of sources) {
      const src = sources.indexOf(s);
      const have = state.get(src);
      if (!have && state.size >= maxSources) continue;
      for (let i = 0; i < s.units.length; i++) {
        if (have && i >= have[0] && i <= have[1]) continue;
        const lo = have ? Math.min(have[0], i) : i;
        const hi = have ? Math.max(have[1], i) : i;
        const next = new Map(state);
        next.set(src, [lo, hi]);
        const val = objective(next);
        if (val.tokens > input.budget) continue;
        const gain = val.value - current.value;
        const cost = val.tokens - current.tokens;
        if (gain <= 1e-9 || cost <= 0) continue;
        const ratio = gain / cost;
        if (!best || ratio > best.ratio) {
          best = { src, lo, hi, gain, cost, ratio, covers: [...val.covered].filter((t) => !current.covered.has(t)) };
        }
      }
    }
    if (!best) break;
    state.set(best.src, [best.lo, best.hi]);
    current = objective(state);
    steps.push({ chunkId: sources[best.src]!.chunk.chunkId, paragraphs: [best.lo, best.hi], gain: best.gain, cost: best.cost, covers: best.covers });
  }

  // Best single contiguous unit, for the knapsack constant-factor guarantee.
  let single: { state: State; value: number } | null = null;
  for (const [src, s] of sources.entries())
    for (let i = 0; i < s.units.length; i++) {
      const st: State = new Map([[src, [i, i]]]);
      const v = objective(st);
      if (v.tokens <= input.budget && (!single || v.value > single.value)) single = { state: st, value: v.value };
    }
  let winner: "greedy" | "single" = "greedy";
  let finalState: State = new Map(state);
  if (single && single.value > current.value + 1e-9) {
    winner = "single";
    finalState = single.state;
  }
  // Small-to-big fill. The greedy objective stops once redundancy outweighs
  // new coverage, often well under budget, and the sentence that *explains*
  // a matched term usually sits next to it without repeating the question's
  // words. Spend the remaining budget growing chosen spans contiguously
  // (primary sources first, by relevance per token), then on unchosen primary
  // sources in rank order. Fill never removes anything the greedy chose.
  let filled = 0;
  for (;;) {
    let pick: { src: number; lo: number; hi: number; priority: number } | null = null;
    const cur = objective(finalState);
    for (const [src, s] of sources.entries()) {
      if (!s.primary) continue;
      const have = finalState.get(src);
      const options: Array<[number, number]> = have
        ? [[have[0] - 1, have[1]], [have[0], have[1] + 1]]
        : finalState.size < maxSources ? [[0, 0]] : [];
      for (const [lo, hi] of options) {
        if (lo < 0 || hi >= s.units.length) continue;
        const next = new Map(finalState);
        next.set(src, [lo, hi]);
        const tokens = objective(next).tokens;
        if (tokens > input.budget) continue;
        const added = have ? s.units[lo < have[0] ? lo : hi]! : s.units[0]!;
        const priority = (Math.max(0.01, s.chunk.score) * (1 + added.terms.size) * (have ? 1 : 0.5)) / Math.max(1, tokens - cur.tokens);
        if (!pick || priority > pick.priority) pick = { src, lo, hi, priority };
      }
    }
    if (!pick) break;
    finalState.set(pick.src, [pick.lo, pick.hi]);
    filled++;
  }

  const fin = objective(finalState);

  const packed: RetrievedChunk[] = [...finalState.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([src, [lo, hi]], i) => {
      const s = sources[src]!;
      const whole = lo === 0 && hi === s.spans.length - 1;
      const text = whole ? s.chunk.text : spanText(s, lo, hi);
      return { ...s.chunk, text, tokenCount: whole ? s.chunk.tokenCount : estimateTokens(text), rank: i + 1 };
    });

  const covered = terms.filter((t) => fin.covered.has(t));
  const missing = terms.filter((t) => !fin.covered.has(t));
  const ratio = covered.reduce((s, t) => s + (weight.get(t) ?? 0), 0);
  return {
    packed,
    report: { covered, missing, ratio, beta, steps, usedTokens: fin.tokens, budget: input.budget, winner, filled },
  };
}

/**
 * Coverage diagnostic for an already-packed context (no selection). Used on
 * the default rank-order path so every answer can say which question terms
 * its context never mentions. Lexical, so it flags candidates for doubt; it
 * does not prove the context insufficient (a paraphrase can answer a term).
 */
export function coverageReportOf(
  packed: RetrievedChunk[],
  terms: string[],
  idf: Map<string, number>,
  budget: number,
): CoverageReport {
  const uniq = [...new Set(terms)];
  const raw = uniq.map((t) => idf.get(t) ?? 1);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const doc = new Set(packed.flatMap((c) => contentTokens(c.text)));
  const covered = uniq.filter((t) => tokenSetMatches(t, doc));
  const missing = uniq.filter((t) => !covered.includes(t));
  const ratio = covered.reduce((a, t) => a + raw[uniq.indexOf(t)]! / sum, 0);
  return {
    covered,
    missing,
    ratio,
    beta: 0,
    steps: [],
    usedTokens: packed.reduce((n, c) => n + c.tokenCount, 0),
    budget,
    winner: "greedy",
    filled: 0,
  };
}


/**
 * Names in the question that the whole corpus never mentions. "What caused the
 * Kubernetes pod scheduling failures?" asked of a queue library's README:
 * passages about scheduling pass the support gate, but the thing the question
 * is about is not in the source at all, so any answer would be about something
 * else. Only names count (a capitalised word that doesn't start the sentence,
 * camelCase, or a token with a dot or digit): plain words a question happens
 * to use ("writes a final report") are often absent from a source that still
 * answers it, which the evaluation showed.
 */
export function absentSubject(query: string, vocab: Set<string>): string[] {
  const named: string[] = [];
  for (const sentence of query.split(/(?<=[.?!:;])\s+/)) {
    const words = sentence.match(/[A-Za-z][\w.-]*[\w]|[A-Za-z]/g) ?? [];
    named.push(...words.filter((w, i) => (i > 0 && /^[A-Z][a-z]{2,}/.test(w)) || /[a-z][A-Z]/.test(w) || /[.\d]/.test(w.slice(1))));
  }
  const absent: string[] = [];
  for (const w of named) {
    const parts = contentTokens(w).filter((t) => t.length >= 3);
    if (parts.length && parts.every((t) => !tokenSetMatches(t, vocab))) absent.push(w);
  }
  return [...new Set(absent)];
}
