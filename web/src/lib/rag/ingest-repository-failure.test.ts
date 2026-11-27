import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestFromUrl } from './ingest.server.ts';

it('reports a failed repository import when every file fails to download', async (t) => {
  const commit = 'a'.repeat(40);
  const treeSha = 'b'.repeat(40);
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/probe/failed-import/commits/main') {
      return Response.json({ sha: commit, commit: { tree: { sha: treeSha } } });
    }
    if (url.pathname === `/repos/probe/failed-import/git/trees/${treeSha}`) {
      return Response.json({
        sha: treeSha,
        tree: [{ path: 'README.md', type: 'blob', size: 100 }],
      });
    }
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    return new Response('Unavailable', { status: 503 });
  });

  await assert.rejects(
    ingestFromUrl('https://github.com/probe/failed-import/tree/main'),
    (error: Error) => {
      assert.match(error.message, /No files were imported/);
      assert.match(String(error.cause), /Fetch failed \(503\)/);
      return true;
    },
  );
});
