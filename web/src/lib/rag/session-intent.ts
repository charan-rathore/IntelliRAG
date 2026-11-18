/**
 * Session intent: what the person has been looking for across a conversation,
 * so a follow-up like "and if it's already running?" is searched as what it
 * means, not as the five words it says.
 *
 * Deterministic and inspectable, like the rest of the pipeline. Three ideas:
 *
 * 1. Historical query expansion (Lin et al., "Multi-Stage Conversational
 *    Passage Retrieval", TOIS 2021; the lexical baseline later conversational
 *    rewriters such as CHIQ, EMNLP 2024, are measured against). A turn that
 *    can't stand on its own is searched together with the earlier questions
 *    on its topic. Separately, the session's terms are weighted (newest
 *    strongest, confirmed by evidence strongest) to show what it is about.
 * 2. Rocchio relevance feedback (Rocchio 1971; still the strongest cheap prior
 *    in the TREC iKAT and CAsT tracks). What the person marked helpful pulls the
 *    focus toward those passages' terms, and what they marked unhelpful
 *    pushes those terms out.
 * 3. Topic shift. Carried context helps elliptical turns and hurts a new
 *    topic, so every turn is classified first. An explicit switch ("separately",
 *    "different question") or a self-sufficient question with nothing in common
 *    with the session starts the focus again.
 *
 * One rule protects refusals: the evidence must still cover the turn's *own*
 * distinctive terms (see `ownTermsUncovered`). Context can help find a passage,
 * but it can never make an unsupported question look answered.
 */
import { contentTokens, GENERIC_OPS_TERMS, QUERY_STOPWORDS } from "./text";
import { distinctiveTerms, type IdF } from "./ranking";

export type TurnMode = "fresh" | "follow-up" | "related" | "switch";

export interface SessionTurn {
  query: string;
  /** Chunk texts packed for this turn's answer (empty when it was refused). */
  packed?: Array<{ chunkId: string; text: string; heading?: string | null }>;
  /** Explicit feedback on packed chunks: +1 helpful, -1 not helpful. */
  feedback?: Record<string, 1 | -1>;
  refused?: boolean;
}

export interface CarriedTerm {
  term: string;
  weight: number;
  from: "question" | "answer" | "feedback";
  /** Turns ago it was last asked (1 = the previous turn). */
  age: number;
}

export interface TurnPlan {
  mode: TurnMode;
  /** What to search for: the question plus the carried terms. */
  resolved: string;
  carried: CarriedTerm[];
  /** The turn's own distinctive terms, which the evidence must still cover. */
  own: string[];
  /** Whether anything from earlier in the conversation was added to the search. */
  usedContext: boolean;
  /** One sentence a person can read: why the search looks like this. */
  why: string;
}

export interface IntentOptions {
  /** Per-turn decay of carried weight (0.55: a term asked three turns ago keeps 17%). */
  decay?: number;
  /** Most terms to carry into a follow-up. */
  maxCarried?: number;
  /** Use explicit feedback (Rocchio β, γ). */
  feedback?: boolean;
}

const SWITCH = /^\s*(separately|unrelated|different (question|topic)|new (question|topic)|switching (topics?|gears)|on another note|another thing|changing (the )?subject)\b/i;
const FOLLOW_OPENERS = /^\s*(and|also|but|so|then|ok(ay)?|what about|how about|what if|why not|same for|instead|or)\b/i;
const DEICTIC = /\b(it|its|it's|that|this|these|those|they|them|their|there|then|one|ones|same|such|either|both)\b/i;

/** Distinctive question terms: content tokens long enough to mean something (a switch marker isn't one). */
function ownTerms(query: string): string[] {
  return [...new Set(distinctiveTerms(query.replace(SWITCH, " ")))];
}

/**
 * Terms a question is about. Wider than `ownTerms`: the gate's list of generic
 * operations words ("timeout", "limit", "error") are exactly what a conversation
 * about a library keeps coming back to, so they are carried too.
 */
function topicTerms(query: string): string[] {
  return [...new Set(contentTokens(query.replace(SWITCH, " ")).filter((t) => t.length >= 4))];
}

/**
 * Only a term the corpus has, and that picks out passages, is worth carrying:
 * a word no passage contains can't help find one, and a word every passage
 * has (the project's own name) only adds noise.
 */
function carryable(term: string, idf: IdF, floor: number): boolean {
  const v = rawIdf(term, idf);
  return v !== undefined && v >= floor;
}

/** idf without the gate's damping of generic operations words (buildIdf scales those by 0.2). */
function rawIdf(term: string, idf: IdF): number | undefined {
  const v = idf.get(term);
  return v === undefined ? undefined : GENERIC_OPS_TERMS.has(term) ? v / 0.2 : v;
}

/** A question that names enough on its own to be searched without context. */
function selfSufficient(own: string[], idf: IdF): boolean {
  const strong = own.filter((t) => (idf.get(t) ?? 0) >= 1.2);
  return strong.length >= 2;
}

export function classifyTurn(query: string, history: SessionTurn[], idf: IdF): TurnMode {
  if (!history.length) return "fresh";
  if (SWITCH.test(query)) return "switch";
  const own = ownTerms(query);
  const elliptical = FOLLOW_OPENERS.test(query) || DEICTIC.test(query) || own.length <= 2;
  if (elliptical) return "follow-up";
  // A full question: carry a little context only if it shares the session's focus.
  const focus = new Set(history.flatMap((t) => topicTerms(t.query)));
  const shared = own.filter((t) => focus.has(t)).length;
  if (shared > 0) return "related";
  return selfSufficient(own, idf) ? "switch" : "follow-up";
}

/**
 * The session's focus as weighted terms, newest turns strongest, starting from
 * the last topic switch. Each turn's terms are weighted by idf, so the words
 * that pick out passages count for more than the words every passage has.
 */
export function sessionFocus(history: SessionTurn[], idf: IdF, opts: IntentOptions = {}): Map<string, CarriedTerm> {
  const decay = opts.decay ?? 0.55;
  const useFeedback = opts.feedback ?? true;
  // The focus restarts at the last turn that switched topic.
  const start = topicStart(history, idf);
  const focus = new Map<string, CarriedTerm>();
  const floor = idfFloor(idf);
  const add = (term: string, weight: number, from: CarriedTerm["from"], age: number) => {
    if (QUERY_STOPWORDS.has(term) || weight <= 0 || !carryable(term, idf, floor)) return;
    const prev = focus.get(term);
    if (!prev || prev.weight < weight) focus.set(term, { term, weight: (prev?.weight ?? 0) * 0.5 + weight, from, age: prev ? Math.min(prev.age, age) : age });
  };
  const banned = new Set<string>();
  for (let i = history.length - 1; i >= start; i--) {
    const turn = history[i]!;
    const age = history.length - i;
    const w = decay ** (age - 1);
    // A refused turn asked for something the source doesn't have: its terms are not the focus.
    // A question term the turn's own evidence also contains is confirmed as the
    // topic ("timeout" in a passage about timeouts); one it doesn't ("give",
    // "every") was just how the question was phrased, and counts for little.
    if (!turn.refused) {
      const answered = new Set((turn.packed ?? []).flatMap((p) => contentTokens(`${p.heading ?? ""}\n${p.text}`)));
      for (const t of topicTerms(turn.query)) add(t, w * (answered.has(t) ? 1 : 0.25) * Math.sqrt(rawIdf(t, idf) ?? 1), "question", age);
    }
    // "What does it return?": "it" is usually what the last answer was about, and a
    // passage's heading names that thing (".addAll(fns, options?)"). Only the top
    // passage, only its heading: the body would drag in everything nearby.
    const top = !turn.refused ? turn.packed?.[0] : undefined;
    if (top?.heading) for (const t of contentTokens(top.heading).filter((x) => x.length >= 4).slice(0, 2)) add(t, 0.5 * w * Math.sqrt(rawIdf(t, idf) ?? 1), "answer", age);
    if (useFeedback && turn.feedback && turn.packed) {
      for (const chunk of turn.packed) {
        const vote = turn.feedback[chunk.chunkId];
        if (!vote) continue;
        const terms = topTerms(chunk.text, idf, 6);
        if (vote > 0) for (const t of terms) add(t, 0.6 * w * Math.sqrt(rawIdf(t, idf) ?? 1), "feedback", age);
        else for (const t of terms) banned.add(t);
      }
    }
  }
  for (const t of banned) focus.delete(t);
  return focus;
}

/**
 * The idf below which a term is too common to carry: one that nearly every
 * passage contains (the project's own name).
 */
function idfFloor(_idf: IdF): number {
  return 0.2;
}

/** The most distinctive terms of a passage (tf · idf). */
function topTerms(text: string, idf: IdF, k: number): string[] {
  const tf = new Map<string, number>();
  for (const t of contentTokens(text)) if (t.length >= 4) tf.set(t, (tf.get(t) ?? 0) + 1);
  return [...tf].map(([t, f]) => ({ t, s: Math.log(1 + f) * (idf.get(t) ?? 0) })).sort((a, b) => b.s - a.s || (a.t < b.t ? -1 : 1)).slice(0, k).map((x) => x.t);
}

/** Index of the turn the current topic started at (the last switch, or the first turn). */
export function topicStart(history: SessionTurn[], idf: IdF): number {
  for (let i = history.length - 1; i > 0; i--) {
    if (classifyTurn(history[i]!.query, history.slice(0, i), idf) === "switch") return i;
  }
  return 0;
}

export function planTurn(query: string, history: SessionTurn[], idf: IdF, opts: IntentOptions = {}): TurnPlan {
  const own = ownTerms(query);
  const mode = classifyTurn(query, history, idf);
  if (mode === "fresh" || mode === "switch") {
    return { mode, resolved: query, carried: [], own, usedContext: false, why: mode === "switch" ? "New topic: searched on its own." : "First question: searched as asked." };
  }
  // What gets searched: the earlier questions on this topic, whole. On the
  // conversation eval this beat carrying a handful of weighted terms (whole
  // questions keep the phrases BM25 and the phrase signal match on), and
  // restarting at a topic switch keeps it from dragging in the old topic.
  // Refused turns are left out: they asked for something the source lacks.
  const from = topicStart(history, idf);
  const prior = history.slice(from).filter((t) => !t.refused);
  const window = mode === "related" ? prior.slice(-1) : prior;
  const focus = sessionFocus(history, idf, opts);
  const liked = [...focus.values()].filter((c) => c.from === "feedback").sort((a, b) => b.weight - a.weight).slice(0, 3).map((c) => c.term);
  const resolved = [...window.map((t) => t.query), query, ...liked].join(" ").trim();
  // What the person sees: the strongest focus terms the question didn't say itself.
  const ownSet = new Set(contentTokens(query));
  const carried = [...focus.values()]
    .filter((c) => !ownSet.has(c.term))
    .sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1))
    .slice(0, opts.maxCarried ?? 5);
  if (!window.length && !liked.length) return { mode, resolved: query, carried: [], own, usedContext: false, why: "Nothing earlier in the conversation to add." };
  const why = `${mode === "follow-up" ? "Read as a follow-up" : "Same topic"}: searched together with ${window.length === 1 ? "the previous question" : `the ${window.length} earlier questions on this topic`}${carried.length ? ` (about ${carried.slice(0, 3).map((c) => c.term).join(", ")})` : ""}.`;
  return { mode, resolved, carried, own, usedContext: true, why };
}

/**
 * The turn's own distinctive terms that no packed passage mentions. When every
 * one is missing, the context answers the conversation, not the question, and
 * the turn must be refused.
 */
export function ownTermsUncovered(own: string[], packedTexts: string[]): string[] {
  if (!own.length) return [];
  const words = new Set(packedTexts.flatMap((t) => contentTokens(t)));
  return own.filter((t) => !words.has(t));
}

export function mustRefuse(plan: TurnPlan, packedTexts: string[]): boolean {
  if (!plan.usedContext || !packedTexts.length) return false;
  const missing = ownTermsUncovered(plan.own, packedTexts);
  return plan.own.length > 0 && missing.length === plan.own.length;
}
