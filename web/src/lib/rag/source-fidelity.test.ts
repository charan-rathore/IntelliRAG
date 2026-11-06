import './testing/isolated-pglite-dir.mjs';
import './testing/close-database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { upsertDocument } from './store.server';
import { runQueryStream, type QueryEvent } from './query.server';

const body='The Sable fan service register records routine maintenance observations. '.repeat(13)+'The Sable fan restart requires supervisor approval. The Sable fan restart must not occur while its inlet cover is open.';
test('selected source body must survive provider-free displayed output',async t=>{
 const env=process.env;const output=env.FIDELITY_OUTPUT ?? '/tmp/source-fidelity-test-'+process.pid+'.json';
 process.env={PATH:env.PATH,HOME:env.HOME,INTELLIRAG_CLAIMS_LANE:'0',RAG_LOCAL_EMBED:'off'};t.after(()=>{process.env=env;});
 const read=fs.readFileSync,write=fs.writeFileSync;const sidecars=new Map<string,string>();const paths=new Set(['/tmp/intellirag-memory.json','/tmp/intellirag-graphify.json','/tmp/intellirag-suggested-questions.json']);
 t.mock.method(fs,'readFileSync',((path,...args)=>{if(!paths.has(String(path)))return read(path,...args);const v=sidecars.get(String(path));if(v===undefined)throw new Error('No sidecar');return v;}) as typeof fs.readFileSync);
 t.mock.method(fs,'writeFileSync',((path,data,...args)=>{if(!paths.has(String(path)))return write(path,data,...args);sidecars.set(String(path),String(data));}) as typeof fs.writeFileSync);syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const network=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network forbidden');});
 const d=await upsertDocument({title:'Sable fan service register',body,sourceType:'markdown',sourceUri:'fictional-fidelity://sable',slugHint:'sable-fan-fidelity',corpusId:'fidelity'});
 const runs=[];
 for(const skipCache of [true,false,false]){
  const events:QueryEvent[]=[];await runQueryStream({question:'What does the Sable fan restart require?',corpus:'fidelity',retrievalMode:'keyword',skipCache},e=>events.push(e));
  const done=events.find(e=>e.type==='done'),sources=events.find(e=>e.type==='sources');assert.ok(done?.type==='done');assert.ok(sources?.type==='sources');
  runs.push({skipCache,done,sources});
 }
 const selectedContainsFact=runs[0].sources.chunks.some(c=>c.text.includes('requires supervisor approval'));
 write(output,JSON.stringify({body,document:d,fetchCalls:network.mock.callCount(),selectedContainsFact,runs},null,2));
 assert.equal(network.mock.callCount(),0);assert.equal(selectedContainsFact,true);
 for(const r of runs){
  for(const [i,ch] of r.sources.chunks.entries()){const cite=r.done.citations[i];assert.deepEqual(cite.excerptRange,{basis:'packed_chunk',start:0,end:ch.text.length});assert.equal(r.done.answer.includes(ch.text.slice(cite.excerptRange.start,cite.excerptRange.end)),true);}
  assert.ok(r.done.answer.includes('requires supervisor approval'),r.done.answer);assert.ok(r.done.answer.includes('must not occur while its inlet cover is open'));}
});
