/* eslint-disable @typescript-eslint/no-require-imports */
// Core lexical-path A/B benchmark: upload-side tokenization, retrieveFromRows
// retrieval, extractive grounded output. Run against a given web root:
//   node scripts/perf/lexical-core-bench.cjs /abs/path/to/web
// Storage-free (rows built in memory), no model/network. Representative docs:
// real repo docs plus edge cases (unicode NFD, code, tables, empty, long).
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
require.extensions['.ts'] = (mod, file) =>
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);

const webRoot = process.argv[2];
if (!webRoot) throw new Error('usage: node lexical-core-bench.cjs <webRoot>');
const text = require(path.join(webRoot, 'src/lib/rag/text.ts'));
const { retrieveFromRows } = require(path.join(webRoot, 'src/lib/rag/retrieve-core.ts'));
const { extractiveAnswer } = require(path.join(webRoot, 'src/lib/rag/extractive.ts'));

// ---- corpus: real repo docs + representative edge docs ----
function collectMd(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectMd(p, out);
    else if (e.name.endsWith('.md')) out.push(fs.readFileSync(p, 'utf8'));
  }
}
const docs = [];
collectMd(path.join(webRoot, 'docs'), docs);
docs.push(
  'Mu\u0308nchen u\u0308ber scho\u0308ne gro\u0308ße A\u0308nderung', // NFD unicode edge
  'export function retry(fn, ms) { return new Promise((res) => setTimeout(() => res(fn()), ms)); } // timeout backoff jitter cluster',
  'error\tcode\taction\nE_TIMEOUT\t408\tretry with backoff\nE_MEM\t507\tfree cache and retry',
  '',
  'Queue timeout runbook. '.repeat(400) + 'Memory limit and request handling.',
  'The and or of to in on a an it is as be by do we me my', // stopword-dense
);

// chunk like the app does: fixed windows over paragraphs
const rows = [];
let cid = 0;
for (let d = 0; d < docs.length; d++) {
  const body = docs[d];
  const paras = body.split(/\n\s*\n/).flatMap((p) => p.match(/[\s\S]{1,900}(?:\s|$)/g) || []);
  for (const t of paras) {
    rows.push({
      title: `doc ${d}`, slug: `doc-${d}`, indexedAt: null, corpusId: 'c1',
      chunk: { id: `ch${cid++}`, document_id: `d${d}`, ordinal: 0, text: t.trim(), token_count: t.length >> 2, heading: null, embedding: null, embedding_model: null, content_hash: `h${cid}`, created_at: '', filepath: null, language: null, symbol: null, chunk_kind: 'prose', corpus_id: 'c1' },
    });
  }
}
// scale to a realistic corpus: replicate rows x20 with unique ids (same text)
const baseRows = rows.splice(0);
for (let k = 0; k < 20; k++) {
  for (const r of baseRows) {
    rows.push({ ...r, chunk: { ...r.chunk, id: `ch${cid++}`, content_hash: `h${cid}` } });
  }
}

const queries = [
  'queue timeout retry backoff', 'memory limit request handling', 'München Änderung',
  'cluster error code E_TIMEOUT action', 'how do nodes handle failures',
  'service resource aggregate pattern', 'explain the guide for servers',
  'retry(fn, ms) promise backoff', ' zwischen before after than then ',
  'nonexistent xyzzy frobnicate', 'the and of', 'evidence provenance citation',
];
for (let r = 0; r < 8; r++) queries.push(queries[r % queries.length] + ' ' + r);

const storage = { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null };
const scope = { kind: 'corpus', corpusId: 'c1' };

function runOnce() {
  const t0 = performance.now();
  let kept = 0;
  for (const r of rows) kept += text.contentTokens(`${r.title}\n${r.chunk.text}`).length; // upload-side
  const t1 = performance.now();
  let answers = 0;
  for (const q of queries) {
    const res = retrieveFromRows({ query: q, queryVector: null, mode: 'hybrid', topK: 8, embeddingModel: null, rows, storage, corpusScope: scope });
    answers += extractiveAnswer(q, res.chunks).length; // grounded output stage
  }
  const t2 = performance.now();
  return { tokenizeMs: t1 - t0, retrieveAnswerMs: t2 - t1, kept, answers, chunks: rows.length };
}

// warmup both paths
runOnce(); runOnce();
const SAMPLES = 12;
const tok = [], ret = [];
for (let i = 0; i < SAMPLES; i++) {
  const r = runOnce();
  tok.push(r.tokenizeMs); ret.push(r.retrieveAnswerMs);
}
if (process.env.DUMP === '1') {
  // Exact-parity dump: full token sequences, per-query ranked ids + scores, answers.
  const dump = { tokens: [], results: [] };
  for (const r of rows) dump.tokens.push(text.contentTokens(`${r.title}\n${r.chunk.text}`).join(' '));
  for (const q of queries) {
    const res = retrieveFromRows({ query: q, queryVector: null, mode: 'hybrid', topK: 8, embeddingModel: null, rows, storage, corpusScope: scope });
    dump.results.push({
      q,
      ids: res.chunks.map((c) => c.chunkId),
      scores: res.chunks.map((c) => +c.score.toFixed(12)),
      retrievers: res.chunks.map((c) => c.retriever),
      answer: extractiveAnswer(q, res.chunks),
    });
  }
  console.log(JSON.stringify(dump));
  return;
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const check = runOnce();
console.log(JSON.stringify({ webRoot: path.basename(path.dirname(webRoot)) + '/' + path.basename(webRoot), chunks: check.chunks, kept: check.kept, answers: check.answers, tokenizeMedianMs: +med(tok).toFixed(3), retrieveAnswerMedianMs: +med(ret).toFixed(3), tokSamples: tok.map((x) => +x.toFixed(2)), retSamples: ret.map((x) => +x.toFixed(2)) }));
