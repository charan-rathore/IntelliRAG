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

it('retains short direct answers instead of discarding them as low-content paragraphs', () => {
 const chunks = [{text:'# Cobalt service\n\nRetry limit: 4.\n\nThis service supports background uploads and operational telemetry for internal teams.'}] as RetrievedChunk[];
 const answer = extractiveAnswer('What is the retry limit?',chunks);
 assert.match(answer,/Retry limit: 4\./);
});

it('retains short explicit unknowns when related background cannot answer the question', () => {
 const chunks = [{text:'# Zircon incident\n\nRoot cause unknown.\n\nThe zircon pump stopped on Tuesday during its scheduled operating window and the technician recorded the observation.'}] as RetrievedChunk[];
 const answer = extractiveAnswer('What is the root cause?',chunks);
 assert.match(answer,/Root cause unknown\./);
});

it('does not spend an excerpt slot on a heading-only paragraph', () => {
 const chunks = [{text:'# Retry limit\n\nRetry limit: 4.\n\nRetry limit applies to each independent job.'}] as RetrievedChunk[];
 const answer = extractiveAnswer('What is the retry limit?',chunks);
 assert.match(answer,/Retry limit: 4\./);
 assert.match(answer,/applies to each independent job/);
});

it('preserves concise negation and measurements across document forms', () => {
 for (const [question, fact] of [
  ['Is approval required?', 'Approval is not required.'],
  ['What is the failure cause?', 'Cause not investigated.'],
  ['What is the reserve?', 'Reserve: €1200.'],
  ['What is the limit?', 'Limit: 42°C.'],
  ['What is the new rollout date?', 'New date: 2026-11-15.'],
  ['What is the retry limit?', '| retry limit | 4 |'],
  ['What is the retry limit?', '{"retry_limit":4}'],
 ]) {
  const answer=extractiveAnswer(question,[{text:`# Document\n\n${fact}\n\nThis background paragraph describes the surrounding operational context without changing the recorded short fact.`}] as RetrievedChunk[]);
  assert.ok(answer.includes(fact), answer);
 }
});

it('ignores empty and heading-only paragraphs while retaining real short text', () => {
 const answer=extractiveAnswer('What is the limit?',[{text:'# Header\n\n\n\n## Limit\n\nLimit: 4.\n\nNo exception.'}] as RetrievedChunk[]);
 assert.match(answer,/Limit: 4\./);
 assert.match(answer,/No exception\./);
 assert.ok(!answer.includes('Header'));
});
