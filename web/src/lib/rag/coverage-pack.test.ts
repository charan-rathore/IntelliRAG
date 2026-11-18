import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coverageTerms, packByCoverage, paragraphUnits } from './coverage-pack.ts';
import { buildIdf, selectContextCoverage } from './ranking.ts';
import { estimateTokens } from './text.ts';
import type { RetrievedChunk } from './types.ts';
import { absentSubject } from "./coverage-pack.ts";
import { chunkDocument } from "./chunking.ts";
import { retrieveFromRows, type SearchRow } from "./retrieve-core.ts";

const mk = (id: string, text: string, score: number, rank: number): RetrievedChunk => ({
  chunkId: id, documentId: 'doc', slug: 'doc', title: 'README', text, heading: null, score, rank,
  retriever: 'keyword', tokenCount: estimateTokens(text), indexedAt: null, embeddingModel: null,
  filepath: 'readme.md', language: null, symbol: null, chunkKind: 'prose', corpusId: 'c',
});

const filler = (word: string, n: number) => `${word} `.repeat(n).trim() + '.';
const a = mk('doc:0', [
  'Use concurrency to limit simultaneous tasks.',
  filler('history', 120),
  'Set autoStart to false to enqueue without starting.',
].join('\n\n'), 0.6, 1);
const b = mk('doc:1', [
  filler('unrelated', 60),
  'For servers you probably want a Redis backed shared limiter across processes.',
].join('\n\n'), 0.2, 2);
const idf = buildIdf([a, b].map((c) => c.text));

it('keeps every packed passage a verbatim contiguous slice of its source', () => {
  const { packed } = packByCoverage({ pool: [a, b], primary: new Set(['doc:0', 'doc:1']), terms: coverageTerms('concurrency autoStart redis servers'), idf, budget: 400 });
  for (const p of packed) {
    const src = [a, b].find((c) => c.chunkId === p.chunkId)!;
    assert.ok(src.text.includes(p.text), `${p.chunkId} passage is not a verbatim slice`);
  }
});

it('never exceeds the token budget', () => {
  for (const budget of [40, 120, 300, 2000]) {
    const { packed, report } = packByCoverage({ pool: [a, b], primary: new Set(['doc:0', 'doc:1']), terms: coverageTerms('concurrency autoStart redis'), idf, budget });
    assert.ok(report.usedTokens <= budget, `used ${report.usedTokens} > ${budget}`);
    assert.ok(packed.reduce((n, c) => n + estimateTokens(c.text), 0) <= budget + packed.length);
  }
});

it('lets a secondary source in only to cover a term nothing else covers', () => {
  const q = coverageTerms('How do we share one limit across server processes with concurrency?');
  const { packed, report } = packByCoverage({ pool: [a, b], primary: new Set(['doc:0']), terms: q, idf, budget: 200 });
  const second = packed.find((c) => c.chunkId === 'doc:1');
  assert.ok(second, 'secondary source with the only "redis/server" passage should be packed');
  assert.match(second!.text, /Redis/);
  assert.doesNotMatch(second!.text, /unrelated/, 'secondary sources earn no relevance credit for filler');
  assert.ok(report.covered.includes('server') || report.covered.includes('serv'));
});

it('reports the question terms the packed context does not contain', () => {
  const { report } = packByCoverage({ pool: [a], primary: new Set(['doc:0']), terms: coverageTerms('concurrency kubernetes'), idf, budget: 400 });
  assert.ok(report.missing.some((t) => t.startsWith('kubernet')));
  assert.ok(report.ratio > 0 && report.ratio < 1);
  assert.ok(report.beta >= 0 && report.beta <= 2);
});

it('packs the anchor chunk whole before selecting by coverage', () => {
  const { packed } = packByCoverage({ pool: [a, b], primary: new Set(['doc:0', 'doc:1']), terms: coverageTerms('redis'), idf, budget: 1400, seed: ['doc:0'] });
  assert.equal(packed.find((c) => c.chunkId === 'doc:0')?.text, a.text);
});

it('never splits a fenced code block or strands a heading', () => {
  const text = '## Options\n\nIntro line.\n\n```js\nconst q = new PQueue();\n\nq.add(fn);\n```\n\nAfter the code.';
  const spans = paragraphUnits(text).map(([s, e]) => text.slice(s, e));
  assert.ok(spans.every((p) => (p.match(/```/g) ?? []).length % 2 === 0), 'a unit has an unbalanced fence');
  assert.ok(!spans.some((p) => /^##\s/.test(p) && !p.includes('\n')), 'a heading was left alone');
});

it('drops function words from the aspects it tries to cover', () => {
  const t = coverageTerms('Can we release it within the limit without starting them across servers?');
  for (const w of ['within', 'without', 'them', 'across']) assert.ok(!t.includes(w), w);
  assert.ok(t.some((x) => x.startsWith('serv')));
});

it('refuses exactly as before when nothing passes the support gate', () => {
  const weak = mk('doc:9', 'Totally unrelated words about gardening and soil.', 0.05, 1);
  const out = selectContextCoverage([weak], new Map([['doc:9', { idfRecall: 0, titleRecall: 0, phrase: 0, topical: 0, dense: null, bm25: 0 }]]), { query: 'How do I configure the redis limiter?', idf });
  assert.equal(out.packed.length, 0);
});

it('treats quantities as parameters, not aspects, and displays the typed word', async () => {
  const { surfaceTerm } = await import('./coverage-pack.ts');
  const t = coverageTerms('Two unfinished jobs and ten retries');
  assert.ok(!t.includes('two') && !t.includes('ten'));
  const stem = t.find((x) => x.startsWith('unfinish'))!;
  assert.equal(surfaceTerm('Two unfinished jobs and ten retries', stem), 'unfinished');
});

describe("absentSubject: names the source never mentions", () => {
  const vocab = new Set(["queue", "redi", "onempty", "timeout", "schedul", "pqueue", "abortsignal", "concurr"]);
  it("finds a named thing the corpus lacks", () => {
    assert.deepEqual(absentSubject("What caused the Kubernetes pod scheduling failures?", vocab), ["Kubernetes"]);
    assert.deepEqual(absentSubject("What is mTLS used for in a service mesh?", vocab), ["mTLS"]);
    assert.deepEqual(absentSubject("Does it run on Node 22?", vocab), ["Node"]);
  });
  it("ignores names the corpus has and plain words it lacks", () => {
    assert.deepEqual(absentSubject("How do you stop a Redis cache stampede?", vocab), []);
    assert.deepEqual(absentSubject("Our onEmpty handler writes a final report while jobs run.", vocab), []);
  });
  it("doesn't read a sentence's first word as a name", () => {
    assert.deepEqual(absentSubject("Separately: Which queue runs first? Then tell me.", vocab), []);
  });
});

describe("retrieval refuses a question about something the source never mentions", () => {
  it("refuses Kubernetes on a queue README even though 'scheduling' matches", () => {
    const body = "# p-queue\n\n## Scheduling failures\n\nScheduling failures are caused when a pod of tasks waits on concurrency. A pod is scheduled when the queue has room, and scheduling failures clear once it drains.\n\n## Errors\n\nUse onError to stop on the first failure.";
    const rows = chunkDocument(body, { filepath: "readme.md" }).map((c) => ({ title: "p-queue README", slug: "p-queue", indexedAt: null, corpusId: "t",
      chunk: { id: `p:${c.ordinal}`, document_id: "p-queue", ordinal: c.ordinal, text: c.text, token_count: c.tokenCount, heading: c.heading, embedding: null, embedding_model: null,
        content_hash: String(c.ordinal), created_at: "", filepath: c.filepath, language: c.language, symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: "t" } })) as SearchRow[];
    const r = retrieveFromRows({ query: "What caused the Kubernetes pod scheduling failures?", queryVector: null, mode: "keyword", topK: 5, embeddingModel: null, rows,
      corpusScope: { kind: "corpus", corpusId: "t" }, storage: { backend: "ephemeral", durable: false, denseAvailable: false, warning: null } as never });
    assert.equal(r.evidence, "insufficient");
    assert.equal(r.chunks.length, 0);
    assert.match(r.evidenceNote, /Kubernetes/);
  });
});
