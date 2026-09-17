/** Real retrieval measurements, with optional paired OpenRouter generation.
 * Run from web: npx tsx scripts/repo-support-eval.ts
 * Cloud: node --env-file=.env.local --import tsx scripts/repo-support-eval.ts --generate
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chunkDocument } from '../src/lib/rag/chunking';
import { retrieveFromRows, type SearchRow } from '../src/lib/rag/retrieve-core';
import { BM25Index } from '../src/lib/rag/bm25';
import { GROUNDED_SYSTEM } from '../src/lib/rag/evidence';
import { SEED_DOCUMENTS } from '../src/lib/rag/corpus';

const root = resolve(import.meta.dirname, '../../eval/repo-support');
const datasetText = readFileSync(root + '/dataset.json', 'utf8');
const dataset = JSON.parse(datasetText);
const source = readFileSync(root + '/fixtures/p-queue.md', 'utf8');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
if (hash(source) !== dataset.source.sha256) throw Error('Frozen source hash mismatch');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
const generate = process.argv.includes('--generate');
const distractors = process.argv.includes('--distractors');
const model = process.env.EVAL_MODEL || 'google/gemini-3.7-flash';
const cap = Number(process.env.EVAL_MAX_USD);
if (generate && (!process.env.OPENROUTER_API_KEY || !Number.isFinite(cap) || cap <= 0)) {
  throw Error('Cloud runs require OPENROUTER_API_KEY and an explicit positive EVAL_MAX_USD. No requests sent.');
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(process.env.EVAL_OUTPUT || root + '/runs/' + stamp);
mkdirSync(out, { recursive: true });
const git = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const codeHashes = Object.fromEntries(['scripts/repo-support-eval.ts', 'src/lib/rag/chunking.ts', 'src/lib/rag/retrieve-core.ts', 'src/lib/rag/ranking.ts', 'src/lib/rag/evidence.ts'].map(p => [p, hash(readFileSync(resolve(import.meta.dirname, '..', p), 'utf8'))]));
const report: any = { protocol: dataset.version, at: new Date().toISOString(), git, dirty, codeHashes, datasetHash: hash(datasetText), distractors,
  source: dataset.source, runtime: { node: process.version, platform: process.platform, arch: process.arch },
  generation: generate ? { requestedModel: model, capUSD: cap, spentUSD: 0 } : null,
  limits: 'Single README; first-party annotations; evidence-anchor coverage is not answer correctness or Ragas faithfulness. Local CPU stage timings exclude network/storage. No dense embeddings in this run.', results: [] };
if (existsSync(out + '/results.json')) {
  if (!process.argv.includes('--resume')) throw Error('Output already contains a run; use --resume or a new EVAL_OUTPUT');
  const previous = JSON.parse(readFileSync(out + '/results.json', 'utf8'));
  if (previous.datasetHash !== report.datasetHash || previous.distractors !== distractors ||
      JSON.stringify(previous.codeHashes) !== JSON.stringify(codeHashes) ||
      previous.generation?.requestedModel !== report.generation?.requestedModel) throw Error('Resume configuration differs from saved run');
  if (generate && cap < previous.generation.spentUSD) throw Error('Cap is below already spent/reserved cost');
  Object.assign(report, previous);
  if (generate) report.generation.capUSD = cap;
  report.resumedAt = new Date().toISOString(); delete report.stopped;
}
const save = () => writeFileSync(out + '/results.json', JSON.stringify(report, null, 2) + '\n');
const buildStart = performance.now();
const rows: SearchRow[] = [];
for (const doc of [{ slug: 'p-queue', title: 'p-queue README', body: source }, ...(distractors ? SEED_DOCUMENTS : [])]) {
  for (const c of chunkDocument(doc.body, { filepath: doc.slug === 'p-queue' ? 'readme.md' : doc.slug + '.md' })) {
    rows.push({ title: doc.title, slug: doc.slug, indexedAt: null, corpusId: 'repo-support', chunk: {
      id: `${doc.slug}:${c.ordinal}`, document_id: doc.slug, ordinal: c.ordinal, text: c.text,
      token_count: c.tokenCount, heading: c.heading, embedding: null, embedding_model: null,
      content_hash: hash(c.text), created_at: '', filepath: c.filepath, language: c.language,
      symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: 'repo-support',
    } });
  }
}
report.chunking = { wallMs: performance.now() - buildStart, chunks: rows.length,
  targetChunks: rows.filter(r => r.slug === 'p-queue').length, distractorDocuments: distractors ? SEED_DOCUMENTS.length : 0 };
writeFileSync(out + '/chunks.json', JSON.stringify(rows, null, 2));
const byId = new Map(rows.map(r => [r.chunk.id, r]));
const bm25 = new BM25Index(rows.map(r => ({ id: r.chunk.id, text: `${r.title}\n${r.chunk.text}` })));
const pack = (ids: string[]) => {
  let tokens = 0;
  return ids.filter(id => { const n = byId.get(id)!.chunk.token_count; if (tokens + n > 1400) return false; tokens += n; return true; });
};
type Evidence = { quote: string; start: number; end: number; line: number };
function metrics(ids: string[], gold: Evidence[]) {
  if (!gold.length) return { evidenceRecall: null, completeEvidence: null, reciprocalRank: null, evidencePrecision: null };
  const covers = (id: string, e: Evidence) => normalize(byId.get(id)!.chunk.text).includes(normalize(e.quote));
  const found = gold.filter(e => ids.some(id => covers(id, e))).length;
  const first = ids.findIndex(id => gold.some(e => covers(id, e)));
  return { evidenceRecall: found / gold.length, completeEvidence: Number(found === gold.length),
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1), evidencePrecision: ids.length ? ids.filter(id => gold.some(e => covers(id, e))).length / ids.length : 0 };
}
let catalog: any;
if (generate) {
  const r = await fetch('https://openrouter.ai/api/v1/models');
  if (!r.ok) throw Error('Cannot verify live model catalog');
  catalog = (await r.json()).data.find((m: any) => m.id === model);
  if (!catalog) throw Error('Requested model is absent from OpenRouter catalog');
  report.generation.catalog = catalog;
}
async function complete(system: string, user: string) {
  // Conservative character upper bound for inputs; output includes reasoning tokens.
  const reserve = (system.length + user.length + 1024) * Number(catalog.pricing.prompt) + 4096 * Number(catalog.pricing.completion);
  if (!Number.isFinite(reserve) || reserve <= 0) throw Error('Cannot establish a conservative request cost');
  if (report.generation.spentUSD + reserve > cap) throw Error('Evaluation spending cap reached before request');
  // Write-ahead reservation also covers a process crash or transport timeout.
  report.generation.spentUSD += reserve; save();
  const t = performance.now();
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, provider: { allow_fallbacks: false }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, seed: 42, max_tokens: 4096, reasoning: { effort: 'low' } }),
    signal: AbortSignal.timeout(180000) });
  // Reserve uncertain charges on failures. Never log request headers or raw provider errors.
  if (!r.ok) throw Error(`Provider HTTP ${r.status}`);
  const data = await r.json();
  const cost = data.usage?.cost;
  if (typeof cost === 'number') report.generation.spentUSD += cost - reserve;
  const choice = data.choices?.[0];
  if (!choice?.message?.content || choice.finish_reason !== 'stop') throw Error('Missing or truncated model answer');
  return { answer: choice.message.content, model: data.model, provider: data.provider, id: data.id, usage: data.usage,
    costBasis: typeof cost === 'number' ? 'provider reported' : 'conservative reserve', wallMs: performance.now() - t };
}
for (const [index, item] of dataset.cases.entries()) {
  const t = performance.now();
  const baselineIds = pack(bm25.search(item.question, 8).map(r => r.id));
  const baselineMs = performance.now() - t;
  const result = retrieveFromRows({ query: item.question, queryVector: null, mode: 'keyword', topK: 8, embeddingModel: null, rows,
    corpusScope: { kind: 'corpus', corpusId: 'repo-support' }, storage: { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null } });
  const ids = result.chunks.map(c => c.chunkId);
  const oracle = rows.filter(r => r.slug === 'p-queue' && item.evidence.some((e: Evidence) => normalize(r.chunk.text).includes(normalize(e.quote)))).map(r => r.chunk.id);
  const existing = report.results.find((r: any) => r.id === item.id);
  const row: any = existing ?? { id: item.id, split: item.split, category: item.category, answerable: item.answerable,
    question: item.question, requiredClaims: item.requiredClaims, evidence: item.evidence,
    bm25: { ids: baselineIds, metrics: metrics(baselineIds, item.evidence), wallMs: baselineMs },
    intellirag: { ids, metrics: metrics(ids, item.evidence), gate: result.evidenceGate, tokens: result.contextTokens,
      stages: { keywordMs: result.keywordMs, rerankMs: result.rerankMs, assembleMs: result.assembleMs }, candidates: result.candidates },
    oracle: { ids: oracle, metrics: metrics(oracle, item.evidence) } };
  if (!existing) report.results.push(row); save();
  if (generate) {
    row.answers ??= {};
    const arms = ['no-context', 'bm25', 'intellirag', 'oracle', 'full-context'];
    // Rotate order to reduce always-first provider/cache effects.
    for (const arm of [...arms.slice(index % arms.length), ...arms.slice(0, index % arms.length)]) {
      const file = `${out}/${item.id}-${arm}.json`;
      try {
        if (existsSync(file)) { row.answers[arm] = JSON.parse(readFileSync(file, 'utf8')); continue; }
        const selected = arm === 'bm25' ? baselineIds : arm === 'intellirag' ? ids : oracle;
        const context = arm === 'full-context' ? `[Source 1] p-queue README\n${source}` : selected.map((id, i) => `[Source ${i + 1}] ${byId.get(id)!.title}\n${byId.get(id)!.chunk.text}`).join('\n\n');
        const response = arm === 'intellirag' && result.evidence === 'insufficient'
          ? { answer: 'Not in the indexed corpus.', model: 'grounding-gate', wallMs: 0 }
          : await complete(arm === 'no-context' ? 'Answer the repository support question using your knowledge. If unknown, say so. Do not fabricate evidence.' : GROUNDED_SYSTEM,
            arm === 'no-context' ? item.question : `Sources:\n${context}\n\nQuestion: ${item.question}\n\nAnswer with a complete, readable response:`);
        row.answers[arm] = response;
        row.answers[arm].contexts = arm === 'no-context' ? [] : arm === 'full-context' ? [source] : selected.map(id => byId.get(id)!.chunk.text);
        writeFileSync(file, JSON.stringify(response, null, 2));
      } catch (error) {
        row.answers[arm] = { error: error instanceof Error ? error.message : 'Generation failed' };
        report.stopped = true; save(); throw error;
      }
      save();
    }
  }
  console.log(`${item.id}: evidence ${row.bm25.metrics.evidenceRecall ?? 'n/a'} → ${row.intellirag.metrics.evidenceRecall ?? 'n/a'}; ${result.evidence}`);
}
report.complete = true; save();
if (generate) {
  const records = report.results.flatMap((r: any) => Object.entries(r.answers).filter(([, a]: any) => !a.error).map(([arm, a]: any) => ({
    id: r.id, arm, user_input: r.question, response: a.answer, retrieved_contexts: a.contexts,
    reference: r.answerable ? r.requiredClaims.join('. ') : 'The provided source does not establish the requested information.',
  })));
  writeFileSync(out + '/ragas-input.jsonl', records.map((r: any) => JSON.stringify(r)).join('\n') + '\n');
}
console.log(`Saved measured results to ${out}`);
