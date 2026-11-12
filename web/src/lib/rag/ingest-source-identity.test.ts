import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { upsertDocument, getDocumentBySlug } from './store.server.ts';
import * as memory from './memory.server.ts';

for (const [name, store] of [['durable', { upsertDocument, getDocumentBySlug }], ['memory', memory]] as const) {
  it(`${name}: distinct source URIs with colliding slugs remain distinct inside one corpus`, async (t) => {
    // Isolate memory state and its best-effort sidecar from other tests/runs.
    const globals = globalThis as typeof globalThis & { __intelliragMemory?: unknown };
    const previous = globals.__intelliragMemory;
    globals.__intelliragMemory = { documents: [], chunks: [], traces: [] };
    const write = fs.writeFileSync;
    const spy = t.mock.method(fs, 'writeFileSync', ((path, ...args) => {
      if (String(path) === '/tmp/intellirag-memory.json') return;
      return write(path, ...args);
    }) as typeof fs.writeFileSync);
    syncBuiltinESMExports();
    t.after(() => { globals.__intelliragMemory = previous; spy.mock.restore(); syncBuiltinESMExports(); });
    const common = { title: 'Release notes', sourceType: 'github' as const, slugHint: `source-collision-${name}`, originRepo: `probe/source-collision-${name}`, originRef: 'main@snapshot' };
    const a = await store.upsertDocument({ ...common, body: 'Alpha policy requires supervisor approval before restarting the service.', sourceUri: `probe://${name}/docs/a-b.md` });
    const b = await store.upsertDocument({ ...common, body: 'Beta policy prohibits automatic restart and requires a manual review.', sourceUri: `probe://${name}/docs/a_b.md` });
    assert.notEqual(a.id, b.id, 'slug normalization must not overwrite another source');
    assert.notEqual(a.slug, b.slug);
    assert.equal(a.corpusId, b.corpusId);
    assert.ok((await store.getDocumentBySlug(a.slug))?.body.startsWith('Alpha policy'));
    const again = await store.upsertDocument({ ...common, body: 'Beta policy revised: a supervisor must confirm each manual restart.', sourceUri: `probe://${name}/docs/a_b.md` });
    assert.equal(again.id, b.id);
    assert.equal(again.version, 2);
    assert.ok((await store.getDocumentBySlug(a.slug))?.body.startsWith('Alpha policy'));
    const unchanged = await store.upsertDocument({ ...common, body: 'Beta policy revised: a supervisor must confirm each manual restart.', sourceUri: `probe://${name}/docs/a_b.md` });
    assert.equal(unchanged.id, b.id);
    assert.equal(unchanged.skipped, true);
    const inline = { ...common, slugHint: `inline-identity-${name}`, body: 'URI-less inline documents retain their existing corpus-scoped update behavior.' };
    const firstInline = await store.upsertDocument(inline);
    const againInline = await store.upsertDocument({ ...inline, body: inline.body + ' A revised sentence.' });
    assert.equal(firstInline.id, againInline.id);
    assert.equal(againInline.version, 2);
  });
}
