import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=process.argv[2] || 'http://localhost:8080';
const destination=process.argv[3] || '../audit/graph-provenance-local.json';
const report={base,at:new Date().toISOString(),sources:[],pass:false};
async function json(path,body) { const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d; }
async function ask(question,corpus) { const r=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,corpus,retrievalMode:'keyword',topK:5}),signal:AbortSignal.timeout(60000)});const events=(await r.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));assert.ok(events.find(e=>e.type==='graph'));const done=events.find(e=>e.type==='done');assert.ok(done,JSON.stringify(events));return done; }
try {
 const before=await json('/api/lab');
 for(const [repo,question,match] of [
  ['p-debounce','How does pDebounce.promise use after true to queue the latest arguments while a previous call is running?',/latest arguments|after.*true|previous call/i],
  ['p-throttle','What does the strict option do in pThrottle?',/strict|windowed|individual/i],
 ]) {
  const entry={repo,importMode:'README via blob URL; repository tree API returned 403',newToCorpus:!JSON.stringify(before.corpora).includes('/'+repo)};report.sources.push(entry);
  const imported=await json('/api/lab',{action:'ingest',url:'https://github.com/sindresorhus/'+repo+'/blob/main/readme.md'});entry.corpus=imported.corpusId;
  const done=await ask(question,imported.corpusId);assert.equal(done.coverage,'grounded');assert.ok(done.citations.length);assert.match(done.answer,match);assert.ok(done.candidates.every(c=>c.corpusId===imported.corpusId));
  const graph=await json('/api/graph?corpus='+encodeURIComponent(imported.corpusId));
  const q=graph.nodes.find(n=>n.kind==='query' && n.label===question.slice(0,120));assert.ok(q,'Question must enter graph');
  const citedIds=new Set(done.citations.map(c=>c.chunkId));const slugs=[...new Set(done.candidates.filter(c=>citedIds.has(c.chunkId)).map(c=>c.slug))];
  const targets=graph.links.filter(e=>e.source===q.id&&e.relation==='answered_from').map(e=>e.target.replace(/^doc:/,''));assert.deepEqual(targets.sort(),slugs.sort());
  assert.ok(graph.nodes.some(n=>n.kind==='heading'&&n.source_location&&n.excerpt));
  const repeated=await ask(question,imported.corpusId);assert.equal(repeated.cacheHit,true);assert.equal(repeated.answer,done.answer);
  const refused=await ask('What exact production database password does this source specify?',imported.corpusId);assert.equal(refused.coverage,'refused');assert.equal(refused.citations.length,0);
  Object.assign(entry,{citedSlugs:slugs,graphTargets:targets,graphNodes:graph.nodes.length,sourceExcerpt:true,cacheReuse:true,unsupportedRefusal:true,pass:true});console.log(entry);
 }
 report.pass=true;
} catch(e) {report.error=e.message;process.exitCode=1;}
await writeFile(destination,JSON.stringify(report,null,2)+'\n');console.log({pass:report.pass,error:report.error,destination});
