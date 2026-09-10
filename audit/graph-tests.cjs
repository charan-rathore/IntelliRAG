const fs=require('fs'),path=require('path');
const ts=require('/Users/charanrathore/Downloads/tetris-style/node_modules/typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {extractCorpus,queryTokens}=require('../web/src/lib/rag/graphify/extract.ts');
const {lookupCache,queryGraph,preferredSlugs}=require('../web/src/lib/rag/graphify/query.ts');
const {SEED_DOCUMENTS}=require('../web/src/lib/rag/corpus.ts');
const graph=extractCorpus(SEED_DOCUMENTS);
const state={graph,memory:[],learning:null,cache:[{question:'Should I use Redis?',answer:'Use Redis.',corpusId:'seed-lab',outcome:null}]};
const repeated=extractCorpus([{slug:'a',title:'A',body:'## Same\nAlpha\n## Same\nBeta\n## 中文\nText\n## 日本語\nText'}]);
const results={seed:{nodes:graph.nodes.length,edges:graph.links.length,bytes:Buffer.byteLength(JSON.stringify(graph)),dangling:graph.links.filter(l=>!graph.nodes.some(n=>n.id===l.source)||!graph.nodes.some(n=>n.id===l.target)).length},negationCacheCollision:!!lookupCache(state,'Should I not use Redis?','seed-lab'),numericCacheCollision:!!lookupCache({...state,cache:[{question:'Retry Redis 7 times',answer:'7',corpusId:'seed-lab'}]},'Retry Redis 9 times','seed-lab'),shortTechnicalTokens:queryTokens('SQL TLS TTL API Go C++'),nonEnglishTokens:queryTokens('ما هي قاعدة البيانات'),repeatedHeadings:{nodes:repeated.nodes,links:repeated.links},preferredForUnrelated:preferredSlugs({...state,learning:{nodes:[{id:'doc:redis-cache',verdict:'preferred'}]}},'photosynthesis'),redisNeighborhood:queryGraph(graph,'Redis cache stampede').slugs};
for(const n of [100,1000,5000]){const docs=Array.from({length:n},(_,i)=>({slug:'doc-'+i,title:'Shared Redis memory '+i,body:'## Shared heading\nRedis cache memory shared queue process retry timeout latency'}));const g=extractCorpus(docs);const start=performance.now();const found=queryGraph(g,'redis memory');results['scale'+n]={nodes:g.nodes.length,edges:g.links.length,queryMs:performance.now()-start,returned:found.nodes.length};}
fs.writeFileSync(path.join(__dirname,'graph-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
