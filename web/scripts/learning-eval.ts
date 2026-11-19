/** Does IntelliRAG get better at a corpus as people use it?
 * Run from web: npx tsx scripts/learning-eval.ts [--distractors] [--write] [--check]
 *
 * People ask the repo-support questions and some rewordings of them, and rate
 * each answer: useful when it contains the gold evidence, a dead end when it
 * doesn't (20% of ratings flipped in the noisy arm). The ratings are filed into
 * experience memory (experience.ts). Then held-out rewordings nobody asked
 * before are scored, three folds, each fold holding out a different wording.
 * Unanswerable rewordings must still be refused. No model runs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chunkDocument } from '../src/lib/rag/chunking';
import { retrieveFromRows, type SearchRow } from '../src/lib/rag/retrieve-core';
import { SEED_DOCUMENTS } from '../src/lib/rag/corpus';
import { emptyExperience, recordExperience, type ExperienceLog } from '../src/lib/rag/experience';
import { sleep as sleepCycle, type SleepPassage } from '../src/lib/rag/sleep';

const root = resolve(import.meta.dirname, '../../eval');
const base = JSON.parse(readFileSync(root + '/repo-support/dataset.json', 'utf8'));
const para = JSON.parse(readFileSync(root + '/learning/paraphrases.json', 'utf8'));
const source = readFileSync(root + '/repo-support/fixtures/p-queue.md', 'utf8');
const distractors = process.argv.includes('--distractors');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const rows: SearchRow[] = [];
for (const doc of [{ slug: 'p-queue', title: 'p-queue README', body: source }, ...(distractors ? SEED_DOCUMENTS : [])]) {
  for (const c of chunkDocument(doc.body, { filepath: doc.slug === 'p-queue' ? 'readme.md' : doc.slug + '.md' })) {
    rows.push({ title: doc.title, slug: doc.slug, indexedAt: null, corpusId: 'learn', chunk: {
      id: `${doc.slug}:${c.ordinal}`, document_id: doc.slug, ordinal: c.ordinal, text: c.text, token_count: c.tokenCount, heading: c.heading,
      embedding: null, embedding_model: null, content_hash: hash(c.text), created_at: '', filepath: c.filepath, language: c.language,
      symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: 'learn' } } as SearchRow);
  }
}
const ask = (query: string, experience: ExperienceLog | null) => retrieveFromRows({ query, queryVector: null, mode: 'keyword', topK: 5, embeddingModel: null, rows,
  corpusScope: { kind: 'corpus', corpusId: 'learn' }, storage: { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null } as never, experience });

const passages: SleepPassage[] = rows.map((r) => ({ chunkId: r.chunk.id, text: r.chunk.text, heading: r.chunk.heading, symbol: r.chunk.symbol, filepath: r.chunk.filepath, title: r.title }));
const packedIds = (q: string, log: ExperienceLog) => ask(q, log).chunks.map((c) => c.chunkId);
// One sleep cycle (sleep.ts): replay, consolidate, dream, keep only dreams that don't cost a real question.
const doSleep = (log: ExperienceLog) => sleepCycle({ corpusId: 'learn', passages, packed: packedIds }, log, undefined, { now: '2026-11-19T00:00:00Z' }).log;
const gold = new Map<string, string[]>(base.cases.filter((c: any) => c.answerable).map((c: any) => [c.id, c.evidence.map((e: any) => e.quote)]));
const complete = (packed: string[], quotes: string[]) => quotes.every((q) => packed.some((p) => norm(p).includes(norm(q))));

// Deterministic noise: a seeded LCG, so every run flips the same ratings.
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

const byId = new Map(rows.map((r) => [r.chunk.id, r]));
const holds = (text: string, quotes: string[]) => quotes.some((q) => norm(text).includes(norm(q)));

function train(questions: Array<{ id: string; q: string }>, noise: number, seed: number, picks: boolean): ExperienceLog {
  let log = emptyExperience();
  const r = rng(seed);
  for (const { id, q } of questions) {
    const res = ask(q, log);
    const quotes = gold.get(id)!;
    let useful = res.chunks.length > 0 && complete(res.chunks.map((c) => c.text), quotes);
    if (r() < noise) useful = !useful;
    if (res.chunks.length) {
      log = recordExperience(log, { corpusId: 'learn', question: q, passages: res.chunks.map((c) => ({ chunkId: c.chunkId, text: c.text })), vote: useful ? 1 : -1 });
    }
    // Source picks: when the answer missed, the person opens the Evidence panel
    // (the top eight candidates) and marks the passages that do answer it.
    if (picks && !useful) {
      const picked = res.candidates.slice(0, 8).map((c) => byId.get(c.chunkId)!).filter((row) => row && holds(row.chunk.text, quotes));
      if (picked.length) log = recordExperience(log, { corpusId: 'learn', question: q, passages: picked.map((row) => ({ chunkId: row.chunk.id, text: row.chunk.text })), vote: 1 });
    }
  }
  return log;
}

function score(test: Array<{ id: string; q: string }>, log: ExperienceLog | null) {
  let ok = 0;
  for (const { id, q } of test) ok += Number(complete(ask(q, log).chunks.map((c) => c.text), gold.get(id)!));
  return ok / test.length;
}
const refusals = (log: ExperienceLog | null) => {
  const qs = Object.values(para.unanswerable as Record<string, string[]>).flat();
  return `${qs.filter((q) => ask(q, log).chunks.length === 0).length}/${qs.length}`;
};

const ids = Object.keys(para.cases);
const originals = ids.map((id) => ({ id, q: base.cases.find((c: any) => c.id === id).question as string }));
const rows_: any[] = [];
const arms = [
  { name: 'no experience', learn: null as null | { from: 'originals' | 'originals+wordings'; noise: number; picks: boolean } },
  { name: 'ratings on the original questions', learn: { from: 'originals' as const, noise: 0, picks: false } },
  { name: 'ratings on originals + other wordings', learn: { from: 'originals+wordings' as const, noise: 0, picks: false } },
  { name: '… plus source picks when an answer missed', learn: { from: 'originals+wordings' as const, noise: 0, picks: true } },
  { name: '… with 20% of ratings wrong', learn: { from: 'originals+wordings' as const, noise: 0.2, picks: true } },
  { name: 'sleep only, nobody rated anything', learn: null, sleep: true },
  { name: 'ratings + picks, then one sleep', learn: { from: 'originals+wordings' as const, noise: 0, picks: true }, sleep: true },
] as Array<{ name: string; learn: null | { from: 'originals' | 'originals+wordings'; noise: number; picks: boolean }; sleep?: boolean }>;
for (const arm of arms) {
  const folds: number[] = [], orig: number[] = [], refused: string[] = [];
  for (let fold = 0; fold < 3; fold++) {
    const test = ids.map((id) => ({ id, q: para.cases[id][fold] as string }));
    const others = ids.flatMap((id) => (para.cases[id] as string[]).map((q, i) => ({ id, q, i })).filter((x) => x.i !== fold).map(({ id, q }) => ({ id, q })));
    let log = arm.learn ? train(arm.learn.from === 'originals' ? originals : [...originals, ...others], arm.learn.noise, 17 + fold, arm.learn.picks) : null;
    if (arm.sleep) log = doSleep(log ?? emptyExperience());
    folds.push(score(test, log));
    orig.push(score(originals, log));
    refused.push(refusals(log));
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  rows_.push({ arm: arm.name, heldOutWordings: mean(folds), folds, originals: mean(orig), refusals: refused });
}
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log(`learning-v1 · ${ids.length} questions × 3 held-out wordings · ${distractors ? 'with distractors' : 'clean corpus'}`);
console.log('arm'.padEnd(42), 'held-out wordings', 'originals', 'refused (per fold)');
for (const r of rows_) console.log(r.arm.padEnd(42), pct(r.heldOutWordings).padEnd(17), pct(r.originals).padEnd(9), r.refusals.join(' '));
if (process.argv.includes('--write')) {
  const out = root + '/learning/runs/' + (distractors ? 'distractors' : 'clean');
  mkdirSync(out, { recursive: true });
  writeFileSync(out + '/results.json', JSON.stringify({ dataset: para.version, distractors, arms: rows_ }, null, 2) + '\n');
}
if (process.argv.includes('--check')) {
  const [none, , , full, noisy] = rows_;
  const refusedAll = (r: any) => r.refusals.every((x: string) => x === none.refusals[0]);
  if (!(full.heldOutWordings > none.heldOutWordings && noisy.heldOutWordings >= none.heldOutWordings && full.originals >= none.originals && refusedAll(full) && refusedAll(noisy))) {
    console.error('experience memory did not improve held-out wordings without costing originals or refusals');
    process.exit(1);
  }
}
