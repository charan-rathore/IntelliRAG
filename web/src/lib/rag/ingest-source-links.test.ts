import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestFromUrl } from './ingest.server.ts';
import { getDocumentBySlug } from './store.server.ts';
import { parseGithubUrl } from './github.ts';

it('stores navigable GitHub source links for repository paths with URL syntax characters', async (t) => {
  const paths = ['docs/hash#part.md', 'docs/literal%20 space.md', 'docs/query?part.md', 'docs/évidence.md'];
  const originalEnv = process.env;
  process.env = { PATH: originalEnv.PATH, HOME: originalEnv.HOME };
  t.after(() => { process.env = originalEnv; });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.github.com') return Response.json({ sha: 'source-link-sha', tree: paths.map(path => ({ path, type: 'blob', size: 100 })) });
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    return new Response('Source link integrity preserves the exact imported repository file path and evidence provenance.');
  });
  const result = await ingestFromUrl('https://github.com/probe/source-links/tree/main');
  assert.equal(result.ingested, paths.length);
  for (const slug of result.titles) {
    const doc = await getDocumentBySlug(slug);
    assert.ok(doc?.source_uri);
    const url = new URL(doc.source_uri);
    assert.equal(url.hash, '', doc.source_uri);
    assert.equal(url.search, '', doc.source_uri);
    const parsed = parseGithubUrl(doc.source_uri);
    assert.equal(parsed?.kind, 'blob');
    if (parsed?.kind === 'blob') assert.equal(parsed.path, doc.title, doc.source_uri);
  }
});
