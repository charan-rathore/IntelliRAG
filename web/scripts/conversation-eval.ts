/** Multi-turn retrieval: does the evidence for a follow-up reach the reader?
 * Run from web: npx tsx scripts/conversation-eval.ts [--distractors] [--write]
 *
 * Every arm answers the conversation turn by turn, carrying its own earlier
 * results forward, against the frozen p-queue README of eval/repo-support.
 * Scored on the text actually packed (1,400-token budget), and on whether
 * turns the source can't answer are still refused. No model runs here.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chunkDocument } from '../src/lib/rag/chunking';
import { retrieveFromRows, type SearchRow } from '../src/lib/rag/retrieve-core';
import { buildIdf } from '../src/lib/rag/ranking';
import { SEED_DOCUMENTS } from '../src/lib/rag/corpus';
import { planTurn, mustRefuse, type SessionTurn } from '../src/lib/rag/session-intent';

const root = resolve(import.meta.dirname, '../../eval');
const dataset = JSON.parse(readFileSync(root + '/conversations/dataset.json', 'utf8'));
const source = readFileSync(root + '/repo-support/fixtures/p-queue.md', 'utf8');
const distractors = process.argv.includes('--distractors');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

const rows: SearchRow[] = [];
for (const doc of [{ slug: 'p-queue', title: 'p-queue README', body: source }, ...(distractors ? SEED_DOCUMENTS : [])]) {
  for (const c of chunkDocument(doc.body, { filepath: doc.slug === 'p-queue' ? 'readme.md' : doc.slug + '.md' })) {
    rows.push({ title: doc.title, slug: doc.slug, indexedAt: null, corpusId: 'conv', chunk: {
      id: `${doc.slug}:${c.ordinal}`, document_id: doc.slug, ordinal: c.ordinal, text: c.text, token_count: c.tokenCount, heading: c.heading,
      embedding: null, embedding_model: null, content_hash: hash(c.text), created_at: '', filepath: c.filepath, language: c.language,
      symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: 'conv' } } as SearchRow);
  }
}
const idf = buildIdf(rows.map((r) => `${r.title}\n${r.chunk.text}`));
const retrieve = (query: string) => retrieveFromRows({ query, queryVector: null, mode: 'keyword', topK: 8, embeddingModel: null, rows,
  corpusScope: { kind: 'corpus', corpusId: 'conv' }, storage: { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null } as any });

type Arm = 'turn-only' | 'concat-history' | 'session-intent';
const ARMS: Arm[] = ['turn-only', 'concat-history', 'session-intent'];
const results: any[] = [];
for (const arm of ARMS) {
  for (const conv of dataset.conversations) {
    const history: SessionTurn[] = [];
    conv.turns.forEach((turn: any, i: number) => {
      let query = turn.q, mode = 'n/a', carried: string[] = [];
      if (arm === 'concat-history') query = [...conv.turns.slice(0, i).map((t: any) => t.q), turn.q].join(' ');
      let plan = null;
      if (arm === 'session-intent') { plan = planTurn(turn.q, history, idf); query = plan.resolved; mode = plan.mode; carried = plan.carried.map((c) => c.term); }
      const r = retrieve(query);
      let packed = r.chunks.map((c) => ({ chunkId: c.chunkId, text: c.text, heading: c.heading }));
      if (plan && mustRefuse(plan, packed.map((p) => p.text))) packed = [];
      const refused = packed.length === 0;
      const gold: string[] = turn.evidence;
      const found = gold.filter((q) => packed.some((p) => normalize(p.text).includes(normalize(q)))).length;
      results.push({ arm, conversation: conv.id, turn: i + 1, kind: turn.kind, question: turn.q, searched: query, mode, carried,
        refused, answerable: gold.length > 0, recall: gold.length ? found / gold.length : null, complete: gold.length ? Number(found === gold.length) : null,
        correctRefusal: gold.length ? null : Number(refused), packed: packed.map((p) => p.chunkId) });
      history.push({ query: turn.q, packed, refused });
    });
  }
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isNaN(x) ? '—' : `${(100 * x).toFixed(1)}%`);
const summary: any = {};
for (const arm of ARMS) {
  const rs = results.filter((r) => r.arm === arm);
  const ans = rs.filter((r) => r.answerable);
  const by = (k: string) => ans.filter((r) => r.kind === k);
  summary[arm] = {
    completeEvidence: mean(ans.map((r) => r.complete)), evidenceRecall: mean(ans.map((r) => r.recall)),
    followUps: mean(by('follow-up').map((r) => r.complete)), switches: mean(by('switch').map((r) => r.complete)), opening: mean(by('open').map((r) => r.complete)),
    refusals: `${rs.filter((r) => !r.answerable && r.refused).length}/${rs.filter((r) => !r.answerable).length}`,
  };
}
console.log(`conversations-v1 · ${dataset.conversations.length} conversations · ${results.length / ARMS.length} turns · ${distractors ? 'with distractors' : 'clean corpus'}`);
console.log('arm'.padEnd(16), 'complete', 'recall ', 'opening', 'follow-ups', 'switches', 'refused');
for (const arm of ARMS) { const s = summary[arm]; console.log(arm.padEnd(16), pct(s.completeEvidence).padEnd(8), pct(s.evidenceRecall).padEnd(7), pct(s.opening).padEnd(7), pct(s.followUps).padEnd(10), pct(s.switches).padEnd(8), s.refusals); }
if (process.argv.includes('--write')) {
  const out = root + '/conversations/runs/' + (distractors ? 'distractors' : 'clean');
  mkdirSync(out, { recursive: true });
  writeFileSync(out + '/results.json', JSON.stringify({ dataset: dataset.version, distractors, summary, results }, null, 2) + '\n');
}
if (process.argv.includes('--verbose')) for (const r of results.filter((r) => r.arm === 'session-intent')) console.log(r.conversation, r.turn, r.kind, r.mode, r.refused ? 'REFUSED' : `c=${r.complete}`, '|', r.carried.join(','));

// --check: the CI gate. Session intent must not lose evidence to the turn-only
// arm, and must refuse at least as many unanswerable turns.
if (process.argv.includes('--check')) {
  const a = summary['session-intent'], b = summary['turn-only'];
  const refusals = (x: string) => Number(x.split('/')[0]);
  if (a.completeEvidence < b.completeEvidence || refusals(a.refusals) < refusals(b.refusals)) {
    console.error('session intent regressed against the turn-only arm');
    process.exit(1);
  }
}
