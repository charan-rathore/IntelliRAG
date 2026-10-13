import { test } from "node:test";
import assert from "node:assert/strict";
import { queryGraph } from "./graphify/query";
import { extractCorpus } from "./graphify/extract";
test("a graph with only matching labels still retrieves evidence",()=>{
 const graph=extractCorpus([{slug:"timeouts",title:"Timeout",body:"",corpus_id:"test"}]);
 assert.ok(queryGraph(graph,"Timeout").nodes.some(n=>n.slug==="timeouts"));
});
test("a shared term across all nodes is not treated as absent",()=>{
 const graph=extractCorpus([{slug:"a",title:"Timeout",body:"",corpus_id:"test"},{slug:"b",title:"Timeout",body:"",corpus_id:"test"}]);
 assert.ok(queryGraph(graph,"Timeout").nodes.length>0);
});
test("absent term still yields no graph match",()=>{
 const graph=extractCorpus([{slug:"a",title:"Timeout",body:"",corpus_id:"test"}]);
 assert.equal(queryGraph(graph,"Bananas").nodes.length,0);
});
