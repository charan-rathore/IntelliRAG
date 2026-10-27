import { it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCompletion, GenerationError, readGenerationStream, validateCompletion } from './generation-result.ts';

const invalid = (error: unknown) => error instanceof GenerationError && error.reason === 'invalid_response';
for (const provider of ['google', 'openai'] as const) {
  it(`${provider} rejects non-string answer text instead of coercing it`, async () => {
    for (const bad of [42, true, {}, ['not', 'text']]) {
      const wire = provider === 'google' ? { usageMetadata: { totalTokenCount: 9 }, candidates: [{ content: { parts: [{ text: bad }] }, finishReason: 'STOP' }] } : { usage: { total_tokens: 9 }, choices: [{ delta: { content: bad }, finish_reason: 'stop' }] };
      const tokens: unknown[] = [];
      const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); c.close(); } });
      await assert.rejects(readGenerationStream(body, provider, token => tokens.push(token)), error => invalid(error) && error instanceof GenerationError && (error.usage?.total_tokens === 9 || error.usage?.totalTokenCount === 9), JSON.stringify(bad));
      assert.deepEqual(tokens, [], 'invalid text must not be emitted before rejection');
    }
  });

  it(`${provider} rejects non-string text in non-streaming completion`, () => {
    for (const bad of [42, true, {}, ['not', 'text']]) {
      const wire = provider === 'google' ? { candidates: [{ content: { parts: [{ text: bad }] }, finishReason: 'STOP' }] } : { choices: [{ message: { content: bad }, finish_reason: 'stop' }] };
      assert.throws(() => validateCompletion(decodeCompletion(wire, provider)), invalid, JSON.stringify(bad));
    }
  });
}

it('keeps valid empty deltas, usage-only frames and non-text Google parts compatible', () => {
  assert.equal(decodeCompletion({ choices: [{ delta: { content: null } }] }, 'openai', true).text, '');
  assert.equal(decodeCompletion({ usage: { total_tokens: 7 } }, 'openai', true).text, '');
  assert.equal(decodeCompletion({ candidates: [{ content: { parts: [{ inlineData: {} }, { text: 'answer' }] } }] }, 'google').text, 'answer');
});
