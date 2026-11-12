import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readGenerationStream } from './generation-result.ts';

function byteStream(text: string, split: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(bytes.slice(0, split));
    controller.enqueue(bytes.slice(split));
    controller.close();
  } });
}
for (const provider of ['google', 'openai'] as const) {
  it(`${provider} SSE accepts CR, LF, CRLF and mixed line endings at every byte split`, async () => {
    const frames = provider === 'google' ? [
      { candidates: [{ content: { parts: [{ text: 'किला 😀' }] } }] },
      { candidates: [{ finishReason: 'STOP' }] }, { usageMetadata: { totalTokenCount: 7 } },
    ] : [
      { choices: [{ delta: { content: 'किला 😀' } }] },
      { choices: [{ finish_reason: 'stop' }] }, { usage: { total_tokens: 7 } },
    ];
    for (const endings of [['\n', '\n', '\n'], ['\r\n', '\r\n', '\r\n'], ['\r', '\r', '\r'], ['\r', '\n', '\r\n']]) {
      const wire = frames.map((frame, i) => `data: ${JSON.stringify(frame)}${endings[i]}${endings[i]}`).join('');
      for (let split = 1; split < new TextEncoder().encode(wire).length; split++) {
        const tokens: string[] = [];
        assert.equal(await readGenerationStream(byteStream(wire, split), provider, token => tokens.push(token)), 'किला 😀', `ending=${JSON.stringify(endings)},split=${split}`);
        assert.deepEqual(tokens, ['किला 😀']);
      }
    }
  });
}

it('handles byte-at-a-time CRLF without duplicate events or broken Unicode', async () => {
  const wire = 'data: {"choices":[{"delta":{"content":"किला 😀"}}]}\r\n\r\ndata: {"choices":[{"finish_reason":"stop"}]}\r\n\r\n';
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of new TextEncoder().encode(wire)) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } });
  const tokens: string[] = [];
  assert.equal(await readGenerationStream(body, 'openai', token => tokens.push(token)), 'किला 😀');
  assert.deepEqual(tokens, ['किला 😀']);
});
