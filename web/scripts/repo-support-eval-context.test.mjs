import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratorContext } from './repo-support-eval-context.mjs';

const chunks = new Map([
  ['a', { title: 'Doc A', text: 'full chunk A text with extra tail the model never sees' }],
  ['b', { title: 'Doc B', text: 'full chunk B text' }],
]);
const chunkById = (id) => chunks.get(id);

test('intellirag arm judges the trimmed passage the generator saw, not the full chunk', () => {
  const packedText = new Map([['a', 'trimmed passage from A'], ['b', 'full chunk B text']]);
  const { context, seenTexts } = buildGeneratorContext({
    arm: 'intellirag', selectedIds: ['a', 'b'], packedText, chunkById, source: 'SOURCE',
  });
  // Regression for the stored-contexts defect: seenTexts (stored for judging)
  // must equal the texts embedded in the generator prompt, and for the
  // trimmed arm those are the packed passages, never the untrimmed chunks.
  assert.deepEqual(seenTexts, ['trimmed passage from A', 'full chunk B text']);
  assert.equal(context, '[Source 1] Doc A\ntrimmed passage from A\n\n[Source 2] Doc B\nfull chunk B text');
  assert.ok(!context.includes('extra tail'), 'generator must not see the untrimmed tail');
});

test('bm25 and oracle arms judge the full chunk text the generator saw', () => {
  for (const arm of ['bm25', 'oracle']) {
    const { context, seenTexts } = buildGeneratorContext({
      arm, selectedIds: ['a'], packedText: new Map([['a', 'unused trimmed']]), chunkById, source: 'SOURCE',
    });
    assert.deepEqual(seenTexts, [chunks.get('a').text], arm);
    assert.equal(context, `[Source 1] Doc A\n${chunks.get('a').text}`, arm);
  }
});

test('no-context and full-context arms keep their fixed context shapes', () => {
  const none = buildGeneratorContext({ arm: 'no-context', selectedIds: [], packedText: new Map(), chunkById, source: 'SOURCE' });
  assert.deepEqual(none, { context: '', seenTexts: [] });
  const full = buildGeneratorContext({ arm: 'full-context', selectedIds: [], packedText: new Map(), chunkById, source: 'SOURCE' });
  assert.equal(full.context, '[Source 1] p-queue README\nSOURCE');
  assert.deepEqual(full.seenTexts, ['SOURCE']);
});
