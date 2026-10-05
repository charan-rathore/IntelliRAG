import {test} from 'node:test';import assert from 'node:assert/strict';
import {streamLocal} from './ollama.server';
const saved=global.fetch;
for(const tail of ['',JSON.stringify({done:true,done_reason:'length'})])test(`local partial stream is not a completed answer: ${tail}`,async()=>{
 process.env.OLLAMA_GENERATION='1';
 global.fetch=async()=>new Response(JSON.stringify({message:{content:'partial'}})+'\n'+tail);
 try{await assert.rejects(streamLocal({system:'s',user:'q',onToken:()=>{}}))}finally{global.fetch=saved;delete process.env.OLLAMA_GENERATION}
});
test('local normal completion succeeds',async()=>{
 process.env.OLLAMA_GENERATION='1';global.fetch=async()=>new Response(JSON.stringify({message:{content:'answer'}})+'\n'+JSON.stringify({done:true,done_reason:'stop'}));
 try{assert.equal(await streamLocal({system:'s',user:'q',onToken:()=>{}}),'answer')}finally{global.fetch=saved;delete process.env.OLLAMA_GENERATION}
});
