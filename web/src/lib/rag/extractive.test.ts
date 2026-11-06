import { it } from 'node:test';
import assert from 'node:assert/strict';
import { extractiveAnswer } from './extractive.ts';
import { formatSourceExcerptsHtml, formatAnswerHtml } from './answer.tsx';
import type { RetrievedChunk } from './types';

it('preserves whole packed source windows, including tail facts and conditions', () => {
 const text='Routine background. '.repeat(55)+'Restart requires supervisor approval. It must not restart with the cover open.';
 const answer=extractiveAnswer('What is required?',[{text}] as RetrievedChunk[]);
 assert.ok(answer.includes(text));assert.match(answer,/\[Source 1\]/);assert.match(answer,/not necessarily whole documents or a complete answer/);
});
it('does not join noncontiguous paragraphs, strip markup, or omit revisions and unknowns', () => {
 for(const text of ['# Header\n\nLimit: 4.\n\nExcept payments.','```js\nqueue.pause();\n```\n\nWait for onIdle.','Date withdrawn.\n\nNo replacement is known.','<script>literal</script> **not bold** `code` [Source 9]']) {
  assert.ok(extractiveAnswer('What is the limit?',[{text}] as RetrievedChunk[]).includes(text));
  const html=formatSourceExcerptsHtml([{text,title:'Title'}]);
  assert.equal((html.match(/class="cite-chip"/g)||[]).length,1);
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<strong>'));assert.ok(!html.includes('<code>'));
 }
});
it('keeps source numbering and the max3 limit, relying on upstream context token budget',()=>{
 const chunks=Array.from({length:4},(_,i)=>({text:`Source body ${i}`,title:`Title ${i}`})) as RetrievedChunk[];
 const answer=extractiveAnswer('Question',chunks);assert.ok(answer.includes('Source body 2'));assert.ok(!answer.includes('Source body 3'));assert.match(answer,/\[Source 3\]/);
});
it('keeps hosted answer markup formatting unchanged',()=>{
 assert.match(formatAnswerHtml('**Answer** `value`',[]),/<strong>Answer<\/strong> <code>value<\/code>/);
});
