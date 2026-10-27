import { it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationError, readGenerationStream } from './generation-result.ts';

for (const provider of ['google', 'openai'] as const) {
  it(`${provider} refuses contradictory terminal reasons rather than overwriting a failed stop`, async () => {
    for (const stops of [['length', 'stop'], ['content_filter', 'stop'], ['stop', 'length']]) {
      const frame = (stop: string) => provider === 'google' ? { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: stop.toUpperCase() }] } : { choices: [{ delta: { content: 'partial' }, finish_reason: stop }] };
      const wire = stops.map(stop => `data: ${JSON.stringify(frame(stop))}\n\n`).join('');
      const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(wire)); c.close(); } });
      await assert.rejects(readGenerationStream(body, provider, () => {}), error => error instanceof GenerationError && error.reason === 'invalid_response');
    }
  });
}

it('retains a repeated identical terminal reason and usage-only trailer', async () => {
  const wire = [
    { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] },
    { choices: [{ finish_reason: 'stop' }] }, { usage: { total_tokens: 9 } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(wire)); c.close(); } });
  assert.equal(await readGenerationStream(body, 'openai', () => {}), 'answer');
});
