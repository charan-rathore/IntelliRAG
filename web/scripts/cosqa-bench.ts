/** The search bar against a public code-search benchmark: CoSQA (Huang et al., ACL 2021).
 * Run from web: COSQA_DIR=<CodeXGLUE>/Text-Code/NL-code-search-WebQuery/CoSQA npx tsx scripts/cosqa-bench.ts [--write]
 *
 * Real Bing queries ("python remove all empty items in list") against 6,267
 * Python functions: every unique function in CoSQA. That is the same document
 * set as NanoCoIR's CosQA task. Queries are the 313 dev queries labelled as
 * answered by their function; scoring is the rank of that function. Settings
 * were tuned only on 500 training queries (--tune), never on dev.
 * The data isn't committed; CI fetches it from microsoft/CodeXGLUE.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BM25Index } from '../src/lib/rag/bm25';
import { CodeSearchIndex, DEFAULT_SEARCH, learnAssociations, type Associations, type SearchOptions } from '../src/lib/rag/code-search';

const dir = process.env.COSQA_DIR;
if (!dir) { console.error('Set COSQA_DIR to CodeXGLUE/Text-Code/NL-code-search-WebQuery/CoSQA'); process.exit(2); }
type Pair = { idx: string; doc: string; code: string; label: number };
const all: Pair[] = JSON.parse(readFileSync(resolve(dir, 'cosqa-all.json'), 'utf8'));
const dev: Pair[] = JSON.parse(readFileSync(resolve(dir, 'cosqa-dev.json'), 'utf8'));
const codes = [...new Set([...all, ...dev].map((p) => p.code))];
const idOf = new Map(codes.map((c, i) => [c, `f${i}`]));
const docs = codes.map((c, i) => ({ id: `f${i}`, body: c, lang: 'py', kind: 'code' as const }));

const devQ = dev.filter((p) => p.label === 1).map((p) => ({ q: p.doc, gold: idOf.get(p.code)! }));
// Training queries for tuning: a fixed, evenly spaced sample, disjoint from dev.
const trainPos = all.filter((p) => p.label === 1 && p.idx.startsWith('cosqa-train'));
const trainQ = Array.from({ length: 500 }, (_, i) => trainPos[Math.floor((i * trainPos.length) / 500)]!).map((p) => ({ q: p.doc, gold: idOf.get(p.code)! }));

function metrics(rank: (q: string) => string[], qs: Array<{ q: string; gold: string }>) {
  let mrr = 0, ndcg = 0, r1 = 0, r5 = 0, r10 = 0;
  for (const { q, gold } of qs) {
    const i = rank(q).slice(0, 10).indexOf(gold);
    if (i < 0) continue;
    mrr += 1 / (i + 1); ndcg += 1 / Math.log2(i + 2);
    if (i < 1) r1++; if (i < 5) r5++; r10++;
  }
  const n = qs.length;
  return { mrr10: mrr / n, ndcg10: ndcg / n, r1: r1 / n, r5: r5 / n, r10: r10 / n };
}

const plain = new BM25Index(docs.map((d) => ({ id: d.id, text: d.body })));
// Learned associations from CoSQA's training pairs only (dev is never seen).
const assoc: Associations = learnAssociations(all.filter((p) => p.label === 1 && p.idx.startsWith('cosqa-train')).map((p) => ({ query: p.doc, doc: p.code })));
const engine = (opts: Partial<SearchOptions>, learned = false) => { const ix = new CodeSearchIndex(docs, { ...DEFAULT_SEARCH, ...opts }, learned ? assoc : null); return (q: string) => ix.search(q, 10).map((h) => h.id); };

if (process.argv.includes('--tune')) {
  // Coarse grid on training queries only.
  // Tuning queries are held out of the association table, so tuning measures generalisation.
  const tuneIds = new Set(trainQ.map((x) => x.q));
  const assocTune = learnAssociations(all.filter((p) => p.label === 1 && p.idx.startsWith('cosqa-train') && !tuneIds.has(p.doc)).map((p) => ({ query: p.doc, doc: p.code })));
  for (const nameWeight of [2, 4]) for (const synonymWeight of [0, 0.35]) for (const associationWeight of [0, 0.2, 0.35, 0.5, 0.8]) for (const associationsPerTerm of [2, 4, 8]) {
    const ix = new CodeSearchIndex(docs, { ...DEFAULT_SEARCH, nameWeight, synonymWeight, associationWeight, associationsPerTerm, prfDocs: 0 }, assocTune);
    const m = metrics((q) => ix.search(q, 10).map((h) => h.id), trainQ);
    console.log(JSON.stringify({ nameWeight, synonymWeight, associationWeight, associationsPerTerm }), m.ndcg10.toFixed(4));
  }
  process.exit(0);
}

const arms: Array<[string, (q: string) => string[]]> = [
  ['BM25, IntelliRAG prose tokenizer', (q) => plain.search(q, 10).map((h) => h.id)],
  ['+ identifier-aware tokens', engine({ nameWeight: 1, docWeight: 1 })],
  ['+ name and docstring fields (BM25F)', engine({})],
  ['  (tried, off) + developer lexicon', engine({ useLexicon: true })],
  ['  (tried, off) + pseudo-relevance feedback (RM3)', engine({ prfDocs: 8 })],
  ['+ learned query→code associations: search bar', engine({}, true)],
];
const pct = (x: number) => (100 * x).toFixed(2);
console.log(`CoSQA · ${devQ.length} dev queries · ${docs.length} functions`);
console.log('arm'.padEnd(42), 'nDCG@10  MRR@10  R@1    R@5    R@10');
const results: any[] = [];
for (const [name, fn] of arms) {
  const m = metrics(fn, devQ);
  results.push({ arm: name, ...m });
  console.log(name.padEnd(42), pct(m.ndcg10).padEnd(8), pct(m.mrr10).padEnd(7), pct(m.r1).padEnd(6), pct(m.r5).padEnd(6), pct(m.r10));
}
if (process.argv.includes('--write')) {
  const out = resolve(import.meta.dirname, '../../eval/code-search');
  mkdirSync(out, { recursive: true });
  writeFileSync(out + '/cosqa-results.json', JSON.stringify({ benchmark: 'CoSQA dev (label 1) vs all unique CoSQA functions', queries: devQ.length, documents: docs.length, settings: DEFAULT_SEARCH, arms: results }, null, 2) + '\n');
}
if (process.argv.includes('--check')) {
  // The search bar must clearly beat plain BM25 and match the committed numbers.
  const committed = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../eval/code-search/cosqa-results.json'), 'utf8'));
  const bar = results.at(-1)!, base = results[0]!;
  const was = committed.arms.at(-1).ndcg10;
  const fails: string[] = [];
  if (bar.ndcg10 - base.ndcg10 < 0.02) fails.push(`search bar nDCG@10 ${pct(bar.ndcg10)} is not 2 points above plain BM25 ${pct(base.ndcg10)}`);
  if (Math.abs(bar.ndcg10 - was) > 0.005) fails.push(`search bar nDCG@10 ${pct(bar.ndcg10)} drifted from committed ${pct(was)}; rerun with --write if intended`);
  if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
  console.log('check passed');
}
