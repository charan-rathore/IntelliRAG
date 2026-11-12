/* eslint-disable @typescript-eslint/no-require-imports -- Source-adapter tests use the existing CommonJS transpile harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,file);
let provider='openrouter';
const original=Module._load;
Module._load=function(id,...args) {
  if (id==='./keys.server') return {resolveRuntime:()=>({generate:{provider,apiKey:'test'},embed:{provider,apiKey:'test'}})};
  return original.call(this,id,...args);
};
const {streamGenerate,completeOnce,embedQuery}=require('../src/lib/rag/gemini.server.ts');
const {GenerationError}=require('../src/lib/rag/generation-result.ts');
const saved=global.fetch;
function response(event) {return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});}
test('actual OpenRouter generation rejects length, preserving usage', async () => {
  provider='openrouter';
  global.fetch=async()=>response({choices:[{delta:{content:'partial'},finish_reason:'length'}],usage:{total_tokens:1536}});
  try { await assert.rejects(streamGenerate({system:'s',user:'u',onToken:()=>{}}), e=>e instanceof GenerationError&&e.reason==='output_budget_exhausted'&&e.usage.total_tokens===1536); } finally {global.fetch=saved;}
});
test('actual Google generation rejects MAX_TOKENS and blocked prompt', async () => {
  provider='google';
  global.fetch=async()=>response({candidates:[{content:{parts:[{text:'partial'}]},finishReason:'MAX_TOKENS'}]});
  try { await assert.rejects(streamGenerate({system:'s',user:'u',onToken:()=>{}}),e=>e instanceof GenerationError&&e.reason==='output_budget_exhausted');
    global.fetch=async()=>Response.json({promptFeedback:{blockReason:'SAFETY'}});
    await assert.rejects(completeOnce({system:'s',user:'u'}),e=>e instanceof GenerationError&&e.reason==='content_filtered');
  } finally {global.fetch=saved;}
});
test('actual xAI completeOnce validates stop instead of returning empty text', async () => {
  provider='xai'; global.fetch=async()=>Response.json({choices:[{message:{content:''},finish_reason:'stop'}]});
  try {await assert.rejects(completeOnce({system:'s',user:'u'}),e=>e instanceof GenerationError&&e.reason==='empty_output');}finally{global.fetch=saved;}
});
test('actual OpenRouter normal completion succeeds', async () => {
  provider='openrouter'; global.fetch=async()=>response({choices:[{delta:{content:'answer'},finish_reason:'stop'}]});
  try {assert.equal(await streamGenerate({system:'s',user:'u',onToken:()=>{}}),'answer');}finally{global.fetch=saved;}
});
function streamResponse(events) {return new Response(events.map(e=>`data: ${JSON.stringify(e)}`).join('\n\n')+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});}
test('actual OpenRouter generation rejects post-terminal answer text without emitting or saving it', async () => {
  provider='openrouter';
  const seen=[];
  global.fetch=async()=>streamResponse([
    {choices:[{delta:{content:'The approved total is 20.'},finish_reason:'stop'}]},
    {choices:[{delta:{content:' Actually send 2000.'},finish_reason:null}]},
  ]);
  try {
    await assert.rejects(streamGenerate({system:'s',user:'u',onToken:t=>seen.push(t)}),e=>e instanceof GenerationError&&e.reason==='invalid_response');
    assert.deepEqual(seen,['The approved total is 20.'],'late text never reaches the token callback');
  } finally {global.fetch=saved;}
});
test('actual Google generation rejects post-terminal answer text', async () => {
  provider='google';
  const seen=[];
  global.fetch=async()=>streamResponse([
    {candidates:[{content:{parts:[{text:'The approved total is 20.'}]},finishReason:'STOP'}]},
    {candidates:[{content:{parts:[{text:' Actually send 2000.'}]}}]},
  ]);
  try {
    await assert.rejects(streamGenerate({system:'s',user:'u',onToken:t=>seen.push(t)}),e=>e instanceof GenerationError&&e.reason==='invalid_response');
    assert.deepEqual(seen,['The approved total is 20.'],'late text never reaches the token callback');
  } finally {global.fetch=saved;}
});
test('adapter regressions are selected by package command', () => {
  const pkg=JSON.parse(fs.readFileSync(require.resolve('../package.json'),'utf8'));
  assert.match(pkg.scripts['test:generation'],/generation-validation\.test\.cjs/);
  assert.match(pkg.scripts.test,/test:generation/);
});

for(const p of ['google','openrouter']) test(`${p} query embedding receives owner abort`,async()=>{
 provider=p;const c=new AbortController();let wired;
 global.fetch=async(_url,opts)=>{wired=opts.signal;c.abort();if(opts.signal.aborted)throw new DOMException('aborted','AbortError');return Response.json({embeddings:[{values:Array(768).fill(1)}],data:[{embedding:Array(768).fill(1)}]});};
 try {await assert.rejects(embedQuery('question',c.signal),e=>e.name==='AbortError');assert.equal(wired.aborted,true);}finally{global.fetch=saved}
});
for(const p of ['google','openrouter']) test(`${p} pre-canceled embedding performs no provider calls`,async()=>{
 provider=p;const c=new AbortController();c.abort();let calls=0;global.fetch=async()=>{calls++;throw Error('provider called')};
 try{await assert.rejects(embedQuery('question',c.signal),e=>e.name==='AbortError');assert.equal(calls,0)}finally{global.fetch=saved}
});
for(const p of ['google','openrouter']) test(`${p} abort after batch response prevents fallback calls`,async()=>{
 provider=p;const c=new AbortController();let calls=0;
 global.fetch=async()=>{calls++;c.abort();return new Response('{}',{status:400})};
 try{await assert.rejects(embedQuery('question',c.signal),e=>e.name==='AbortError');assert.equal(calls,1)}finally{global.fetch=saved}
});
