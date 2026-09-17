import { it } from 'node:test';
import assert from 'node:assert/strict';
import { extractiveAnswer } from './extractive.ts';
import { formatAnswerHtml } from './answer.tsx';
import type { RetrievedChunk } from './types';
it('keeps source numbering and readable prose when chunks cut through code fences', () => {
  const chunks = [{text:'```js\nqueue.pause();\n\nThe onPendingZero method waits for running tasks, ignoring queued tasks.\n\n```\n\nUnrelated examples and other details about the library.'}, {text:'The onIdle method waits for both an empty queue and zero running tasks.'}] as RetrievedChunk[];
  const answer = extractiveAnswer('Why use onPendingZero instead of onIdle with queued tasks?', chunks);
  assert.match(answer, /onPendingZero method waits/);
  assert.match(answer, /onIdle method waits/);
  assert.match(answer, /\[Source 1\]/); assert.match(answer, /\[Source 2\]/);
  assert.match(answer, /not a generated recommendation/);
  assert.ok(!answer.includes('```'));
  assert.equal((formatAnswerHtml(answer, []).match(/<code>/g)||[]).length, 0);
  assert.ok(answer.length < 2400);
});
