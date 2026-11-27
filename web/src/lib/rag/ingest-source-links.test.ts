import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestFromUrl } from './ingest.server.ts';
import { getDocumentBySlug } from './store.server.ts';
import { parseGithubUrl } from './github.ts';

it('stores navigable GitHub source links for repository paths with URL syntax characters', async (t) => {
  const paths = ['docs/hash#part.md', 'docs/literal%20 space.md', 'docs/query?part.md', 'docs/évidence.md'];
  const commit = 'a'.repeat(40);
  const treeSha = 'b'.repeat(40);
  const originalEnv = process.env;
  process.env = { PATH: originalEnv.PATH, HOME: originalEnv.HOME };
  t.after(() => { process.env = originalEnv; });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/probe/source-links/commits/main') return Response.json({ sha: commit, commit: { tree: { sha: treeSha } } });
    if (url.pathname === `/repos/probe/source-links/git/trees/${treeSha}`) return Response.json({ sha: treeSha, tree: paths.map(path => ({ path, type: 'blob', size: 100 })) });
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    assert.ok(url.pathname.startsWith(`/probe/source-links/${commit}/`));
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
    if (parsed?.kind === 'blob') {
      assert.equal(parsed.path, doc.title, doc.source_uri);
      assert.equal(parsed.ref, commit);
    }
  }
});

it('keeps single-file imports and their citations tied to the imported commits', async (t) => {
  const firstCommit = 'c'.repeat(40);
  const secondCommit = 'd'.repeat(40);
  const treeSha = 'e'.repeat(40);
  const source = 'https://github.com/probe/file-revisions/blob/main/guide.md#L1';
  let currentCommit = firstCommit;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.github.com') {
      assert.equal(url.pathname, '/repos/probe/file-revisions/commits/main');
      return Response.json({ sha: currentCommit, commit: { tree: { sha: treeSha } } });
    }
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    assert.equal(url.pathname, `/probe/file-revisions/${currentCommit}/guide.md`);
    return new Response(`This guide contains repository evidence for commit ${currentCommit}.`);
  });

  const first = await ingestFromUrl(source);
  currentCommit = secondCommit;
  const second = await ingestFromUrl(source);
  const duplicate = await ingestFromUrl(
    `https://github.com/probe/file-revisions/blob/${secondCommit}/guide.md`,
  );

  assert.notEqual(first.corpusId, second.corpusId);
  assert.deepEqual(duplicate.titles, second.titles);
  assert.equal(duplicate.corpusId, second.corpusId);
  assert.equal(duplicate.skipped, 1);
  for (const [result, sha] of [[first, firstCommit], [second, secondCommit]] as const) {
    const doc = await getDocumentBySlug(result.titles[0]!);
    assert.equal(doc?.source_uri, `https://github.com/probe/file-revisions/blob/${sha}/guide.md`);
    assert.ok(doc?.body.includes(sha));
  }
});
