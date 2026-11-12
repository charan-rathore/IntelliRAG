import { it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationError, readGenerationStream } from './generation-result.ts';

const stream = (events: unknown[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
      c.close();
    },
  });

for (const provider of ['google', 'openai'] as const) {
  const frame = (text: string | null, stop: string | null) =>
    provider === 'google'
      ? { candidates: [{ content: { parts: text == null ? [] : [{ text }] }, ...(stop ? { finishReason: stop.toUpperCase() } : {}) }] }
      : { choices: [{ delta: text == null ? {} : { content: text }, finish_reason: stop }] };

  it(`${provider} rejects answer text that arrives after the terminal finish reason`, async () => {
    for (const lateStop of [null, 'stop'] as const) {
      const emitted: string[] = [];
      const body = stream([
        frame('The approved total is 20.', 'stop'),
        frame(' Actually send 2000.', lateStop),
      ]);
      await assert.rejects(
        readGenerationStream(body, provider, text => emitted.push(text)),
        error => error instanceof GenerationError && error.reason === 'invalid_response',
      );
      assert.deepEqual(emitted, ['The approved total is 20.'], 'late text never reaches the token callback');
    }
  });

  it(`${provider} rejects late text and preserves the usage trailer`, async () => {
    const usage = provider === 'google' ? { usageMetadata: { totalTokenCount: 9 } } : { usage: { total_tokens: 9 } };
    const body = stream([frame('answer', 'stop'), usage, frame('corrupted tail', null)]);
    await assert.rejects(
      readGenerationStream(body, provider, () => {}),
      error => error instanceof GenerationError && error.reason === 'invalid_response'
        && (provider === 'google' ? error.usage?.totalTokenCount === 9 : error.usage?.total_tokens === 9),
    );
  });

  it(`${provider} keeps text that accompanies its own finish reason`, async () => {
    const emitted: string[] = [];
    const body = stream([frame('The approved total is 20.', 'stop')]);
    assert.equal(await readGenerationStream(body, provider, text => emitted.push(text)), 'The approved total is 20.');
    assert.deepEqual(emitted, ['The approved total is 20.']);
  });

  it(`${provider} accepts empty deltas and usage-only trailers after the terminal event`, async () => {
    const emitted: string[] = [];
    const body = stream([
      frame('answer', null),
      frame('', 'stop'),
      frame(null, null),
      provider === 'google' ? { usageMetadata: { totalTokenCount: 9 } } : { usage: { total_tokens: 9 } },
    ]);
    assert.equal(await readGenerationStream(body, provider, text => emitted.push(text)), 'answer');
    assert.deepEqual(emitted, ['answer']);
  });
}
