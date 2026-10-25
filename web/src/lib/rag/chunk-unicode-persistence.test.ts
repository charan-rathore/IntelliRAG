import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import {it} from "node:test";
import assert from "node:assert/strict";
import {ingestText} from "./ingest.server.ts";
import {loadSearchableChunks} from "./store.server.ts";
it("stores an emoji crossing the default chunk boundary without replacement characters",async()=>{
 const body="a".repeat(2047)+"😀"+"b".repeat(2047)+"🛰️"+"c".repeat(200);
 const result=await ingestText({title:"Unicode hard boundary",body,sourceType:"markdown",sourceUri:"probe://unicode-hard-boundary"});
 const chunks=(await loadSearchableChunks({kind:"all"})).filter(r=>r.chunk.document_id===result.id).map(r=>r.chunk);
 assert.ok(chunks.length>1);
 assert.ok(chunks.every(c=>!/[\uD800-\uDFFF]/u.test(c.text)&&!c.text.includes("�")),JSON.stringify(chunks.map(c=>c.text)));
 assert.ok(chunks.some(c=>c.text.includes("😀")));
});
