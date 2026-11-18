/**
 * The calls an agent makes: search, ask, feedback. The same retrieval, support
 * gate, packing and session reading the web console runs (web/src/lib/rag),
 * without a model: an agent is the model, so it gets the evidence, the
 * question terms nothing covers, and a refusal when nothing supports an answer.
 */
import { retrieveFromRows } from "../../web/src/lib/rag/retrieve-core";
import { buildIdf, type IdF } from "../../web/src/lib/rag/ranking";
import { mustRefuse, planTurn, type SessionTurn, type TurnPlan } from "../../web/src/lib/rag/session-intent";
import type { Corpus } from "./corpus";
import { emptyExperience, recordExperience, type ExperienceLog } from "../../web/src/lib/rag/experience";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Experience memory per corpus, kept on disk (~/.intellirag, or INTELLIRAG_HOME)
 * so a repository an agent works in keeps learning across sessions. Links are
 * tied to passage fingerprints: when the repo changes, stale ones stop counting.
 */
const HOME = process.env.INTELLIRAG_HOME || join(homedir(), ".intellirag");
const experiences = new Map<string, ExperienceLog>();
const fileFor = (c: Corpus) => join(HOME, `experience-${c.origin.replace(/[^\w.-]+/g, "_").slice(-120)}.json`);
function experienceOf(c: Corpus): ExperienceLog {
  let log = experiences.get(c.id);
  if (!log) {
    try { log = existsSync(fileFor(c)) ? (JSON.parse(readFileSync(fileFor(c), "utf8")) as ExperienceLog) : emptyExperience(); } catch { log = emptyExperience(); }
    experiences.set(c.id, log);
  }
  return log;
}
function saveExperience(c: Corpus, log: ExperienceLog) {
  experiences.set(c.id, log);
  try { mkdirSync(HOME, { recursive: true }); writeFileSync(fileFor(c), JSON.stringify(log)); } catch { /* read-only home: keep it in memory */ }
}

export interface Passage {
  ref: string;
  file: string;
  heading: string | null;
  symbol: string | null;
  score: number;
  text: string;
}

export interface Answer {
  corpus: string;
  origin: string;
  question: string;
  searched: string;
  reading: { mode: TurnPlan["mode"]; why: string; about: string[] } | null;
  refused: boolean;
  reason: string;
  passages: Passage[];
  coverage: { covered: string[]; missing: string[] } | null;
}

const STORAGE = { backend: "ephemeral", durable: false, denseAvailable: false, warning: null } as const;
const idfCache = new WeakMap<Corpus, IdF>();
const idfOf = (c: Corpus) => {
  let v = idfCache.get(c);
  if (!v) idfCache.set(c, (v = buildIdf(c.rows.map((r) => `${r.title}\n${r.chunk.text}`))));
  return v;
};

/** Conversations, by the session id the agent passes (one per task is right). */
const sessions = new Map<string, SessionTurn[]>();
export function sessionOf(id: string | undefined): SessionTurn[] {
  if (!id) return [];
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = []));
  return s;
}
export function resetSession(id: string) { sessions.delete(id); }

function run(corpus: Corpus, query: string, topK: number) {
  return retrieveFromRows({
    query, queryVector: null, mode: "keyword", topK, embeddingModel: null, rows: corpus.rows,
    storage: STORAGE as never, corpusScope: { kind: "corpus", corpusId: corpus.id }, experience: experienceOf(corpus),
  });
}

const toPassage = (c: { chunkId: string; filepath?: string | null; slug: string; heading: string | null; symbol?: string | null; score: number; text: string }): Passage => ({
  ref: c.chunkId, file: c.filepath ?? c.slug, heading: c.heading, symbol: c.symbol ?? null, score: Number(c.score.toFixed(3)), text: c.text,
});

/** Ranked candidates, before the support gate: for exploring, not for citing. */
export function search(corpus: Corpus, query: string, topK = 8): Passage[] {
  const r = run(corpus, query, topK);
  const byId = new Map(corpus.rows.map((row) => [row.chunk.id, row]));
  return r.candidates.slice(0, topK).map((c: any) => {
    const row = byId.get(c.chunkId);
    return toPassage({ chunkId: c.chunkId, filepath: row?.chunk.filepath, slug: c.slug ?? row?.slug ?? "", heading: row?.chunk.heading ?? null, symbol: row?.chunk.symbol, score: c.score ?? 0, text: row?.chunk.text ?? "" });
  });
}

/** Supported evidence for a question, read with the session's earlier turns. */
export function ask(corpus: Corpus, question: string, sessionId?: string): Answer {
  const history = sessionOf(sessionId);
  const plan = history.length ? planTurn(question, history, idfOf(corpus)) : null;
  const searched = plan?.usedContext ? plan.resolved : question;
  const r = run(corpus, searched, 5);
  let passages = r.chunks.map(toPassage);
  let refused = r.evidence === "insufficient" || passages.length === 0;
  let reason = refused ? "Nothing in this corpus passed the support gate for this question." : r.evidenceNote || "Supported passages, strongest first.";
  if (!refused && plan && mustRefuse(plan, passages.map((p) => `${p.heading ?? ""}\n${p.text}`))) {
    refused = true;
    reason = `The conversation found passages, but none mention what this question asks (${plan.own.join(", ")}).`;
  }
  if (refused) passages = [];
  if (sessionId) {
    history.push({ query: question, refused, packed: passages.map((p) => ({ chunkId: p.ref, text: p.text, heading: p.heading })) });
    if (history.length > 12) history.splice(0, history.length - 12);
  }
  return {
    corpus: corpus.id, origin: corpus.origin, question, searched,
    reading: plan ? { mode: plan.mode, why: plan.why, about: plan.carried.map((c) => c.term) } : null,
    refused, reason, passages,
    coverage: r.coverage && !refused ? { covered: r.coverage.covered, missing: r.coverage.missing } : null,
  };
}

/**
 * Mark a passage from this session's answers helpful or not. Follow-ups in the
 * session lean accordingly, and the question is filed against the passage in
 * the corpus's experience memory, so later questions worded like it find it.
 * A passage `search` returned can be marked too, by passing its text.
 */
export function feedback(sessionId: string, ref: string, helpful: boolean, corpus?: Corpus, text?: string): boolean {
  const history = sessions.get(sessionId);
  const turn = history?.slice().reverse().find((t) => t.packed?.some((p) => p.chunkId === ref)) ?? history?.at(-1);
  if (!turn) return false;
  const passage = turn.packed?.find((p) => p.chunkId === ref);
  turn.feedback = { ...(turn.feedback ?? {}), [ref]: helpful ? 1 : -1 };
  const body = passage?.text ?? text ?? corpus?.rows.find((r) => r.chunk.id === ref)?.chunk.text;
  if (corpus && body) {
    saveExperience(corpus, recordExperience(experienceOf(corpus), { corpusId: corpus.id, question: turn.query, passages: [{ chunkId: ref, text: body }], vote: helpful ? 1 : -1 }));
  }
  return true;
}
