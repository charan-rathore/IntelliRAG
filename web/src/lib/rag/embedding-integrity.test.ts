import test from "node:test";
import assert from "node:assert/strict";
import { parseEmbedding } from "./text";
for (const raw of ['[null,1]', '["1",0]', '[true,1]', '[{},1]', '[1e400,1]']) {
 test(`rejects nonnumeric/nonfinite stored embedding ${raw}`, () => assert.equal(parseEmbedding(raw), null));
}
test("accepts a finite numeric stored vector", () => assert.deepEqual(parseEmbedding('[0,-1.25,2]'), [0,-1.25,2]));
import {retrieveFromRows,type SearchRow} from "./retrieve-core";
function row(embedding:string):SearchRow{return {title:"Queue guide",slug:"queue",corpusId:"test",indexedAt:null,chunk:{id:"q",document_id:"q",ordinal:0,text:"Queue execution timeout begins only after tasks start.",token_count:12,heading:null,embedding,embedding_model:"test",content_hash:"q",created_at:"",filepath:null,language:null,symbol:null,chunk_kind:"prose",corpus_id:"test"}};}
for(const raw of ['[null,1]','["1",0]','[1e400,1]']){
 test(`malformed vector ${raw} falls back to real keyword evidence`,()=>{
  const result=retrieveFromRows({query:"queue execution timeout",queryVector:[1,0],embeddingModel:"test",mode:"hybrid",topK:3,rows:[row(raw)],corpusScope:{kind:"corpus",corpusId:"test"},storage:{backend:"pglite",durable:true,denseAvailable:true,warning:null}});
  assert.equal(result.dense.compatibleStoredVectors,0);
  assert.equal(result.dense.denseCandidatesProduced,0);
  assert.equal(result.actualMode,"keyword");
  assert.ok(result.chunks.some(c=>c.slug==="queue"));
 });
}
