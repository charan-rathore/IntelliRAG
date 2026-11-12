/** CPU-only, no-key diagnostic on pinned public GitHub PR patches and a README. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chunkDocument } from '../src/lib/rag/chunking';
import { retrieveFromRows, type SearchRow } from '../src/lib/rag/retrieve-core';
import { BM25Index } from '../src/lib/rag/bm25';
import { githubPullDocuments } from '../src/lib/rag/github';
import { CONTEXT_TOKEN_BUDGET } from '../src/lib/rag/types';
const root = resolve(import.meta.dirname, '../../eval/pr-readme');
const prs = JSON.parse(readFileSync(root + '/fixtures/p-queue-prs.json','utf8'));
const readme = readFileSync(resolve(import.meta.dirname, '../../eval/repo-support/fixtures/p-queue.md'),'utf8');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const before = process.argv.includes('--before');
const docs = [
 {slug:'readme',title:'p-queue README',body:readme,filepath:'readme.md',kind:'prose' as const},
 ...prs.flatMap((pr: any) => before ? [{slug:`pr-${pr.number}`,title:`PR #${pr.number}: ${pr.title}`,body:`# PR #${pr.number}: ${pr.title}\nState: ${pr.state}\n${pr.body}`,filepath:null,kind:'prose' as const}] : githubPullDocuments(pr, 'sindresorhus', 'p-queue').map((doc: any) => ({slug:doc.slug,title:doc.title,body:doc.body,filepath:doc.filepath,kind:doc.chunkKind}))),
];
const rows: SearchRow[] = [];
const offline: any[] = [];
for (const doc of docs) {
 const t=performance.now();
 const chunks=chunkDocument(doc.body,{kind:doc.kind,filepath:doc.filepath});
 offline.push({source:doc.slug,chars:doc.body.length,chunks:chunks.length,ms:performance.now()-t});
 for (const c of chunks) rows.push({title:doc.title,slug:doc.slug,indexedAt:null,corpusId:'pr-readme',chunk:{id:`${doc.slug}:${c.ordinal}`,document_id:doc.slug,ordinal:c.ordinal,text:c.text,token_count:c.tokenCount,heading:c.heading,embedding:null,embedding_model:null,content_hash:hash(c.text),created_at:'',filepath:c.filepath,language:c.language,symbol:c.symbol,chunk_kind:c.chunkKind,corpus_id:'pr-readme'}});
}
const index = new BM25Index(rows.map(r=>({id:r.chunk.id,text:`${r.title}\n${r.chunk.text}`})));
const cases = [
 {id:'readme-pause',query:'How can I pause p-queue and wait for running tasks, but not queued tasks, before changing config?',source:'readme',quote:'onPendingZero'},
 {id:'pr235-abort',query:'In PR 235, how is the abort listener cleaned up after a job finishes?',source:'pr-235',quote:'removeEventListener'},
 {id:'pr240-autostart',query:'What did PR 240 change in the autoStart README sentence?',source:'pr-240',quote:'within the concurrency limit are auto-executed'},
 {id:'pr243-results',query:'How did PR 243 fix duplicate const results in the README example?',source:'pr-243',quote:'Or more concisely:'},
];
const byId = new Map(rows.map(r=>[r.chunk.id,r]));
const results = cases.map(c=>{
 const oracle=rows.filter(r=>r.slug.startsWith(c.source)&&r.chunk.text.includes(c.quote)).map(r=>r.chunk.id);
 const start=performance.now(); const r=retrieveFromRows({query:c.query,queryVector:null,mode:'keyword',topK:8,embeddingModel:null,rows,storage:{backend:'ephemeral',durable:false,denseAvailable:false,warning:null},corpusScope:{kind:'corpus',corpusId:'pr-readme'}});
 const ms=performance.now()-start;
 const got=r.chunks.filter(x=>x.slug.startsWith(c.source)&&x.text.includes(c.quote));
 let budget=0;const base=index.search(c.query,8).filter(hit=>{const n=byId.get(hit.id)!.chunk.token_count;if(budget+n>CONTEXT_TOKEN_BUDGET)return false;budget+=n;return true;});
 return {id:c.id,query:c.query,oracleChunks:oracle.length,offlinePreserved:Number(oracle.length>0),packedEvidence:Number(got.length>0),bm25Evidence:Number(base.some(x=>oracle.includes(x.id))),gate:r.evidence,actualMode:r.actualMode,packed:r.chunks.map(x=>x.chunkId),candidate:r.candidates.slice(0,8).map(x=>({id:x.chunkId,score:x.score,reason:x.dropReason})),ms};
});
const output={at:new Date().toISOString(),baseline:before,corpus:'p-queue README at 180ab9e25cd10b6f548767d7176076b50d25e188 + PRs 235, 240, 243',sourceHashes:docs.map(d=>({source:d.slug,sha256:hash(d.body)})),offline,rows:rows.length,results,summary:{offlinePreserved:results.reduce((a,b)=>a+b.offlinePreserved,0),packedEvidence:results.reduce((a,b)=>a+b.packedEvidence,0),bm25Evidence:results.reduce((a,b)=>a+b.bm25Evidence,0),total:results.length}};
const path=process.env.AUDIT_OUTPUT || (root+'/'+(before?'before':'after')+'.json');writeFileSync(path,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output.summary));console.log(path);
