/**
 * Experience memory: what this corpus has learned about which passage answers
 * which way of asking.
 *
 * Every answer a person rates is filed back against the passages it was built
 * from: the question's wording is attached to those passages ("asked as").
 * A later question worded differently, such as "kill a job that's mid-flight"
 * against a README that only says "AbortSignal" and "already running", then
 * matches through the wordings people used before. This is document expansion
 * from real queries rather than generated ones: doc2query (Nogueira et al.,
 * 2019) with the query log as the generator. It is also the "file good answers
 * back into the wiki" step of Karpathy's LLM-wiki pattern (April 2026), done at
 * the passage level so citations still point at the raw source, which is never
 * edited.
 *
 * Three rules keep it honest:
 *  - The source decides. Expansions only add wording to how a passage is
 *    matched and scored; the passage cited is always the raw text, and the
 *    refusal checks (absent names, the turn's own terms) still run on it.
 *  - Learning is tied to the text it learned about. Each link stores a
 *    fingerprint of the passage; when the passage changes, the link is stale
 *    and dropped (`lint`), like a stale claim in a wiki lint pass.
 *  - People can undo it. A dead end on an answer removes that wording's
 *    support for those passages and demotes them for questions like it. The
 *    latest rating of a question wins, as in reflect().
 */
import { contentTokens } from "./text";

export type Vote = 1 | -1;

export interface AskedAs {
  /** The question as asked. */
  q: string;
  vote: Vote;
  at: string;
  /**
   * Who asked it: a person (absent), or a dream the sleep cycle generated and
   * kept because it helped without costing any real question (sleep.ts).
   */
  by?: "dream";
  /** For a dream: which strategy produced it. */
  strategy?: string;
}

export interface ExperienceEntry {
  corpusId: string;
  chunkId: string;
  /** Fingerprint of the passage text the link was learned on. */
  fingerprint: string;
  asked: AskedAs[];
}

export interface ExperienceLog {
  version: 1;
  entries: Record<string, ExperienceEntry>;
}

export const MAX_ASKED_PER_PASSAGE = 16;
/** Dreams never take more than this many of a passage's slots. */
export const MAX_DREAMS_PER_PASSAGE = 3;

/** Keep the newest links, evicting dreams before anything a person said. */
function trim(asked: AskedAs[]): AskedAs[] {
  let dreams = asked.filter((a) => a.by === "dream");
  if (dreams.length > MAX_DREAMS_PER_PASSAGE) {
    const drop = new Set(dreams.slice(0, dreams.length - MAX_DREAMS_PER_PASSAGE));
    asked = asked.filter((a) => !drop.has(a));
  }
  while (asked.length > MAX_ASKED_PER_PASSAGE) {
    const i = asked.findIndex((a) => a.by === "dream");
    asked = i >= 0 ? asked.filter((_, j) => j !== i) : asked.slice(1);
  }
  return asked;
}

/**
 * How strongly experience counts. These are the knobs the self-improvement
 * loop (scripts/sim-optimize.ts) edits, with its reasons kept in eval/sim.
 */
export interface ExperiencePolicy {
  /** Most a confirmed similar question adds to a passage's calibrated score. */
  boost: number;
  /** Least question overlap (0..1) for that boost to apply. */
  boostFloor: number;
  /** Score taken off a passage for a question like one rated a dead end on it. */
  demoteBy: number;
  /** Least question overlap (Jaccard) for that demotion. */
  demoteSimilarity: number;
  /** Fuse a BM25 ranking over learned wordings with the passage ranking. */
  fuse: boolean;
}

export const DEFAULT_EXPERIENCE_POLICY: ExperiencePolicy = { boost: 0.25, boostFloor: 0.2, demoteBy: 0.12, demoteSimilarity: 0.5, fuse: true };

export const emptyExperience = (): ExperienceLog => ({ version: 1, entries: {} });

/** FNV-1a over the passage text: cheap, synchronous, enough to notice an edit. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const keyOf = (corpusId: string, chunkId: string) => `${corpusId}\u0000${chunkId}`;
const normalize = (q: string) => q.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** File a rated answer against the passages it was built from. Returns a new log. */
export function recordExperience(
  log: ExperienceLog,
  input: { corpusId: string; question: string; passages: Array<{ chunkId: string; text: string }>; vote: Vote; at?: string; dream?: { strategy: string } },
): ExperienceLog {
  const at = input.at ?? new Date().toISOString();
  const entries = { ...log.entries };
  const nq = normalize(input.question);
  if (!nq) return log;
  for (const p of input.passages) {
    const key = keyOf(input.corpusId, p.chunkId);
    const fp = fingerprint(p.text);
    const prev = entries[key];
    // Learning about older text doesn't carry over to new text.
    let asked = prev && prev.fingerprint === fp ? prev.asked.filter((a) => normalize(a.q) !== nq) : [];
    // A person outranks a dream: a dead end on this passage retires the dreams
    // that resemble the question.
    if (!input.dream && input.vote < 0) {
      const qt = new Set(contentTokens(input.question));
      asked = asked.filter((a) => a.by !== "dream" || overlap(qt, new Set(contentTokens(a.q))) < 0.5);
    }
    // ...and a dream never overwrites a rating a person gave the same words.
    if (input.dream && prev && prev.fingerprint === fp && prev.asked.some((a) => !a.by && normalize(a.q) === nq)) continue;
    asked.push(input.dream ? { q: input.question.trim(), vote: input.vote, at, by: "dream", strategy: input.dream.strategy } : { q: input.question.trim(), vote: input.vote, at });
    entries[key] = { corpusId: input.corpusId, chunkId: p.chunkId, fingerprint: fp, asked: trim(asked) };
  }
  return { version: 1, entries };
}

export interface Recall {
  /** Wordings people confirmed for a passage, to match and score it with. */
  expansions: Map<string, string>;
  /**
   * For a passage confirmed on a question like this one: how alike the two
   * questions are (0..1), times how reliable the passage's ratings have been.
   * Case-based recall: the passages that answered a similar question before.
   * Already scaled by the policy's boost: added to the calibrated score as is.
   */
  boost: Map<string, number>;
  /** The same similarity × reliability, unscaled (0..1), for the support gate. */
  learned: Map<string, number>;
  /** Score to take off a passage for a question like one rated a dead end on it. */
  demote: Map<string, number>;
  /** How many links were used, for the trace. */
  used: number;
}

/** Share of the smaller question's terms the two share: rewordings vary in length. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * What the log knows about these passages, for this question. Only links whose
 * fingerprint still matches the passage are used.
 */
export function recallExperience(
  log: ExperienceLog | null | undefined,
  corpusId: string,
  passages: Array<{ chunkId: string; text: string }>,
  question: string,
  policy: Partial<ExperiencePolicy> = {},
): Recall {
  const expansions = new Map<string, string>();
  const demote = new Map<string, number>();
  const boost = new Map<string, number>();
  const learned = new Map<string, number>();
  if (!log) return { expansions, boost, learned, demote, used: 0 };
  const qTokens = new Set(contentTokens(question));
  const pol = { ...DEFAULT_EXPERIENCE_POLICY, ...policy };
  const threshold = pol.demoteSimilarity;
  const by = pol.demoteBy;
  let used = 0;
  for (const p of passages) {
    const e = log.entries[keyOf(corpusId, p.chunkId)];
    if (!e || e.fingerprint !== fingerprint(p.text)) continue;
    const positive = e.asked.filter((a) => a.vote > 0).map((a) => a.q);
    if (positive.length) {
      // Only wordings that resemble this question count for it. A passage that
      // answered many different questions would otherwise collect all their
      // words and start matching everything (the hub problem of document
      // expansion).
      const scored = positive.map((q) => ({ q, sim: overlap(qTokens, new Set(contentTokens(q))) }));
      const alike = scored.filter((x) => x.sim >= pol.boostFloor);
      if (alike.length) {
        expansions.set(p.chunkId, alike.map((x) => x.q).join("\n"));
        used += alike.length;
        // Reliability counts only ratings on questions like this one, with a
        // Beta(1,1) prior: a passage that turned up beside many unrelated
        // answers mustn't outrank the one that answers this question.
        const near = e.asked.filter((a) => overlap(qTokens, new Set(contentTokens(a.q))) >= pol.boostFloor);
        const pos = near.filter((a) => a.vote > 0).length;
        const neg = near.length - pos;
        const reliability = (pos + 1) / (near.length + 2);
        const sim = Math.max(...alike.map((x) => x.sim));
        if (neg < pos) {
          boost.set(p.chunkId, pol.boost * sim * reliability);
          learned.set(p.chunkId, sim * reliability);
        }
      }
    }
    const deadSimilar = e.asked.some((a) => a.vote < 0 && jaccard(qTokens, new Set(contentTokens(a.q))) >= threshold);
    if (deadSimilar) demote.set(p.chunkId, by);
  }
  return { expansions, boost, learned, demote, used };
}

export interface LintReport {
  log: ExperienceLog;
  stale: number;
  contested: string[];
}

/**
 * The health check: drop links whose passage changed or disappeared, and list
 * passages people disagree about (both votes on the same wording's neighbours).
 */
export function lintExperience(log: ExperienceLog, passages: Array<{ corpusId: string; chunkId: string; text: string }>): LintReport {
  const live = new Map(passages.map((p) => [keyOf(p.corpusId, p.chunkId), fingerprint(p.text)]));
  const entries: Record<string, ExperienceEntry> = {};
  let stale = 0;
  const contested: string[] = [];
  for (const [key, e] of Object.entries(log.entries)) {
    const fp = live.get(key);
    if (!fp || fp !== e.fingerprint) { stale++; continue; }
    entries[key] = e;
    if (e.asked.some((a) => a.vote > 0) && e.asked.some((a) => a.vote < 0)) contested.push(e.chunkId);
  }
  return { log: { version: 1, entries }, stale, contested };
}
