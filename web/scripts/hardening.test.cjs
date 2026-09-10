const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
// Transpile the actual source for these dependency-free unit regressions.
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const requests = new AsyncLocalStorage();
const originalLoad = Module._load;
Module._load = function(id, ...args) {
  if (id === '@tanstack/react-start/server') return { getRequest: () => requests.getStore().request, setCookie: (name,value) => requests.getStore().cookies.set(name,value) };
  return originalLoad.call(this,id,...args);
};
const keys = require('../src/lib/rag/keys.server.ts');
const { extractCorpus, queryTokens } = require('../src/lib/rag/graphify/extract.ts');
const { lookupCache, queryGraph, preferredSlugs } = require('../src/lib/rag/graphify/query.ts');
const { parseGithubUrl } = require('../src/lib/rag/github.ts');
const state = {graph:extractCorpus([{slug:'redis',title:'Redis',body:'## Cache\nRedis caching'}]),cache:[],memory:[],learning:null};
function cache(question, outcome=null) {return {...state,cache:[{question,answer:'Cached answer',outcome,corpusId:'a'}]};}
test('answer cache preserves negation and numbers',()=>{
 assert.equal(lookupCache(cache('Should I use Redis?'),'Should I not use Redis?','a'),null);
 assert.equal(lookupCache(cache('Retry Redis 7 times'),'Retry Redis 9 times','a'),null);
 assert.ok(lookupCache(cache('Retry Redis 7 times'),'Retry Redis 7 times','a'));
});
test('answer cache isolates corpora and rejects unverified corrections',()=>{
 assert.equal(lookupCache(cache('Redis'),'Redis','b'),null);
 assert.equal(lookupCache(cache('Redis','corrected'),'Redis','a'),null);
 assert.equal(lookupCache(cache('Redis','dead_end'),'Redis','a'),null);
});
test('heading identity preserves repeated and non-Latin headings',()=>{
 const graph=extractCorpus([{slug:'a',title:'A',body:'## Same\nOne\n## Same\nTwo\n## 中文\nThree\n## 日本語\nFour'}]);
 assert.equal(graph.nodes.length,5);assert.equal(new Set(graph.links.map(e=>e.target)).size,4);
});
test('technical abbreviations and Arabic survive graph tokenization',()=>{
 assert.deepEqual(queryTokens('SQL TLS TTL API Go'),['sql','tls','ttl','api','go']);
 assert.ok(queryTokens('قاعدة البيانات').length===2);
});
test('graph output respects small budgets and unrelated preferences do not spill',()=>{
 assert.equal(queryGraph(state.graph,'Redis',0).nodes.length,0);
 assert.ok(queryGraph(state.graph,'Redis',1).nodes.length<=1);
 assert.deepEqual(preferredSlugs({...state,learning:{nodes:[{id:'doc:redis',verdict:'preferred'}]}},'photosynthesis'),[]);
});
test('GitHub issue and PR URLs do not expand to repository roots',()=>{
 assert.equal(parseGithubUrl('https://github.com/charan-rathore/IntelliRAG/issues/2').kind,'issue');
 assert.equal(parseGithubUrl('https://github.com/charan-rathore/IntelliRAG/pull/1').kind,'issue');
 assert.throws(()=>parseGithubUrl('https://github.com/charan-rathore/IntelliRAG/actions'));
});
test('browser keys remain request-local and GET never copies another visitor key',async()=>{
 const saved={gemini:process.env.GEMINI_API_KEY,openrouter:process.env.OPENROUTER_API_KEY};
 delete process.env.GEMINI_API_KEY;delete process.env.OPENROUTER_API_KEY;
 try {
  await Promise.all([0,1].map(i=>requests.run({request:new Request('https://example.test/api/keys'),cookies:new Map()},async()=>{
   if(i===0){keys.setMemoryKeys({openrouter:'sk-or-test-not-a-real-key'}); await new Promise(r=>setTimeout(r,10));assert.equal(keys.keyStatus().hasOpenRouterKey,true);}
   else {await new Promise(r=>setTimeout(r,5));assert.equal(keys.keyStatus().hasOpenRouterKey,false);assert.ok(keys.labKeySetCookieHeaders().every(c=>c.includes('Max-Age=0')));}
  })));
 } finally {for(const [k,v] of [['GEMINI_API_KEY',saved.gemini],['OPENROUTER_API_KEY',saved.openrouter]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('graph lifecycle adds imports, invalidates edited evidence, scopes feedback, and removes deleted nodes',async()=>{
 let documents=[{slug:'seed',title:'Seed',body:'## Cache\nRedis cache',version:1}];
 const previousLoad=Module._load;
 Module._load=function(id,parent,...rest){
  if(parent?.filename?.endsWith('graphify/persist.server.ts')){
   if(id==='../store.server')return {listDocuments:async()=>documents,getDocumentBySlug:async(slug)=>documents.find(d=>d.slug===slug)??null};
   if(id==='@/lib/db')return {vercelWithoutDatabase:()=>true};
   if(id==='node:fs')return {mkdirSync:()=>{},writeFileSync:()=>{},readFileSync:()=>{throw new Error('isolated test: no disk state');}};
  }
  return previousLoad.call(this,id,parent,...rest);
 };
 delete global.__intelliragGraph;
 try{
  const graph=require('../src/lib/rag/graphify/persist.server.ts');
  const before=await graph.graphSnapshot();assert.ok(before.nodes.some(n=>n.id==='doc:seed'));
  documents.push({slug:'lyra',title:'Lyra',body:'## Recovery\nRedis retry budget 7',version:1});
  const added=await graph.graphSnapshot();assert.ok(added.nodes.some(n=>n.id==='doc:lyra'));assert.ok(added.nodeCount>before.nodeCount);
  const save=(corpusId)=>graph.saveQueryResult({question:'Lyra retry budget?',answer:'7',sourceNodes:['doc:lyra'],sourceSlugs:['lyra'],coverage:'grounded',citations:[],candidates:[],chunks:[],contextTokens:5,corpusId});
  await save('a');await save('b');await graph.recordOutcome({question:'Lyra retry budget?',outcome:'corrected',correction:'70',corpusId:'a'});
  assert.equal((await graph.findCachedAnswer('Lyra retry budget?','a')).hit,null);
  assert.equal((await graph.findCachedAnswer('Lyra retry budget?','b')).hit.answer,'7');
  documents[1]={...documents[1],body:'## Recovery\nRetry budget 9',version:2};
  assert.equal((await graph.findCachedAnswer('Lyra retry budget?','b')).hit,null);
  documents=documents.filter(d=>d.slug!=='lyra');const deleted=await graph.graphSnapshot();
  assert.ok(!deleted.nodes.some(n=>n.slug==='lyra'));
  const ids=new Set(deleted.nodes.map(n=>n.id));assert.ok(deleted.links.every(e=>ids.has(e.source)&&ids.has(e.target)));
 }finally{Module._load=previousLoad;delete global.__intelliragGraph;}
});


test('lexical graph excludes connector words while retaining shared technical terms',()=>{
 const graph=extractCorpus([{slug:'a',title:'A',body:'It is in the API. Go uses TLS.'},{slug:'b',title:'B',body:'It is in the API. Go uses TLS.'}]);
 const terms=graph.nodes.filter(n=>n.kind==='term').map(n=>n.label);
 for(const word of ['it','is','in','the'])assert.ok(!terms.includes(word));
 for(const word of ['api','go','tls'])assert.ok(terms.includes(word));
 const ids=new Set(graph.nodes.map(n=>n.id));assert.ok(graph.links.every(e=>ids.has(e.source)&&ids.has(e.target)));
});
