import { it } from 'node:test';
import assert from 'node:assert/strict';
import { bestPassage, buildIdf, MIN_PASSAGE_TOKENS } from './ranking.ts';
import type { RetrievedChunk } from './types.ts';

const chunk = (text: string, tokenCount: number): RetrievedChunk => ({
  chunkId: 'readme:1', documentId: 'readme', slug: 'readme', title: 'README', text,
  heading: null, score: 0.4, rank: 3, retriever: 'keyword', tokenCount, indexedAt: null,
  embeddingModel: null, filepath: 'readme.md', language: null, symbol: null, chunkKind: 'prose', corpusId: 'c',
});
const paras = [
  'Install the package with npm and import the default export.',
  'Unrelated history of the project and its maintainers over the years.',
  'Set autoStart to false to enqueue work without starting it, then call start to release it.',
  'Starting respects the concurrency limit, so at most that many tasks run at once.',
  'A long changelog paragraph that mentions nothing the question asks about at all.',
];
const text = paras.join('\n\n');
const idf = buildIdf(paras);
const q = 'How can we enqueue a batch without starting it immediately, then release it within a concurrency limit?';

it('packs the most relevant contiguous paragraphs that fit, verbatim', () => {
  const c = chunk(text, 400);
  const p = bestPassage(c, q, idf, 200);
  assert.ok(p);
  assert.equal(p.chunkId, 'readme:1');
  assert.ok(p.tokenCount <= 200);
  assert.ok(p.text.includes('autoStart to false'));
  assert.ok(p.text.includes('concurrency limit'));
  assert.ok(!p.text.includes('changelog'));
  assert.ok(c.text.includes(p.text), 'a verbatim slice of the chunk');
});

it('returns nothing when the room is too small or nothing matches', () => {
  assert.equal(bestPassage(chunk(text, 400), q, idf, MIN_PASSAGE_TOKENS - 1), null);
  assert.equal(bestPassage(chunk(text, 400), 'kubernetes ingress annotations', idf, 300), null);
  assert.equal(bestPassage(chunk('One single paragraph only.', 200), q, idf, 150), null);
});
