import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { it } from 'node:test';
import assert from 'node:assert/strict';

it('retains Indic word identity through real ingest, storage and keyword retrieval', async (t) => {
  const env = process.env;
  process.env = { PATH: env.PATH, HOME: env.HOME };
  t.after(() => { process.env = env; });
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request in local lexical regression');
  });
  const { ingestText } = await import('./ingest.server.ts');
  const { loadSearchableChunks } = await import('./store.server.ts');
  const { retrieve } = await import('./retrieve.server.ts');
  const docs = [
    ['Art reference', 'कला'],
    ['Fort reference', 'किला'],
    ['Book reference', 'किताब'],
  ];
  const ids = new Set<string>();
  let expectedSlug = '';
  for (const [title, word] of docs) {
    const result = await ingestText({ title: title!, body: `${word} ${word} ${word}\n\nThis reference preserves its original document text for lexical search.`, sourceType: 'markdown', sourceUri: `probe://indic-word-identity/${encodeURIComponent(title!)}` });
    ids.add(result.id);
    if (word === 'किला') expectedSlug = result.slug;
  }
  const rows = (await loadSearchableChunks({ kind: 'all' })).filter(row => ids.has(row.chunk.document_id));
  assert.equal(rows.length, 3);
  for (const [, word] of docs) assert.ok(rows.some(row => row.chunk.text.includes(word!)), word);
  const result = await retrieve({ query: 'किला', queryVector: null, mode: 'keyword', topK: 3, embeddingModel: null, corpus: 'all' });
  assert.equal(result.stages.keyword[0]?.slug, expectedSlug, JSON.stringify(result.stages.keyword));
  assert.equal(result.chunks[0]?.slug, expectedSlug, JSON.stringify(result.chunks));
  assert.equal(network.mock.callCount(), 0);
});
