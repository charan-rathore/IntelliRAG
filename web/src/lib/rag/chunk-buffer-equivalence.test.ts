import {it} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {chunkDocument} from './chunking.ts';
it('code buffer bookkeeping preserves complete chunk output across fixture shapes',()=>{
const outputs=[];for(const language of ['python','typescript','c','java'])for(const size of [32,128,512])for(const overlap of [0,8,64]){
const body=['// Shared source imports','import alpha from "alpha";','',...Array.from({length:180},(_,i)=>i%9===0?'':i%17===0?`export function step${i}() { return ${i}; }`:`  row${i} = "😀 value ${i}";`)].join('\n');assert.equal(body.split('\n').length,183);const chunks=chunkDocument(body,{kind:'code',language,chunkSize:size,overlap});assert.ok(chunks.length>1);assert.ok(chunks.some(c=>c.text.includes('row')));outputs.push(chunks);}
// Golden fingerprint captured from the previous implementation, including every metadata field.
assert.equal(createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),'82fbbec354bef062420162b7c133b8aa19128d2f15a5c7a5209bd111b26db50d');
});
