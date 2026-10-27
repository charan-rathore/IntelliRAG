import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRemoteDocument, ingestFromUrl } from './ingest.server.ts';
import { loadSearchableChunks } from './store.server.ts';

function response(parts: Uint8Array[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); },
  }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

describe('remote UTF-8 integrity', () => {
  it('rejects malformed and incomplete UTF-8 rather than inserting replacement characters', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch');
    for (const bytes of [
      [0xc3, 0x28], [0xe2, 0x82], [0x80], [0xc0, 0xaf],
      [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
    ]) {
      fetch.mock.mockImplementation(async () => response([new TextEncoder().encode('Remote document data. '.repeat(4)), new Uint8Array(bytes)]));
      await assert.rejects(fetchRemoteDocument('https://1.1.1.1/invalid.txt'), /UTF-8/i, JSON.stringify(bytes));
    }
  });

  it('preserves valid multibyte text at every possible stream split', async (t) => {
    const text = 'München தமிழ் తెలుగు किला 😀 and a literal replacement character � remain valid source text.';
    const bytes = new TextEncoder().encode(text);
    const fetch = t.mock.method(globalThis, 'fetch');
    for (let split = 1; split < bytes.length; split++) {
      fetch.mock.mockImplementation(async () => response([bytes.slice(0, split), bytes.slice(split)]));
      assert.equal((await fetchRemoteDocument('https://1.1.1.1/valid.txt')).body, text);
    }
  });

  it('cancels an unfinished stream after a decoding error', async (t) => {
    let cancelled = false;
    let pulls = 0;
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array([0x80])); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 })));
    await assert.rejects(fetchRemoteDocument('https://1.1.1.1/bad-stream.txt'), /UTF-8/i);
    assert.equal(cancelled, true);
    assert.equal(pulls, 1);
  });

  it('preserves a transport failure rather than calling it an encoding failure', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('transport sentinel')); },
    })));
    await assert.rejects(fetchRemoteDocument('https://1.1.1.1/broken-stream.txt'), /transport sentinel/);
  });

  it('does not store a corrupted remote document' , async (t) => {
    const before = await loadSearchableChunks({ kind: 'all' });
    t.mock.method(globalThis, 'fetch', async () => response([new TextEncoder().encode('Corrupt remote source. '.repeat(4)), new Uint8Array([0xe2, 0x82])]));
    await assert.rejects(ingestFromUrl('https://1.1.1.1/malformed-utf8'), /UTF-8/i);
    const after = await loadSearchableChunks({ kind: 'all' });
    assert.deepEqual(after.map(row => row.chunk.id).sort(), before.map(row => row.chunk.id).sort());
  });
});
