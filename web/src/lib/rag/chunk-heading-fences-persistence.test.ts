import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestText } from './ingest.server.ts';
import { loadSearchableChunks } from './store.server.ts';

it('stores real policy heading metadata rather than a fenced example heading', async () => {
  const body = ['# Deployment', '', '## Approval', '', 'Supervisor approval is required.', '', '```markdown', '# Example only', '## Automatic restart', 'Fake example paragraph. '.repeat(180), '```', '', 'Real approval policy continues. '.repeat(180)].join('\n');
  const doc = await ingestText({ title: 'Policy', body, sourceType: 'markdown', sourceUri: 'probe://fence-headings' });
  const rows = (await loadSearchableChunks({ kind: 'all' })).filter(row => row.chunk.document_id === doc.id);
  const tail = rows.filter(row => row.chunk.text.includes('Real approval policy continues'));
  assert.ok(tail.length > 1);
  assert.ok(tail.every(row => row.chunk.heading === 'Deployment > Approval'), JSON.stringify(tail.map(row => row.chunk.heading)));
  assert.ok(rows.some(row => row.chunk.text.includes('# Example only')));
});
