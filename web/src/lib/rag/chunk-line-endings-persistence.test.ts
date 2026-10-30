import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { it } from 'node:test';
import assert from 'node:assert/strict';

it('stores equivalent code chunks for CR-only and LF imported documents', async (t) => {
  const env = process.env;
  process.env = { PATH: env.PATH, HOME: env.HOME };
  t.after(() => { process.env = env; });
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider request'); });
  const { ingestText } = await import('./ingest.server.ts');
  const { loadSearchableChunks } = await import('./store.server.ts');
  const body = ['import os', '', 'def restart_service():', '    return "supervisor approval required"', '', 'def retry_limit():', '    return 4'].join('\n');
  const lf = await ingestText({ title: 'LF Python', body, sourceType: 'github', sourceUri: 'probe://line-endings/lf', chunkKind: 'code', language: 'python' });
  const cr = await ingestText({ title: 'CR Python', body: body.replace(/\n/g, '\r'), sourceType: 'github', sourceUri: 'probe://line-endings/cr', chunkKind: 'code', language: 'python' });
  const rows = await loadSearchableChunks({ kind: 'all' });
  const chunks = (id: string) => rows.filter(row => row.chunk.document_id === id).map(({ chunk }) => ({ text: chunk.text, symbol: chunk.symbol, heading: chunk.heading, ordinal: chunk.ordinal, tokenCount: chunk.token_count })).sort((a, b) => a.ordinal - b.ordinal);
  assert.deepEqual(chunks(lf.id).map(chunk => chunk.symbol), ['restart_service', 'retry_limit']);
  assert.deepEqual(chunks(cr.id), chunks(lf.id));
  assert.equal(network.mock.callCount(), 0);
});
