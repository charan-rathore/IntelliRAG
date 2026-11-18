/** Self-Improvement Memory for IntelliRAG's retrieval harness.
 * Run from web: npx tsx scripts/sim-optimize.ts [--write] [--start '{"soloMargin":1.35}']   (about six minutes)
 * --write appends this run's attempts to eval/sim/memory.json (the memory is
 * continual: each run reads every earlier entry) and writes the results.
 *          npx tsx scripts/sim-optimize.ts --failures   (what fails now, by root cause)
 *
 * After Yu et al., "Self-Improvement Memory Enables Continual Recursive
 * Self-Improvement" (arXiv 2611.18856, Nov 2026). The harness here is the
 * experience policy (experience.ts): how much learned wordings and rated
 * passages count. An optimizer edits it round by round against an evolve split
 * and is scored on a held-out split it never sees. SIM is the optimizer's
 * memory, not the retriever's: one entry per recurring problem (root cause),
 * each attempt with its edit, rationale, the cases it predicted to fix, what
 * actually changed, and where it was tried (provenance).
 *
 * The paper's optimizer is an LLM; this one is deterministic so results
 * reproduce exactly in CI. What SIM changes is the same: the proposer reads
 * every entry and skips an edit already tried in this context that didn't help,
 * revises one that helped elsewhere, and keeps going in a direction that worked.
 *
 * CRSI experiment (cross-dataset): evolve on the clean p-queue corpus (source),
 * then continue on the corpus with ten distractor runbooks (target) under four
 * conditions: cold start, harness transfer, problem-only memory, full SIM.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chunkDocument } from '../src/lib/rag/chunking';
import { retrieveFromRows, type SearchRow } from '../src/lib/rag/retrieve-core';
import { SEED_DOCUMENTS } from '../src/lib/rag/corpus';
import { DEFAULT_EXPERIENCE_POLICY, emptyExperience, recordExperience, type ExperienceLog, type ExperiencePolicy } from '../src/lib/rag/experience';
import { CHUNK_SIZE_TOKENS, CONTEXT_RELATIVE_FLOOR, CONTEXT_SOLO_MARGIN } from '../src/lib/rag/types';

/** The harness: every knob the optimizer may edit. */
interface Harness extends ExperiencePolicy { relativeFloor: number; soloMargin: number; coverage: number; maxPassages: number; chunkTokens: number }
const DEFAULT_HARNESS: Harness = { ...DEFAULT_EXPERIENCE_POLICY, relativeFloor: CONTEXT_RELATIVE_FLOOR, soloMargin: CONTEXT_SOLO_MARGIN, coverage: 0, maxPassages: 3, chunkTokens: CHUNK_SIZE_TOKENS };

const root = resolve(import.meta.dirname, '../../eval');
const base = JSON.parse(readFileSync(root + '/repo-support/dataset.json', 'utf8'));
const para = JSON.parse(readFileSync(root + '/learning/paraphrases.json', 'utf8'));
const source = readFileSync(root + '/repo-support/fixtures/p-queue.md', 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

type Setting = { name: string; distractors: boolean; rows: SearchRow[]; bySize: Map<number, SearchRow[]> };
function setting(name: string, distractors: boolean): Setting {
  const s: Setting = { name, distractors, rows: [], bySize: new Map() };
  s.rows = rowsAt(s, CHUNK_SIZE_TOKENS);
  return s;
}
/** The corpus chunked at a given passage size (a harness knob), built once per size. */
function rowsAt(s: Setting, size: number): SearchRow[] {
  const hit = s.bySize.get(size);
  if (hit) return hit;
  const distractors = s.distractors;
  const rows: SearchRow[] = [];
  for (const doc of [{ slug: 'p-queue', title: 'p-queue README', body: source }, ...(distractors ? SEED_DOCUMENTS : [])]) {
    for (const c of chunkDocument(doc.body, { filepath: doc.slug === 'p-queue' ? 'readme.md' : doc.slug + '.md', chunkSize: size })) {
      rows.push({ title: doc.title, slug: doc.slug, indexedAt: null, corpusId: 'sim', chunk: { id: `${doc.slug}:${c.ordinal}`, document_id: doc.slug, ordinal: c.ordinal,
        text: c.text, token_count: c.tokenCount, heading: c.heading, embedding: null, embedding_model: null, content_hash: hash(c.text), created_at: '',
        filepath: c.filepath, language: c.language, symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: 'sim' } } as SearchRow);
    }
  }
  s.bySize.set(size, rows);
  return rows;
}

const ids = Object.keys(para.cases);
const gold = new Map<string, string[]>(base.cases.filter((c: any) => c.answerable).map((c: any) => [c.id, c.evidence.map((e: any) => e.quote)]));
const originals = ids.map((id) => ({ id, q: base.cases.find((c: any) => c.id === id).question as string }));
const holds = (text: string, quotes: string[]) => quotes.some((q) => norm(text).includes(norm(q)));
const complete = (texts: string[], quotes: string[]) => quotes.every((q) => texts.some((t) => norm(t).includes(norm(q))));

function ask(s: Setting, q: string, log: ExperienceLog | null, policy: Harness) {
  return retrieveFromRows({ query: q, queryVector: null, mode: 'keyword', topK: 5, embeddingModel: null, rows: rowsAt(s, policy.chunkTokens), corpusScope: { kind: 'corpus', corpusId: 'sim' },
    storage: { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null } as never, experience: log, experiencePolicy: policy,
    packingPolicy: { relativeFloor: policy.relativeFloor, soloMargin: policy.soloMargin, maxPassages: policy.maxPassages }, packing: policy.coverage ? 'coverage' : 'rank' });
}

function train(s: Setting, policy: Harness, qs: Array<{ id: string; q: string }>): ExperienceLog {
  let log = emptyExperience();
  const byId = new Map(rowsAt(s, policy.chunkTokens).map((r) => [r.chunk.id, r]));
  for (const { id, q } of qs) {
    const r = ask(s, q, log, policy);
    const quotes = gold.get(id)!;
    const useful = r.chunks.length > 0 && complete(r.chunks.map((c) => c.text), quotes);
    if (r.chunks.length) log = recordExperience(log, { corpusId: 'sim', question: q, passages: r.chunks.map((c) => ({ chunkId: c.chunkId, text: c.text })), vote: useful ? 1 : -1 });
    if (!useful) {
      const picked = r.candidates.slice(0, 8).map((c) => byId.get(c.chunkId)!).filter((row) => row && holds(row.chunk.text, quotes));
      if (picked.length) log = recordExperience(log, { corpusId: 'sim', question: q, passages: picked.map((row) => ({ chunkId: row.chunk.id, text: row.chunk.text })), vote: 1 });
    }
  }
  return log;
}

type Failure = 'unreachable' | 'not-retrieved' | 'ranked-not-packed' | 'refused' | 'learned-noise' | 'false-answer';
interface CaseResult { key: string; ok: boolean; failure?: Failure }
interface Score { score: number; cases: CaseResult[] }

/** Folds 0 and 1 are the evolve split; fold 2 is held out and never reaches the optimizer. */
function evaluate(s: Setting, policy: Harness, folds: number[]): Score {
  const cases: CaseResult[] = [];
  for (const fold of folds) {
    const others = ids.flatMap((id) => (para.cases[id] as string[]).map((q, i) => ({ id, q, i })).filter((x) => x.i !== fold).map(({ id, q }) => ({ id, q })));
    const log = train(s, policy, [...originals, ...others]);
    for (const id of ids) {
      const q = para.cases[id][fold] as string;
      const quotes = gold.get(id)!;
      const r = ask(s, q, log, policy);
      const ok = r.chunks.length > 0 && complete(r.chunks.map((c) => c.text), quotes);
      let failure: Failure | undefined;
      if (!ok) {
        const reachable = quotes.every((qq) => rowsAt(s, policy.chunkTokens).some((row) => holds(row.chunk.text, [qq])));
        const goldIds = rowsAt(s, policy.chunkTokens).filter((row) => holds(row.chunk.text, quotes)).map((row) => row.chunk.id);
        const top = new Set(r.candidates.slice(0, 8).map((c) => c.chunkId));
        const plain = ask(s, q, null, policy);
        const plainOk = plain.chunks.length > 0 && complete(plain.chunks.map((c) => c.text), quotes);
        failure = !reachable ? 'unreachable' : plainOk ? 'learned-noise' : !r.chunks.length ? 'refused' : goldIds.every((g) => top.has(g)) ? 'ranked-not-packed' : 'not-retrieved';
      }
      cases.push({ key: `${fold}:${id}`, ok, failure });
    }
    // The questions people already asked: learning must not break what worked.
    for (const { id, q } of originals) {
      const quotes = gold.get(id)!;
      const ok = (() => { const r = ask(s, q, log, policy); return r.chunks.length > 0 && complete(r.chunks.map((c) => c.text), quotes); })();
      if (ok) { cases.push({ key: `${fold}:orig:${id}`, ok }); continue; }
      const plain = ask(s, q, null, policy);
      const plainOk = plain.chunks.length > 0 && complete(plain.chunks.map((c) => c.text), quotes);
      cases.push({ key: `${fold}:orig:${id}`, ok, failure: plainOk ? 'learned-noise' : 'unreachable' });
    }
  }
  // Unanswerable rewordings: answering one is a failure like any other.
  const log = train(s, policy, originals);
  for (const [id, qs] of Object.entries(para.unanswerable as Record<string, string[]>)) {
    qs.forEach((q, i) => {
      const refused = ask(s, q, log, policy).chunks.length === 0;
      cases.push({ key: `u:${id}:${i}`, ok: refused, failure: refused ? undefined : 'false-answer' });
    });
  }
  return { score: cases.filter((c) => c.ok).length / cases.length, cases };
}

/* --------------------------------- SIM ---------------------------------- */

interface Attempt {
  edit: Partial<Harness>;
  rationale: string;
  predicted: string[];
  observed: { fixed: string[]; broke: string[]; delta: number };
  provenance: { setting: string; round: number };
}
interface Entry { rootCause: Failure; attempts: Attempt[] }
type Memory = Entry[];

type Knob = 'boost' | 'boostFloor' | 'demoteBy' | 'demoteSimilarity' | 'relativeFloor' | 'soloMargin' | 'coverage' | 'maxPassages' | 'chunkTokens';
const STEP: Record<Knob, number> = { boost: 0.1, boostFloor: 0.05, demoteBy: 0.06, demoteSimilarity: 0.1, relativeFloor: 0.06, soloMargin: 0.15, coverage: 1, maxPassages: 1, chunkTokens: 128 };
const RANGE: Record<Knob, [number, number]> = { boost: [0, 0.8], boostFloor: [0.05, 0.8], demoteBy: [0, 0.4], demoteSimilarity: [0.2, 0.9], relativeFloor: [0.3, 0.9], soloMargin: [1.05, 3], coverage: [0, 1], maxPassages: [2, 6], chunkTokens: [192, 768] };
/** Which edits address which problem, and why (the rationale recorded with each attempt). */
const REMEDIES: Record<Failure, Array<{ knob: Knob; dir: 1 | -1; why: string }>> = {
  'not-retrieved': [
    { knob: 'chunkTokens', dir: -1, why: 'the evidence sits in a long passage whose other text dilutes its match' },
    { knob: 'boostFloor', dir: -1, why: 'rewordings share few words with the confirmed question; let looser matches reach the passage' },
    { knob: 'boost', dir: 1, why: 'the passage is found through learned wordings but too weakly to rank' },
  ],
  'ranked-not-packed': [
    { knob: 'chunkTokens', dir: -1, why: 'passages are too long: two of them fill the budget, so the third the answer needs never fits' },
    { knob: 'maxPassages', dir: 1, why: 'the answer needs more passages than the packer allows' },
    { knob: 'relativeFloor', dir: -1, why: 'the second passage an answer needs is dropped under the relative floor' },
    { knob: 'soloMargin', dir: 1, why: 'a strong rank-1 passage is packed alone when the answer needs two' },
    { knob: 'coverage', dir: 1, why: 'spend the budget on passages that cover question terms the first one misses' },
    { knob: 'boost', dir: 1, why: 'the gold passage is in the top eight but loses the packing budget to unconfirmed neighbours' },
  ],
  refused: [{ knob: 'boost', dir: 1, why: 'the confirmed passage stays under the support floor' }],
  'learned-noise': [
    { knob: 'boostFloor', dir: 1, why: 'learning pulled in passages for questions that only look alike' },
    { knob: 'demoteBy', dir: 1, why: 'passages rated dead ends still win for questions like those' },
    { knob: 'boost', dir: -1, why: 'learned lift outweighs what the passage text supports' },
  ],
  'false-answer': [
    { knob: 'relativeFloor', dir: 1, why: 'weak neighbours ride in beside a passage and make an unsupported question look answered' },
    { knob: 'boostFloor', dir: 1, why: 'a learned wording lends support to a question it only resembles' },
  ],
  unreachable: [],
};

const clamp = (k: Knob, v: number) => Math.round(Math.min(RANGE[k][1], Math.max(RANGE[k][0], v)) * 1000) / 1000;
// Knobs that only take whole steps.
const INTEGER = new Set<Knob>(['coverage', 'maxPassages', 'chunkTokens']);

interface Candidate { edit: Partial<Harness>; policy: Harness; rootCause: Failure; rationale: string; predicted: string[] }

/**
 * Propose k candidates for the commonest problems. With memory: skip an edit
 * already tried in this setting that fixed nothing, take a bigger step in a
 * direction that helped, and revise (half step) one that helped only elsewhere.
 */
function propose(h: Harness, f: Score, mem: Memory | null, settingName: string, k = 5, problemsOnly = false): Candidate[] {
  const counts = new Map<Failure, string[]>();
  for (const c of f.cases) if (c.failure && c.failure !== 'unreachable') counts.set(c.failure, [...(counts.get(c.failure) ?? []), c.key]);
  // Problems the memory knows are tried first; then the commonest failures now.
  const known = new Set((mem ?? []).map((e) => e.rootCause));
  const order = [...counts.entries()].sort((a, b) => Number(known.has(b[0])) - Number(known.has(a[0])) || b[1].length - a[1].length);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const [cause, cases] of order) {
    for (const rem of REMEDIES[cause]) {
      const history = problemsOnly ? [] : (mem?.find((e) => e.rootCause === cause)?.attempts ?? []).filter((a) => a.edit[rem.knob] !== undefined);
      const here = history.filter((a) => a.provenance.setting === settingName);
      const last = here.at(-1) ?? history.at(-1);
      let step = STEP[rem.knob];
      if (last) {
        const wentUp = (last.edit[rem.knob] as number) > (DEFAULT_HARNESS as any)[rem.knob] ? 1 : -1;
        const sameDir = wentUp === rem.dir;
        if (here.length && last.observed.delta <= 0 && sameDir) continue; // tried here, didn't help
        if (last.observed.delta > 0 && sameDir && !INTEGER.has(rem.knob)) step *= last.provenance.setting === settingName ? 1.5 : 0.5; // keep going / revise
      }
      const v = clamp(rem.knob, (h[rem.knob] as number) + rem.dir * step);
      if (v === h[rem.knob]) continue;
      const edit = { [rem.knob]: v } as Partial<Harness>;
      const sig = JSON.stringify(edit);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ edit, policy: { ...h, ...edit }, rootCause: cause, rationale: rem.why, predicted: cases });
      if (out.length >= k) return out;
    }
  }
  return out;
}

function record(mem: Memory, c: Candidate, before: Score, after: Score, settingName: string, round: number) {
  const okBefore = new Set(before.cases.filter((x) => x.ok).map((x) => x.key));
  const okAfter = new Set(after.cases.filter((x) => x.ok).map((x) => x.key));
  const attempt: Attempt = {
    edit: c.edit, rationale: c.rationale, predicted: c.predicted,
    observed: { fixed: [...okAfter].filter((k) => !okBefore.has(k)), broke: [...okBefore].filter((k) => !okAfter.has(k)), delta: Number((after.score - before.score).toFixed(4)) },
    provenance: { setting: settingName, round },
  };
  const entry = mem.find((e) => e.rootCause === c.rootCause);
  if (entry) entry.attempts.push(attempt);
  else mem.push({ rootCause: c.rootCause, attempts: [attempt] });
}

/** One RSI run: N rounds, k candidates; keep the best only if it beats the current harness. */
function rsi(s: Setting, h0: Harness, mem: Memory | null, opts: { rounds: number; problemsOnly?: boolean; log?: boolean }) {
  let h = h0;
  let f = evaluate(s, h, [0, 1]);
  const curve = [f.score];
  for (let t = 0; t < opts.rounds; t++) {
    const cands = propose(h, f, mem, s.name, 5, opts.problemsOnly);
    let best: { c: Candidate; f: Score } | null = null;
    for (const c of cands) {
      const fc = evaluate(s, c.policy, [0, 1]);
      if (!best || fc.score > best.f.score) best = { c, f: fc };
    }
    // Every evaluated attempt is evidence for the memory; only a gain is kept.
    if (best && mem) record(mem, best.c, f, best.f, s.name, t);
    const falseAnswers = (x: Score) => x.cases.filter((c) => c.failure === 'false-answer').length;
    if (best && best.f.score > f.score && falseAnswers(best.f) <= falseAnswers(f)) { h = best.c.policy; f = best.f; }
    curve.push(f.score);
    if (opts.log) console.log(`  round ${t + 1}: ${best ? JSON.stringify(best.c.edit) + ' ' + (best.f.score > curve[t]! ? 'kept' : 'rejected') : 'no candidates'} → ${(100 * f.score).toFixed(1)}%`);
  }
  return { h, curve, heldOut: evaluate(s, h, [2]).score };
}

/* ------------------------------ experiment ------------------------------ */

const ROUNDS = 6;
if (process.argv.includes("--failures")) { const f = evaluate(setting("clean", false), DEFAULT_HARNESS, [0, 1]); const m = new Map<string, string[]>(); for (const c of f.cases) if (c.failure) m.set(c.failure, [...(m.get(c.failure) ?? []), c.key]); console.log(f.score, [...m].map(([k, v]) => `${k}: ${v.length} ${v.join(" ")}`).join("\n")); process.exit(0); }
const src = setting('clean', false);
const tgt = setting('distractors', true);
console.log(`SIM · retrieval harness · ${ROUNDS} rounds × 5 candidates · evolve folds 0–1, held-out fold 2`);
console.log('\nsource RSI (clean corpus)');
const memPath = root + '/sim/memory.json';
let prior: Memory = [];
try { prior = JSON.parse(readFileSync(memPath, 'utf8')).entries ?? []; } catch { /* first run */ }
const startArg = process.argv.indexOf('--start');
const start: Harness = { ...DEFAULT_HARNESS, ...(startArg > 0 ? JSON.parse(process.argv[startArg + 1]!) : {}) };
const sourceMem: Memory = JSON.parse(JSON.stringify(prior));
const source_ = rsi(src, start, sourceMem, { rounds: ROUNDS, log: true });
console.log(`  evolved: ${JSON.stringify(source_.h)} · held-out ${(100 * source_.heldOut).toFixed(1)}% (start ${(100 * evaluate(src, start, [2]).score).toFixed(1)}%)`);

const clone = (m: Memory): Memory => JSON.parse(JSON.stringify(m));
const conditions = [
  { name: 'cold start', h: start, mem: [] as Memory, problemsOnly: false },
  { name: 'harness transfer', h: source_.h, mem: [] as Memory, problemsOnly: false },
  { name: 'problem-only memory', h: source_.h, mem: clone(sourceMem).map((e) => ({ rootCause: e.rootCause, attempts: [] })), problemsOnly: true },
  { name: 'full SIM', h: source_.h, mem: clone(sourceMem), problemsOnly: false },
];
const results: any[] = [];
console.log('\ntarget CRSI (with distractor runbooks)');
for (const c of conditions) {
  const start = evaluate(tgt, c.h, [2]).score;
  const r = rsi(tgt, c.h, c.mem, { rounds: ROUNDS, problemsOnly: c.problemsOnly });
  results.push({ condition: c.name, start, heldOut: r.heldOut, evolveCurve: r.curve, policy: r.h });
  console.log(`  ${c.name.padEnd(20)} held-out ${(100 * start).toFixed(1)}% → ${(100 * r.heldOut).toFixed(1)}%   evolve ${r.curve.map((x) => (100 * x).toFixed(0)).join(' ')}`);
}
if (process.argv.includes('--write')) {
  mkdirSync(root + '/sim', { recursive: true });
  writeFileSync(memPath, JSON.stringify({ paper: 'arXiv:2611.18856', harness: 'retrieval policy (experience + packing)', entries: sourceMem }, null, 2) + '\n');
  const runs = (() => { try { return JSON.parse(readFileSync(root + '/sim/results.json', 'utf8')).runs ?? []; } catch { return []; } })();
  runs.push({ start, rounds: ROUNDS, candidates: 5, source: { policy: source_.h, startHeldOut: evaluate(src, start, [2]).score, heldOut: source_.heldOut, curve: source_.curve }, target: results });
  writeFileSync(root + '/sim/results.json', JSON.stringify({ runs }, null, 2) + '\n');
}
