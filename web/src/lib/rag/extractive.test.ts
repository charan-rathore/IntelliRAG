import { it } from 'node:test';
import assert from 'node:assert/strict';
import { extractiveAnswer as full, PASSAGES_DIVIDER } from './extractive.ts';

// The quoted answer; the verbatim passages after the divider are checked separately.
const extractiveAnswer: typeof full = (...a) => full(...a).split(PASSAGES_DIVIDER)[0]!;
import { formatSourceExcerptsHtml, formatAnswerHtml } from './answer.tsx';
import type { RetrievedChunk } from './types';

const chunk = (text: string) => ({ text, title: 'T' }) as RetrievedChunk;

it('quotes the sentences that answer, each cited, instead of pasting whole windows', () => {
  const text = 'Routine background about the project. '.repeat(30) + 'Restart requires supervisor approval. It must not restart with the cover open.';
  const answer = extractiveAnswer('What does a restart require?', [chunk(text)]);
  assert.match(answer, /- Restart requires supervisor approval\. \[Source 1\]/);
  // A condition right after a quoted point travels with it.
  assert.match(answer, /It must not restart with the cover open\. \[Source 1\]/);
  assert.ok(!answer.includes('Routine background about the project. Routine'));
  assert.match(answer, /Quoted from the source, not a generated recommendation/);
});

it('reads Markdown: headings name the point, code stays fenced, callouts and links are unwrapped', () => {
  const text = '#### .pause()\n\nPut queue execution on hold.\n\n> [!NOTE]\n> Pausing does not cancel running tasks.\n\n```js\nqueue.pause();\nawait queue.onPendingZero();\n```\n\nSee [the docs](#docs) for pause details.';
  const answer = extractiveAnswer('how do I pause the queue', [chunk(text)]);
  assert.match(answer, /`\.pause\(\)`: Put queue execution on hold\. \[Source 1\]/);
  assert.ok(!answer.includes('[!NOTE]'));
  assert.match(answer, /```\nqueue\.pause\(\);\nawait queue\.onPendingZero\(\);\n```/);
  assert.ok(!answer.includes('](#docs)'));
});

it('handles a window that starts inside a code block', () => {
  const text = "queue.add(() => fetch(url));\nqueue.pause();\n```\n\nThe queue pauses after the current tasks settle.";
  const answer = extractiveAnswer('when does the queue pause', [chunk(text)]);
  assert.match(answer, /The queue pauses after the current tasks settle\./);
  assert.ok(!/- queue\.add/.test(answer));
});

it('never reaches past the three packed sources', () => {
  const chunks = ['Memory caps follow the limit setting of each worker pool.', 'Network quotas use a limit setting chosen per region by operators.', 'Disk usage obeys one limit setting shared across every volume mounted.', 'Clock drift never affects the limit setting.'].map(chunk);
  const answer = extractiveAnswer('limit setting', chunks);
  assert.ok(answer.includes('[Source 3]'));
  assert.ok(!answer.includes('Clock drift'));
});

it('keeps literal source excerpt rendering and hosted answer markup unchanged', () => {
  const html = formatSourceExcerptsHtml([{ text: '<script>x</script> **not bold**', title: 'Title' }]);
  assert.ok(!html.includes('<script>') && !html.includes('<strong>'));
  assert.match(formatAnswerHtml('**Answer** `value`', []), /<strong>Answer<\/strong> <code>value<\/code>/);
});

it('keeps every packed window verbatim after the quoted answer, so nothing selection left out is lost', () => {
  const text = 'Date withdrawn.\n\nNo replacement is known.';
  const answer = full('What date?', [chunk(text)]);
  const [, passages] = answer.split(PASSAGES_DIVIDER);
  assert.ok(passages!.includes(text));
  assert.match(passages!, /\[Source 1\]/);
});

it('does not omit the matching section and its first remedy because its heading repeats', () => {
  const text = '# Redis Cache Stampede and TTL Guide\n\n## Stampede\nWhen a hot key expires, many workers recompute it at once. Use:\n1. Probabilistic early refresh\n2. Single-flight lock (SET key:lock NX EX 10)\n3. Serve stale while one worker rebuilds\n\n## TTL\nJitter TTLs so keys do not expire together.\n\n## Eviction\nallkeys-lru for a pure cache. volatile-lru if some keys must never drop.\n\n## Persistence\nA cache is not a source of truth. If Redis dies, the app must rebuild from Postgres.';
  const answer = extractiveAnswer('How do you stop a Redis cache stampede?', [chunk(text)]);
  assert.match(answer, /Probabilistic early refresh/);
});

it('keeps bodies with no headings byte-identical to their previous quote selection', () => {
  const answer = extractiveAnswer('Recovery', [chunk('Recovery requires supervisor approval. Never proceed while the cover is open. Routine unrelated background.')]);
  assert.match(answer, /Recovery requires supervisor approval/);
  assert.match(answer, /Never proceed while the cover is open/);
  assert.ok(!answer.includes('Routine unrelated background'));
});

it('does not let a repeated same-title section merge across sources', () => {
  const answer = full('Recovery', [chunk('## Recovery\nVerify the required sensor reading.'), chunk('## Recovery\nConfirm the separate coolant pressure.')]);
  assert.match(answer.split(PASSAGES_DIVIDER)[0]!, /sensor reading.*Source 1/);
  assert.match(answer.split(PASSAGES_DIVIDER)[0]!, /coolant pressure.*Source 2/);
});


it('keeps explicit body facts ahead of a weak body under a matching heading', () => {
  for (const question of ['Recovery', 'Recovery approval']) {
    const text = `## ${question}\nFollow unrelated housekeeping instructions.\n\n## Background\n${question} requires supervisor approval.`;
    const answer = extractiveAnswer(question, [chunk(text)], { maxPoints: 1 });
    assert.match(answer, /requires supervisor approval/);
    assert.ok(!answer.includes('housekeeping'));
  }
});
