import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, fetchRemoteDocument, isPrivateIp } from './ingest.server.ts';

describe('IPv4-mapped IPv6 import guards', () => {
  it('classifies hexadecimal, expanded and dotted mapped forms identically', () => {
    for (const [dotted, hex, expanded] of [
      ['127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1'],
      ['10.0.0.1', '::ffff:a00:1', '0000:0000:0000:0000:0000:ffff:0a00:0001'],
      ['169.254.169.254', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:a9fe:a9fe'],
      ['192.168.1.1', '::ffff:c0a8:101', '0:0:0:0:0:ffff:c0a8:101'],
      ['8.8.8.8', '::ffff:808:808', '0:0:0:0:0:ffff:808:808'],
    ]) {
      const expected = isPrivateIp(dotted!);
      for (const form of [`::ffff:${dotted}`, hex!, expanded!]) {
        assert.equal(isPrivateIp(form), expected, form);
        assert.equal(isPrivateIp(new URL(`http://[${form}]/`).hostname), expected, `URL ${form}`);
      }
    }
  });

  it('matches IPv4 classification for seeded mapped-address samples', () => {
    let state = 319827;
    for (let i = 0; i < 2048; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const high = state >>> 16;
      const low = state & 65535;
      const dotted = `${state >>> 24}.${(state >>> 16) & 255}.${(state >>> 8) & 255}.${state & 255}`;
      assert.equal(isPrivateIp(`::ffff:${high.toString(16)}:${low.toString(16)}`), isPrivateIp(dotted), dotted);
    }
  });

  it('rejects mapped private URL literals before any fetch', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('Should not reach network'));
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe']) {
      await assert.rejects(assertPublicUrl(`http://[${ip}]/`), /private or local/);
      await assert.rejects(fetchRemoteDocument(`http://[${ip}]/`), /private or local/);
    }
    assert.equal(fetch.mock.callCount(), 0);
  });

  it('rejects a mapped-private redirect before a second request', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'http://[::ffff:127.0.0.1]/internal' } }));
    await assert.rejects(fetchRemoteDocument('https://1.1.1.1/start'), /private or local/);
    assert.equal(fetch.mock.callCount(), 1);
  });

  it('still accepts mapped public addresses without a network request', async () => {
    assert.equal((await assertPublicUrl('https://[::ffff:8.8.8.8]/guide')).hostname, '[::ffff:808:808]');
    assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
  });
});
