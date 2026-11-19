/** Real GitHub issues: can IntelliRAG find the file a bug lives in, and does it get better with use?
 * Run from web:
 *   SWE_JSON=<moatless-tools>/moatless/evaluation/swebench_lite_all_evaluations.json \
 *   SWE_REPOS=/tmp/swe npx tsx scripts/swe-loc-bench.ts [--repos django,pytest] [--write] [--check]
 *
 * Issues are SWE-bench Lite (Jimenez et al., ICLR 2024): real issues from real
 * repositories, each with the patch that fixed it. The task is file
 * localization, as in Agentless and LocAgent: given the issue text, rank the
 * repository's files; a hit is any file the fixing patch changed within the
 * top k. Each repository is indexed once, at the commit of its earliest issue
 * in the set, so no later fix is in the index. Test files are left out, as the
 * fixes don't touch them (tests are a separate patch in SWE-bench).
 *
 * Issues are replayed in order (pull-request number). Online evaluation: each
 * issue is ranked first, with only what earlier issues taught, and then the
 * fix is filed as a confirmed source pick: the passages of the patched files
 * that hold the patched functions. That is a developer telling IntelliRAG
 * "this is where that issue lived", once per issue. The sleep arm runs a sleep
 * cycle (sleep.ts) every 10 issues.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { chunkDocument } from '../src/lib/rag/chunking';
import { languageFromPath } from '../src/lib/rag/github';
import { retrieveFromRows, type SearchRow } from '../src/lib/rag/retrieve-core';
import type { ExperienceLog } from '../src/lib/rag/experience';
import { CodeSearchIndex } from '../src/lib/rag/code-search';
import { DefinitionIndex, devEntities } from '../src/lib/rag/dev-entities';
import { addCase, caseEvidence, consolidateCases, emptyCaseMemory, rerankWithCases, type CaseWeights } from '../src/lib/rag/case-memory';

const SWE_JSON = process.env.SWE_JSON, SWE_REPOS = process.env.SWE_REPOS ?? '/tmp/swe';
if (!SWE_JSON) { console.error('Set SWE_JSON to moatless-tools/moatless/evaluation/swebench_lite_all_evaluations.json'); process.exit(2); }
const REPOS: Record<string, string> = { sympy: 'sympy/sympy', django: 'django/django', pytest: 'pytest-dev/pytest', sklearn: 'scikit-learn/scikit-learn', sphinx: 'sphinx-doc/sphinx' };
const argRepos = process.argv.find((a) => a.startsWith('--repos='))?.slice(8).split(',') ?? ['pytest', 'sphinx', 'sklearn', 'django'];
const all = JSON.parse(readFileSync(SWE_JSON, 'utf8')) as Array<{ instance_id: string; repo: string; base_commit: string; problem_statement: string; expected_spans: Record<string, string[]> }>;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const isTest = (p: string) => /(^|\/)(tests?|testing)\//.test(p) || /(^|\/)(test_[^/]*|[^/]*_tests?)\.py$/.test(p) || p.includes('/conftest');
const MAX_ISSUE = 2000;

function walk(dir: string, root: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, root, out);
    else if (name.endsWith('.py')) out.push(relative(root, p));
  }
  return out;
}

function index(dir: string, corpusId: string): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const path of walk(dir, dir)) {
    if (isTest(path)) continue;
    const body = readFileSync(join(dir, path), 'utf8');
    // Chunked the way GitHub ingestion chunks code (ingest.server.ts): by definition.
    for (const c of chunkDocument(body, { filepath: path, kind: 'code', language: languageFromPath(path) })) {
      rows.push({ title: path, slug: path, indexedAt: null, corpusId, chunk: {
        id: `${path}:${c.ordinal}`, document_id: path, ordinal: c.ordinal, text: c.text, token_count: c.tokenCount, heading: c.heading,
        embedding: null, embedding_model: null, content_hash: hash(c.text), created_at: '', filepath: c.filepath, language: c.language,
        symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: corpusId } } as SearchRow);
    }
  }
  return rows;
}

type Arm = 'before' | 'retrieval' | 'search' | 'search+entities' | 'fixed memory' | 'memory+sleep';
const ARMS: Arm[] = (['before', 'retrieval', 'search', 'search+entities', 'fixed memory', 'memory+sleep'] as Arm[]).filter((a) => (a !== 'retrieval' && a !== 'before') || !process.argv.includes('--fast'));
const FIXED: CaseWeights = { similar: Number(process.env.CASE_SIM ?? 0.5), prior: Number(process.env.CASE_PRIOR ?? 0) };
const LAMBDA = Number(process.env.LINK_W ?? 0.005);
const perIssue: Array<{ id: string; repo: string; url: string; title: string; gold: string[]; rank: Record<Arm, number | null> }> = [];
const summary: any[] = [];

for (const key of argRepos) {
  const repo = REPOS[key]!;
  const issues = all.filter((x) => x.repo === repo).sort((a, b) => Number(a.instance_id.split('-').at(-1)) - Number(b.instance_id.split('-').at(-1)));
  const rows = index(resolve(SWE_REPOS, key), key);
  const byPath = new Map<string, SearchRow[]>();
  for (const r of rows) (byPath.get(r.slug) ?? byPath.set(r.slug, []).get(r.slug)!).push(r);
  const run = (q: string, log: ExperienceLog | null, linkCode = true) => retrieveFromRows({ linkCode, query: q, queryVector: null, mode: 'keyword', topK: 5, embeddingModel: null, rows,
    corpusScope: { kind: 'corpus', corpusId: key }, storage: { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null } as never, experience: log });
  const files = (q: string, log: ExperienceLog | null, linkCode = true) => run(q, log, linkCode).stages.rerank.map((s) => s.slug);
  const cs = new CodeSearchIndex(rows.map((r) => ({ id: r.chunk.id, name: r.chunk.symbol, body: r.chunk.text, path: r.chunk.filepath, kind: 'code' as const })));
  const pathOf = new Map(rows.map((r) => [r.chunk.id, r.slug]));
  const searchFiles = (q: string) => { const seen: string[] = []; for (const h of cs.search(q.replace(/[-"]/g, ' '), 200)) { const f = pathOf.get(h.id)!; if (!seen.includes(f)) seen.push(f); } return seen; };
  const defs = new DefinitionIndex(rows.map((r) => ({ path: r.slug, text: r.chunk.text })));
  const linked = (q: string) => {
    const base = searchFiles(q);
    const link = defs.link(devEntities(q));
    const score = new Map<string, number>();
    base.forEach((f, i) => score.set(f, 1 / (60 + i + 1)));
    for (const [f, w] of link) score.set(f, (score.get(f) ?? 0) + LAMBDA * w);
    return [...score].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  };
  console.error(`${key}: ${issues.length} issues, ${byPath.size} files, ${rows.length} passages`);

  let memory = emptyCaseMemory();
  const sleepLog: string[] = [];
  issues.forEach((issue, n) => {
    const q = issue.problem_statement.slice(0, MAX_ISSUE);
    const gold = Object.keys(issue.expected_spans);
    const rank = {} as Record<Arm, number | null>;
    for (const arm of ARMS) {
      const ranked = arm === 'before' ? files(q, null, false) : arm === 'retrieval' ? files(q, null) : arm === 'search' ? searchFiles(q) : arm === 'search+entities' ? linked(q)
        : rerankWithCases(linked(q), caseEvidence(memory.cases, q), arm === 'fixed memory' ? FIXED : memory.weights);
      const i = ranked.findIndex((f) => gold.includes(f));
      rank[arm] = i < 0 ? null : i + 1;
    }
    const num = issue.instance_id.split('-').at(-1);
    perIssue.push({ id: issue.instance_id, repo, url: `https://github.com/${repo}/pull/${num}`, title: issue.problem_statement.split('\n')[0]!.slice(0, 120), gold, rank });
    // The fix lands: the files it changed are filed against the issue's text.
    memory = addCase(memory, { q, files: gold, at: n });
    if ((n + 1) % 10 === 0) {
      memory = consolidateCases(memory, linked, { at: n, margin: Number(process.env.CASE_MARGIN ?? 0.03), minCases: Number(process.env.CASE_MIN ?? 8) });
      const j = memory.journal.at(-1);
      if (j) sleepLog.push(`after ${n + 1}: ${j.accepted ? 'accepted' : 'kept'} ${JSON.stringify(j.accepted ? j.proposed : j.current)} (replay MRR ${j.currentScore.toFixed(3)} → ${j.proposedScore.toFixed(3)})`);
    }
  });
  const mine = perIssue.filter((p) => p.repo === repo);
  const acc = (arm: Arm, k: number, xs = mine) => xs.filter((p) => p.rank[arm] !== null && p.rank[arm]! <= k).length / xs.length;
  const second = mine.slice(Math.floor(mine.length / 2));
  summary.push({ repo, issues: mine.length, files: byPath.size, arms: Object.fromEntries(ARMS.map((a) => [a, { acc1: acc(a, 1), acc3: acc(a, 3), acc5: acc(a, 5), laterHalfAcc5: acc(a, 5, second) }])), sleep: sleepLog, weights: memory.weights });
  for (const l of sleepLog) console.error('  sleep', l);
}

const pct = (x: number) => (100 * x).toFixed(1).padStart(5);
const acc = (arm: Arm, k: number, xs = perIssue) => xs.filter((p) => p.rank[arm] !== null && p.rank[arm]! <= k).length / Math.max(1, xs.length);
console.log(`SWE-bench Lite file localization · ${perIssue.length} real issues · ${argRepos.join(', ')}`);
console.log('arm'.padEnd(20), 'Acc@1  Acc@3  Acc@5');
for (const a of ARMS) console.log(a.padEnd(20), pct(acc(a, 1)), pct(acc(a, 3)), pct(acc(a, 5)));
for (const s of summary) console.log(' ', s.repo.padEnd(28), ARMS.map((a) => `${a} ${pct(s.arms[a].acc5)}`).join(' · '));
const flips = perIssue.filter((p) => (p.rank.before ?? 99) > 5 && (p.rank.retrieval ?? 99) <= 5);
const losses = perIssue.filter((p) => (p.rank.before ?? 99) <= 5 && (p.rank.retrieval ?? 99) > 5);
console.log(`retrieval now vs before: ${flips.length} issues newly found in top 5, ${losses.length} lost`);
if (process.argv.includes('--write')) {
  const out = resolve(import.meta.dirname, '../../eval/github-issues');
  mkdirSync(out, { recursive: true });
  writeFileSync(out + '/results.json', JSON.stringify({ benchmark: 'SWE-bench Lite, file localization', repos: argRepos, summary, issues: perIssue }, null, 2) + '\n');
}
