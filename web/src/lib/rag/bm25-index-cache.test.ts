import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index } from './bm25.ts';
import { retrieveFromRows, retrieveIndexStats, type SearchRow } from './retrieve-core.ts';

// Reference implementation: the previous per-query recount, kept here so the
// inverted index is proven score-identical, not just "close".
import { contentTokens } from './text.ts';
function referenceScores(texts: string[], query: string) {
  const docs = texts.map((t) => contentTokens(t)).filter((d) => d.length);
  const n = docs.length;
  const avg = docs.reduce((a, d) => a + d.length, 0) / n;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = contentTokens(query);
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      const dfi = df.get(term);
      if (!f || !dfi) continue;
      s += Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5)) * ((f * 2.5) / (f + 1.5 * (0.25 + (0.75 * d.length) / avg)));
    }
    return s;
  });
}

const words = 'fee retainer deadline report weekly approval finance region scope proposal revision client pilot launch invoice'.split(' ');
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const texts = Array.from({ length: 300 }, (_, i) =>
  Array.from({ length: 40 }, () => words[Math.floor(rand() * words.length)] + (rand() < 0.1 ? String(i) : '')).join(' '),
);

describe('BM25 inverted index', () => {
  it('scores exactly like the per-query recount, same order and ties', () => {
    const idx = new BM25Index(texts.map((text, i) => ({ id: 'c' + i, text })));
    for (const query of ['fee deadline', 'weekly report 17', 'finance approval revision', 'nothing matches here']) {
      const ref = referenceScores(texts, query)
        .map((score, i) => ({ id: 'c' + i, score }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      const got = idx.search(query, 10).map(({ id, score }) => ({ id, score }));
      assert.equal(got.length, ref.length, query);
      got.forEach((g, i) => {
        assert.equal(g.id, ref[i]!.id, `${query} rank ${i}`);
        assert.ok(Math.abs(g.score - ref[i]!.score) < 1e-9, `${query} score ${i}`);
      });
    }
  });
});

describe('retrieval index cache', () => {
  const row = (i: number, text: string, corpusId = 'c1'): SearchRow =>
    ({
      title: `doc ${i}`,
      slug: `doc-${i}`,
      indexedAt: null,
      corpusId,
      chunk: { id: `ch${i}`, document_id: `d${i}`, ordinal: 0, text, token_count: 10, heading: null, embedding: null, embedding_model: null, content_hash: `h${i}`, created_at: '', filepath: null, language: null, symbol: null, chunk_kind: 'prose', corpus_id: corpusId },
    }) as SearchRow;
  const run = (rows: SearchRow[], query: string, corpusId = 'c1') =>
    retrieveFromRows({ query, queryVector: null, mode: 'keyword', topK: 3, embeddingModel: null, rows, storage: { backend: 'ephemeral', durable: false, denseAvailable: false, warning: null }, corpusScope: { kind: 'corpus', corpusId } });

  it('builds the index once per rows array and scope', () => {
    const rows = texts.slice(0, 50).map((t, i) => row(i, t));
    const before = retrieveIndexStats().builds;
    for (let i = 0; i < 20; i++) run(rows, `fee ${i}`);
    assert.equal(retrieveIndexStats().builds - before, 1);
  });

  it('never serves a stale index after in-place mutation or for another scope', () => {
    const rows = [row(1, 'the fee is due on friday'), row(2, 'weekly reporting cadence')];
    assert.equal(run(rows, 'invoice')?.chunks.length ?? 0, 0);
    rows.push(row(3, 'the invoice was sent'));
    assert.ok(run(rows, 'invoice').chunks.some((c) => c.chunkId === 'ch3'), 'mutated rows rebuild the index');
    const other = [row(4, 'invoice for corpus two', 'c2')];
    const mixed = [...rows, ...other];
    assert.ok(run(mixed, 'invoice', 'c2').chunks.every((c) => c.chunkId === 'ch4'), 'scope-specific index');
  });
});
