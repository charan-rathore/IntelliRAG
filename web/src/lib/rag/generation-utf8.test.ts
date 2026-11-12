import { it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationError, readGenerationStream } from './generation-result.ts';

it('rejects malformed UTF-8 in provider answer text before emitting a corrupt token', async () => {
  for (const bad of [[0x80], [0xc3, 0x28], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
    const prefix = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"');
    const suffix = new TextEncoder().encode('"},"finish_reason":"stop"}]}\n\n');
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(prefix); c.enqueue(new Uint8Array(bad)); c.enqueue(suffix); c.close(); } });
    const emitted: string[] = [];
    await assert.rejects(readGenerationStream(body, 'openai', token => emitted.push(token)), error => error instanceof GenerationError && error.reason === 'invalid_response');
    assert.deepEqual(emitted, []);
  }
});

it('rejects truncated trailing UTF-8 even after a valid stop and preserves reported usage', async () => {
  const wire = 'data: {"usage":{"total_tokens":9}}\n\ndata: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n';
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(wire)); c.enqueue(new Uint8Array([0xe2, 0x82])); c.close(); } });
  await assert.rejects(readGenerationStream(body, 'openai', () => {}), error => error instanceof GenerationError && error.reason === 'invalid_response' && error.usage?.total_tokens === 9);
});

it('allows a legitimately encoded replacement character and split valid Unicode', async () => {
  const wire = 'data: {"choices":[{"delta":{"content":"किला 😀 �"},"finish_reason":"stop"}]}\n\n';
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of new TextEncoder().encode(wire)) c.enqueue(new Uint8Array([byte])); c.close(); } });
  assert.equal(await readGenerationStream(body, 'openai', () => {}), 'किला 😀 �');
});
