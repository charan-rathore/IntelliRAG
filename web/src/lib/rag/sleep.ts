/**
 * The sleep cycle: offline consolidation and dreaming for a corpus's memory.
 *
 * Two Google papers shape it.
 *
 *  - "Language Models Need Sleep" (Behrouz, Hashemi, Mirrokni; arXiv 2606.03979,
 *    and the Oct 2026 Google Research post). A model alternates a wake phase,
 *    which keeps new information in fast short-term memory, with a sleep phase
 *    that takes no input and (1) consolidates short-term memory into new,
 *    separate long-term parameters, leaving old ones fixed so nothing is
 *    forgotten, and (2) "dreams": generates synthetic practice examples, tries
 *    each on a temporary copy, and keeps only those that improve a metric.
 *
 *  - "Self-Improvement Memory" (Yu et al., arXiv 2611.18856). Every edit is
 *    recorded with its rationale, the outcome it predicted and the outcome it
 *    got, and the proposer reads that memory before proposing again, so it stops
 *    repeating edits that failed.
 *
 * IntelliRAG has no weights to train, so the same ideas act on its memory:
 *
 *   wake   experience.ts files each rated question against the passages it was
 *          answered from. That is fast memory: specific wordings, specific
 *          passages.
 *   sleep  1. Replay. The questions people confirmed are re-asked. That is the
 *             metric, and the guard against forgetting.
 *          2. Consolidate. Across all confirmed pairs, which words people use
 *             for which words the sources use ("throttle" for "interval cap").
 *             This lexicon is new, separate memory: source text and its term
 *             statistics are never edited.
 *          3. Dream. For passages nobody has asked about yet, write questions in
 *             people's vocabulary (the lexicon), in the words hidden inside
 *             identifiers (`onSizeLessThan`), and in the section's context.
 *          4. Filter, as in the paper: each dream is tried on a copy of memory
 *             and kept only if its passage is now found when it wasn't before,
 *             no confirmed question loses its passage, and no dead end comes
 *             back. Rejected dreams leave nothing behind.
 *          5. Journal (SIM). Each strategy's proposals, acceptances and the
 *             reason for every rejection are kept; the next sleep gives more of
 *             its budget to strategies that have been working, and pauses one
 *             that has failed twice running.
 *
 * Retrieval is passed in, so this file is pure and the same cycle runs in the
 * app, in the MCP server and in the evals.
 */
import { contentTokens, tokenize, QUERY_STOPWORDS } from "./text";
import { recordExperience, fingerprint, type ExperienceLog } from "./experience";

export type DreamStrategy = "lexicon" | "identifiers" | "context" | "model";
export const DREAM_STRATEGIES: DreamStrategy[] = ["lexicon", "identifiers", "context", "model"];

export interface SleepPassage {
  chunkId: string;
  text: string;
  heading?: string | null;
  symbol?: string | null;
  filepath?: string | null;
  title?: string | null;
}

export interface SleepEnv {
  corpusId: string;
  passages: SleepPassage[];
  /** Chunk ids packed into the answer context for this question under this memory. */
  packed: (question: string, log: ExperienceLog) => string[];
  /** Optional model-written questions for a passage (doc2query); filtered like any dream. */
  generate?: (passage: SleepPassage) => string[];
}

export type Rejection = "already-found" | "no-gain" | "forgetting" | "dead-end-returned" | "duplicate";

export interface StrategyStats {
  proposed: number;
  accepted: number;
  rejected: Partial<Record<Rejection, number>>;
}

export interface SleepCycle {
  at: string;
  /** Confirmed questions whose passage was found, before and after this sleep. */
  replay: { total: number; before: number; after: number; rolledBack?: boolean };
  lexicon: number;
  strategies: Partial<Record<DreamStrategy, StrategyStats & { budget: number; paused?: boolean; rationale: string }>>;
  kept: Array<{ chunkId: string; question: string; strategy: DreamStrategy }>;
}

export interface SleepJournal {
  version: 1;
  cycles: SleepCycle[];
  /** Totals across every cycle, the bandit's evidence. */
  totals: Partial<Record<DreamStrategy, StrategyStats>>;
}

/** Below this many rated questions, every dream is replayed against all of them. */
export const FULL_REPLAY = 40;

export const emptyJournal = (): SleepJournal => ({ version: 1, cycles: [], totals: {} });

export interface SleepOptions {
  /** Most dreams tried per cycle (each costs a few retrievals). */
  budget?: number;
  /** Most dreams kept per passage per cycle. */
  perPassage?: number;
  /** Skip passages that already have this many confirmed questions. */
  coveredAt?: number;
  now?: string;
  /** Cycles to keep in the journal. */
  keepCycles?: number;
}

/* ------------------------------- replay -------------------------------- */

interface Probe { q: string; chunkId: string; vote: 1 | -1 }

/** Questions people rated, as probes: confirmed ones must stay found, dead ends must stay gone. */
export function replayProbes(log: ExperienceLog, corpusId: string): Probe[] {
  const out: Probe[] = [];
  for (const e of Object.values(log.entries)) {
    if (e.corpusId !== corpusId) continue;
    for (const a of e.asked) if (!a.by) out.push({ q: a.q, chunkId: e.chunkId, vote: a.vote });
  }
  return out;
}

/* ----------------------------- consolidate ----------------------------- */

/** Which words people use for which words the sources use: source term → people's terms. */
export type Lexicon = Map<string, Array<{ term: string; weight: number }>>;

/**
 * Learned from confirmed (question, passage) pairs: a question word that the
 * passage lacks, against the passage's distinctive words, scored by positive
 * PMI over the pairs (the translation-model view of query expansion, Berger &
 * Lafferty 1999). A pair only counts once per distinct question.
 */
export function consolidateLexicon(pairs: Array<{ q: string; text: string }>, idf: (t: string) => number, opts: { minCount?: number; perTerm?: number } = {}): Lexicon {
  const minCount = opts.minCount ?? 2, perTerm = opts.perTerm ?? 4;
  const qCount = new Map<string, number>(), dCount = new Map<string, number>(), co = new Map<string, Map<string, number>>();
  let n = 0;
  for (const { q, text } of pairs) {
    const docTerms = new Set(contentTokens(text));
    const people = [...new Set(contentTokens(q))].filter((t) => !docTerms.has(t) && t.length > 2);
    // The passage's most distinctive words stand for it.
    const anchors = [...docTerms].sort((a, b) => idf(b) - idf(a)).slice(0, 12);
    if (!people.length || !anchors.length) continue;
    n++;
    for (const d of anchors) dCount.set(d, (dCount.get(d) ?? 0) + 1);
    for (const u of people) {
      qCount.set(u, (qCount.get(u) ?? 0) + 1);
      for (const d of anchors) {
        let row = co.get(d);
        if (!row) co.set(d, (row = new Map()));
        row.set(u, (row.get(u) ?? 0) + 1);
      }
    }
  }
  const lex: Lexicon = new Map();
  for (const [d, row] of co) {
    const list: Array<{ term: string; weight: number }> = [];
    for (const [u, c] of row) {
      if (c < minCount) continue;
      const pmi = Math.log((c * n) / (dCount.get(d)! * qCount.get(u)!));
      if (pmi > 0) list.push({ term: u, weight: pmi * Math.min(1, c / 4) });
    }
    list.sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1));
    if (list.length) lex.set(d, list.slice(0, perTerm));
  }
  return lex;
}

/* -------------------------------- dream -------------------------------- */

/** camelCase, PascalCase, snake_case and kebab-case into words: `onSizeLessThan` → on size less than. */
export function identifierWords(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 1);
}

const IDENT = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:[a-z0-9][A-Z]|_[A-Za-z])[A-Za-z0-9_$]*\b/g;

export function dreamsFor(p: SleepPassage, strategy: DreamStrategy, ctx: { lexicon: Lexicon; idf: (t: string) => number; generate?: SleepEnv["generate"] }): string[] {
  if (strategy === "identifiers") {
    // Only words the passage doesn't already spell out: a dream made of words
    // the passage contains finds it already and teaches nothing.
    const have = new Set(tokenize(p.text));
    const ids = [...new Set(p.text.match(IDENT) ?? [])];
    const out: string[] = [];
    for (const id of ids) {
      const words = identifierWords(id).filter((w) => !have.has(w) && !QUERY_STOPWORDS.has(w));
      if (words.length >= 2) out.push(identifierWords(id).join(" "));
      if (out.length >= 2) break;
    }
    return out;
  }
  if (strategy === "context") {
    const ctxWords = [p.title, p.heading, p.symbol ? identifierWords(p.symbol).join(" ") : null, p.filepath?.replace(/[/._-]+/g, " ")]
      .filter(Boolean).join(" ");
    const fresh = tokenize(ctxWords).filter((t) => t.length > 2 && !QUERY_STOPWORDS.has(t) && !p.text.toLowerCase().includes(t));
    return fresh.length >= 2 ? [[...new Set(fresh)].slice(0, 6).join(" ")] : [];
  }
  if (strategy === "lexicon") {
    // Swap the passage's words for the ones people use for them.
    const doc = new Set(contentTokens(p.text));
    const swaps: string[] = [];
    for (const d of [...doc].sort((a, b) => ctx.idf(b) - ctx.idf(a))) {
      const alt = ctx.lexicon.get(d)?.[0];
      if (alt && !doc.has(alt.term) && !swaps.includes(alt.term)) swaps.push(alt.term);
      if (swaps.length >= 3) break;
    }
    return swaps.length >= 2 ? [swaps.join(" ")] : [];
  }
  return ctx.generate ? ctx.generate(p).slice(0, 2) : [];
}

/* ------------------------------- bandit -------------------------------- */

/**
 * The SIM step: give each strategy budget in proportion to how often its dreams
 * have been kept (Beta(1,1) mean over the journal), pause one whose last two
 * cycles proposed something and kept nothing, and always leave each live
 * strategy at least one try so it can recover.
 */
export function allocate(journal: SleepJournal, budget: number, available: DreamStrategy[]): Map<DreamStrategy, { budget: number; paused: boolean; rationale: string }> {
  const out = new Map<DreamStrategy, { budget: number; paused: boolean; rationale: string }>();
  const recent = journal.cycles.slice(-2);
  const mean = (s: DreamStrategy) => {
    const t = journal.totals[s];
    return t ? (t.accepted + 1) / (t.proposed + 2) : 0.5;
  };
  const live = available.filter((s) => {
    const failedTwice = recent.length === 2 && recent.every((c) => (c.strategies[s]?.proposed ?? 0) > 0 && (c.strategies[s]?.accepted ?? 0) === 0);
    if (failedTwice) out.set(s, { budget: 0, paused: true, rationale: "kept nothing two sleeps running; paused for one" });
    return !failedTwice;
  });
  // A strategy paused last time comes back.
  const total = live.reduce((a, s) => a + mean(s), 0) || 1;
  for (const s of live) {
    const share = Math.max(1, Math.round((budget * mean(s)) / total));
    const t = journal.totals[s];
    out.set(s, { budget: share, paused: false, rationale: t ? `kept ${t.accepted} of ${t.proposed} so far` : "first try" });
  }
  return out;
}

/* -------------------------------- sleep -------------------------------- */

export interface SleepResult {
  log: ExperienceLog;
  journal: SleepJournal;
  cycle: SleepCycle;
  lexicon: Lexicon;
}

export function sleep(env: SleepEnv, log: ExperienceLog, journal: SleepJournal = emptyJournal(), opts: SleepOptions = {}): SleepResult {
  const budget = opts.budget ?? 40, perPassage = opts.perPassage ?? 2, coveredAt = opts.coveredAt ?? 2;
  const at = opts.now ?? new Date().toISOString();
  const live = new Map(env.passages.map((p) => [p.chunkId, p]));

  // Corpus statistics, read-only.
  const df = new Map<string, number>();
  for (const p of env.passages) for (const t of new Set(contentTokens(p.text))) df.set(t, (df.get(t) ?? 0) + 1);
  const N = env.passages.length || 1;
  const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));

  // 1. Replay what people confirmed and rejected, on the memory as it is.
  const probes = replayProbes(log, env.corpusId).filter((p) => {
    const e = log.entries[`${env.corpusId}\u0000${p.chunkId}`];
    const live_ = live.get(p.chunkId);
    return live_ && e && e.fingerprint === fingerprint(live_.text);
  });
  const found = (pr: Probe, l: ExperienceLog) => env.packed(pr.q, l).includes(pr.chunkId);
  const baseline = new Map(probes.map((pr, i) => [i, found(pr, log)]));
  const confirmed = probes.filter((p) => p.vote > 0);
  const before = confirmed.filter((p) => baseline.get(probes.indexOf(p))).length;

  // 2. Consolidate people's vocabulary into a lexicon (new, separate memory).
  const lexicon = consolidateLexicon(confirmed.map((p) => ({ q: p.q, text: live.get(p.chunkId)!.text })), idf);

  // 3. Dream for passages people haven't covered yet, rarest first.
  const covered = new Map<string, number>();
  for (const p of confirmed) covered.set(p.chunkId, (covered.get(p.chunkId) ?? 0) + 1);
  const targets = env.passages.filter((p) => (covered.get(p.chunkId) ?? 0) < coveredAt);
  const available = DREAM_STRATEGIES.filter((s) => s !== "model" || env.generate);
  const plan = allocate(journal, budget, available);

  const stats = new Map<DreamStrategy, StrategyStats>();
  const kept: SleepCycle["kept"] = [];
  const keptPer = new Map<string, number>();
  let mem = log;
  const tried = new Set<string>();
  const probeTerms = probes.map((p) => new Set(contentTokens(p.q)));

  for (const s of available) {
    const st: StrategyStats = { proposed: 0, accepted: 0, rejected: {} };
    stats.set(s, st);
    let left = plan.get(s)?.budget ?? 0;
    const reject = (r: Rejection) => { st.rejected[r] = (st.rejected[r] ?? 0) + 1; };
    for (const p of targets) {
      if (left <= 0) break;
      for (const q of dreamsFor(p, s, { lexicon, idf, generate: env.generate })) {
        if (left <= 0 || (keptPer.get(p.chunkId) ?? 0) >= perPassage) break;
        const key = `${p.chunkId}\u0000${q.toLowerCase()}`;
        if (!q.trim() || tried.has(key)) { if (q.trim()) reject("duplicate"); continue; }
        tried.add(key);
        left--;
        st.proposed++;
        // A dream that already finds its passage teaches nothing.
        if (env.packed(q, mem).includes(p.chunkId)) { reject("already-found"); continue; }
        // Try it on a copy of memory.
        const trial = recordExperience(mem, { corpusId: env.corpusId, question: q, passages: [p], vote: 1, at, dream: { strategy: s } });
        if (!env.packed(q, trial).includes(p.chunkId)) { reject("no-gain"); continue; }
        // Replay every probe while there are few; past that, the ones the dream
        // could touch (sharing a word with it), and a full replay at the end.
        const qt = new Set(contentTokens(q));
        let verdict: Rejection | null = null;
        for (let i = 0; i < probes.length && !verdict; i++) {
          if (probes.length > FULL_REPLAY && ![...qt].some((t) => probeTerms[i]!.has(t))) continue;
          const pr = probes[i]!;
          const now = found(pr, trial);
          if (pr.vote > 0 && baseline.get(i) && !now) verdict = "forgetting";
          if (pr.vote < 0 && !baseline.get(i) && now) verdict = "dead-end-returned";
        }
        if (verdict) { reject(verdict); continue; }
        mem = trial;
        st.accepted++;
        keptPer.set(p.chunkId, (keptPer.get(p.chunkId) ?? 0) + 1);
        kept.push({ chunkId: p.chunkId, question: q, strategy: s });
      }
    }
  }

  let after = confirmed.filter((p) => found(p, mem)).length;
  let rolledBack = false;
  if (after < before) {
    // The final full replay found a loss the per-dream checks missed: keep nothing.
    mem = log;
    after = before;
    rolledBack = true;
    kept.length = 0;
    for (const st of stats.values()) { st.rejected.forgetting = (st.rejected.forgetting ?? 0) + st.accepted; st.accepted = 0; }
  }
  const cycle: SleepCycle = {
    at,
    replay: { total: confirmed.length, before, after, ...(rolledBack ? { rolledBack } : {}) },
    lexicon: lexicon.size,
    strategies: Object.fromEntries(DREAM_STRATEGIES.map((s) => {
      const pl = plan.get(s);
      const st = stats.get(s) ?? { proposed: 0, accepted: 0, rejected: {} };
      return [s, { ...st, budget: pl?.budget ?? 0, paused: pl?.paused, rationale: pl?.rationale ?? (s === "model" ? "no model configured" : "") }];
    })),
    kept,
  };
  const totals = { ...journal.totals };
  for (const [s, st] of stats) {
    const t = totals[s] ?? { proposed: 0, accepted: 0, rejected: {} };
    const rejected = { ...t.rejected };
    for (const [r, n] of Object.entries(st.rejected)) rejected[r as Rejection] = (rejected[r as Rejection] ?? 0) + (n ?? 0);
    totals[s] = { proposed: t.proposed + st.proposed, accepted: t.accepted + st.accepted, rejected };
  }
  const cycles = [...journal.cycles, cycle].slice(-(opts.keepCycles ?? 20));
  return { log: mem, journal: { version: 1, cycles, totals }, cycle, lexicon };
}
