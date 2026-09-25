/**
 * Jev shadow-mode evaluation. Runs the frozen repo-support dataset through
 * retrieval + the lexical gate, asks Jev for its verdict WITHOUT applying it,
 * and logs choice/confidence/latency/token usage per case. Calibration comes
 * from the measured buckets (calibrateThreshold), not assertion.
 *
 * Live mode needs TYPESAFE_API_KEY in the environment. Offline mode
 * (--offline) skips the API and reports lexical-only records.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkDocument } from '../src/lib/rag/chunking.ts';
import { retrieveFromRows, type SearchRow } from '../src/lib/rag/retrieve-core.ts';
import { jevSecondOpinion, calibrateThreshold, type JevShadowRecord } from '../src/lib/rag/jev-decision.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataset = JSON.parse(readFileSync(path.join(root, 'eval/repo-support/dataset.json'), 'utf8'));
const doc = readFileSync(path.join(root, 'eval/repo-support/fixtures/p-queue.md'), 'utf8');

const rows: SearchRow[] = [];
chunkDocument(doc).forEach((c, i) => {
  rows.push({
    title: 'p-queue', slug: 'p-queue', indexedAt: null, corpusId: 'repo-support',
    chunk: {
      id: `p-queue:${i}`, document_id: 'p-queue', ordinal: i, text: c.text,
      token_count: c.tokenCount, heading: c.heading, embedding: null, embedding_model: null,
      content_hash: `h${i}`, created_at: new Date(0).toISOString(), filepath: null, language: null,
      symbol: null, chunk_kind: 'prose', corpus_id: 'repo-support',
    } as SearchRow['chunk'],
  });
});

const offline = process.argv.includes('--offline') || !process.env.TYPESAFE_API_KEY;
const env = offline
  ? ({} as NodeJS.ProcessEnv)
  : { ...process.env, JEV_DECISION: '1' };

const records: JevShadowRecord[] = [];
for (const item of dataset.cases) {
  const r = retrieveFromRows({
    query: item.question, queryVector: null, mode: 'keyword', topK: 8, embeddingModel: null, rows,
    corpusScope: { kind: 'corpus', corpusId: 'repo-support' },
    storage: { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null },
  });
  const started = performance.now();
  const jev = await jevSecondOpinion({
    question: item.question,
    passages: r.chunks.slice(0, 5),
    gate: r.evidenceGate,
    env,
  });
  const latencyMs = Math.round(performance.now() - started);
  records.push({
    id: item.id,
    answerable: item.answerable,
    lexicalKind: r.evidenceGate.kind,
    jevChoice: jev.verdict.choice,
    jevConfidence: jev.verdict.confidence,
    usage: jev.verdict.usage,
    latencyMs,
    error: jev.verdict.error,
  });
  console.log(`${item.id}: lexical=${r.evidenceGate.kind} jev=${jev.verdict.choice ?? 'n/a'} conf=${jev.verdict.confidence?.toFixed(3) ?? 'n/a'} ${latencyMs}ms usage=${JSON.stringify(jev.verdict.usage ?? null)}${jev.verdict.error ? ' err=' + jev.verdict.error : ''}`);
}

const calibration = calibrateThreshold(records);
const totals = records.reduce(
  (acc, r) => ({ in: acc.in + (r.usage?.input_tokens ?? 0), out: acc.out + (r.usage?.output_tokens ?? 0) }),
  { in: 0, out: 0 },
);
console.log('calibration:', JSON.stringify(calibration));
console.log(`total tokens: in=${totals.in} out=${totals.out}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(root, 'eval/jev-shadow/runs', stamp);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ offline, records, calibration, totals }, null, 2));
console.log(`saved to ${dir}`);
