import { it } from 'node:test';
import assert from 'node:assert/strict';
import { bestPassage, buildIdf, MIN_PASSAGE_TOKENS } from './ranking.ts';
import { estimateTokens } from './text.ts';
import { chunkDocument } from './chunking.ts';
import { CONTEXT_TOKEN_BUDGET } from './types.ts';
import type { RetrievedChunk } from './types.ts';

const chunk = (text: string, tokenCount: number): RetrievedChunk => ({
  chunkId: 'readme:1', documentId: 'readme', slug: 'readme', title: 'README', text,
  heading: null, score: 0.4, rank: 3, retriever: 'keyword', tokenCount, indexedAt: null,
  embeddingModel: null, filepath: 'readme.md', language: null, symbol: null, chunkKind: 'prose', corpusId: 'c',
});
// Relevant paragraphs are long enough that a two-paragraph passage clears
// the MIN_PASSAGE_TOKENS floor (120) while fitting the 200-token room.
const rel1 = 'Set autoStart to false to enqueue work without starting it, then call start to release it. ' + 'enqueue details. '.repeat(12);
const rel2 = 'Starting respects the concurrency limit, so at most that many tasks run at once. ' + 'limit details. '.repeat(12);
const paras = [
  'Install the package with npm and import the default export.',
  'Unrelated history of the project and its maintainers over the years.',
  rel1,
  rel2,
  'A long changelog paragraph that mentions nothing the question asks about at all.',
];
const text = paras.join('\n\n');
const idf = buildIdf(paras);
const q = 'How can we enqueue a batch without starting it immediately, then release it within a concurrency limit?';

it('packs the most relevant contiguous paragraphs that fit, verbatim', () => {
  const c = chunk(text, estimateTokens(text));
  // Room fits the relevant pair (~142 tokens) but not a further paragraph,
  // so the window stops at the pair instead of absorbing unrelated text.
  const p = bestPassage(c, q, idf, 150);
  assert.ok(p);
  assert.equal(p.chunkId, 'readme:1');
  assert.ok(p.tokenCount <= 150);
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

it('stays an exact slice when paragraphs are separated by extra blank or whitespace-only lines', () => {
  for (const sep of ['\n\n\n', '\n  \n', '\n\t\n\n']) {
    const t = paras.map((p) => p + ' filler'.repeat(30)).join(sep);
    const c = chunk(t, estimateTokens(t));
    const p = bestPassage(c, q, idf, 200);
    assert.ok(p, JSON.stringify(sep));
    assert.ok(c.text.includes(p.text), `verbatim with ${JSON.stringify(sep)}`);
    assert.equal(p.tokenCount, estimateTokens(p.text));
    assert.ok(p.tokenCount <= 200);
  }
});

it('no chunk the chunker makes exceeds the context budget on its own', () => {
  const huge = [
    'export function big() {\n' + Array.from({ length: 900 }, (_, i) => `  const v${i} = f(${i});`).join('\n') + '\n}\n',
    'word '.repeat(9000),
    'x'.repeat(20000),
  ];
  for (const [i, body] of huge.entries())
    for (const c of chunkDocument(body, { filepath: i === 0 ? 'src/big.ts' : 'notes.md' }))
      assert.ok(c.tokenCount <= CONTEXT_TOKEN_BUDGET, `chunk of ${c.tokenCount}`);
});

it('rejects a selected passage under the floor even when the room is large', () => {
  // One short matching paragraph (~30 tokens) inside a big chunk, room 500:
  // the floor is on the selected passage, not on the room, so no packing.
  const body = [
    'word '.repeat(800),
    'Set autoStart to false to enqueue without starting.',
    'filler '.repeat(600),
  ].join('\n\n');
  const c = chunk(body, estimateTokens(body));
  const smallIdf = buildIdf(body.split('\n\n'));
  assert.equal(bestPassage(c, q, smallIdf, 500), null);
});
