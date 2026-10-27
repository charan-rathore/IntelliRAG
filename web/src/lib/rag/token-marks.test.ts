import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from './text.ts';
import { BM25Index } from './bm25.ts';

describe('combining marks inside words', () => {
  it('retains Indic vowel signs and viramas instead of collapsing distinct words', () => {
    for (const word of ['कला', 'किला', 'किताब', 'हिन्दी', 'தமிழ்', 'తెలుగు', 'বাংলা']) {
      assert.deepEqual(tokenize(word), [word.normalize('NFC')], word);
    }
    assert.notDeepEqual(tokenize('कला'), tokenize('किला'));
  });

  it('keeps non-composing Latin and Arabic marks attached to their base letters', () => {
    for (const word of ['q\u0307', 'عَرَبِيّ']) {
      assert.deepEqual(tokenize(word), [word.normalize('NFC')], word);
    }
  });

  it('does not create words from orphan marks or join across punctuation', () => {
    assert.deepEqual(tokenize('\u0301\u093f'), []);
    assert.deepEqual(tokenize('कला,किला 42.7 redis-cache'), ['कला', 'किला', '42', '7', 'redis', 'cache']);
    assert.deepEqual(tokenize('München café'.normalize('NFD')), ['münchen', 'café']);
  });

  it('retrieves the requested Hindi word rather than a different word sharing consonants', () => {
    const index = new BM25Index([
      { id: 'art', text: 'कला' },
      { id: 'fort', text: 'किला' },
      { id: 'book', text: 'किताब' },
    ]);
    const hits = index.search('किला', 3);
    assert.equal(hits[0]?.id, 'fort', JSON.stringify(hits));
    assert.deepEqual(hits.map(hit => hit.id), ['fort']);
  });
});
