/* eslint-disable @typescript-eslint/no-require-imports */
// Actual graph-query CPU comparison. Synthetic corpus, no storage/model/network cost.
const ts = require('typescript');
const fs = require('node:fs');
const cp = require('node:child_process');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { extractCorpus } = require('../../src/lib/rag/graphify/extract.ts');
const fixed = require('../../src/lib/rag/graphify/query.ts');
const file = require.resolve('../../src/lib/rag/graphify/query.ts');
const wrapper = new Module(file);
wrapper.filename = file;
wrapper.paths = Module._nodeModulePaths(require('node:path').dirname(file));
wrapper._compile(ts.transpileModule(cp.execFileSync('git', ['show', `${process.argv[2] || 'origin/main'}:web/src/lib/rag/graphify/query.ts`], { encoding: 'utf8' }), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const graph = extractCorpus(Array.from({ length: 100 }, (_, i) => ({ slug: 'doc' + i, title: 'Queue ' + i, body: '## Timeout\nQueue task execution timeout with retries ' + i, corpus_id: 'test' })));
function run(mod, count) {
  const start = performance.now();
  for (let i = 0; i < count; i++) mod.queryGraph(graph, 'Queue timeout ' + i % 100);
  return performance.now() - start;
}
run(wrapper.exports, 500); run(fixed, 500);
const before = [], after = [];
for (let i = 0; i < 15; i++) {
  if (i % 2) { after.push(run(fixed, 1000)); before.push(run(wrapper.exports, 1000)); }
  else { before.push(run(wrapper.exports, 1000)); after.push(run(fixed, 1000)); }
}
const median = values => [...values].sort((a, b) => a - b)[7];
const ratio = median(after) / median(before);
console.log(JSON.stringify({ documents: 100, callsPerSample: 1000, samples: 15, before, after, beforeMedian: median(before), afterMedian: median(after), ratio }, null, 2));
if (ratio > 1.05) throw new Error('Graph CPU slowdown exceeds the 5% noise guard');
