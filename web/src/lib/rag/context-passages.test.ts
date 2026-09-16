import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdf, selectContext, type RerankSignals } from './ranking.ts';
import type { RetrievedChunk } from './types.ts';

const passage = (id: string, text: string, score: number): RetrievedChunk => ({
  chunkId: id, documentId: 'guide', slug: 'guide', title: 'Service operations', text,
  heading: id, score, rank: 1, retriever: 'keyword', tokenCount: 70, indexedAt: null,
  embeddingModel: null, filepath: 'readme.md', language: null, symbol: null, chunkKind: 'prose', corpusId: 'seed-lab',
});
it('keeps complementary sections from one README and removes repeated passages within the budget', () => {
  const rows = [passage('drain', 'Restart safely: stop accepting requests and drain in-flight work.', .8),
    passage('resume', 'Restart safely: reload configuration, check readiness, then accept new requests.', .76),
    passage('copy', 'Restart safely: stop accepting requests and drain in-flight work.', .75)];
  const signal: RerankSignals = { idfRecall: .8, titleRecall: .4, phrase: .2, topical: .6, dense: null, bm25: 5 };
  const signals = new Map(rows.map(r => [r.chunkId, signal]));
  const opts = { query: 'How should we restart safely?', idf: buildIdf(rows.map(r => r.text)), maxTokens: 140, topK: 3 };
  const result = selectContext(rows, signals, opts);
  assert.deepEqual(result.packed.map(r => r.chunkId), ['drain', 'resume']);
  assert.ok(result.packed.reduce((sum, r) => sum + r.tokenCount, 0) <= 140);
  assert.match(result.dropReasons.get('copy')!, /Duplicate passage/);
});
