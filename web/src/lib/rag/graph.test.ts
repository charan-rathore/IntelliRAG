import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCorpus } from "./graphify/extract";
import { lookupCache, queryGraph } from "./graphify/query";
import { applyGraphEdits, scopeGraph, graphEditsSchema } from "./graphify/edits";
import type { CacheEntry, GraphState } from "./graphify/schema";

const graph = extractCorpus([
  { slug: "alpha", title: "Orion queue", body: "## Retries\nOrion queue uses backoff and retries.", corpus_id: "a", source_uri: "https://github.com/acme/orion/blob/main/src/queue.md" },
  { slug: "beta", title: "Atlas worker", body: "## Delivery\nAtlas worker uses queue delivery.", corpus_id: "b" },
]);
test("graph scope cannot traverse a shared term into another corpus", () => {
  const scoped = scopeGraph(graph, "a");
  assert.deepEqual(queryGraph(scoped, "queue").slugs, ["alpha"]);
  assert.ok(scoped.links.every(e => scoped.nodes.some(n => n.id === e.source) && scoped.nodes.some(n => n.id === e.target)));
  assert.equal(scoped.nodes.find(n => n.id === "doc:alpha")?.source_file, "src/queue.md");
  assert.equal(scoped.nodes.find(n => n.kind === "heading")?.source_location, "L1");
});
test("manual edges and labels affect traversal without mutating source provenance", () => {
  const isolated = { ...graph, links: [] };
  const edits = graphEditsSchema.parse({ labels: [{ id: "doc:alpha", label: "Dispatch" }], edges: [{ source: "doc:alpha", target: "doc:beta", relation: "routes to" }] });
  const edited = applyGraphEdits(isolated, edits);
  assert.deepEqual(queryGraph(edited, "Dispatch").slugs, ["alpha", "beta"]);
  assert.equal(edited.links[0].confidence, "USER_EDITED");
  assert.equal(edited.nodes[0].sourceUri, graph.nodes[0].sourceUri);
  assert.equal(graph.nodes[0].label, "Orion queue");
  assert.equal(applyGraphEdits(edited, { labels: [], edges: [{ ...edits.edges[0], disabled: true }] }).links.length, 0);
  assert.equal(applyGraphEdits(scopeGraph(graph, "a"), edits).links.some(e => e.target === "doc:beta"), false);
});
test("answer cache isolates settings and corpus and preserves negation and numbers", () => {
  const entry = { question: "Retry 7 times?", answer: "Seven", policy: "keyword-5", corpusId: "a", outcome: null } as CacheEntry;
  const state: GraphState = { graph, memory: [], learning: null, cache: [entry] };
  assert.equal(lookupCache(state, " Retry 7 times? ", "a", "keyword-5"), entry);
  for (const [q, scope, policy] of [["Retry 9 times?", "a", "keyword-5"], ["Not retry 7 times?", "a", "keyword-5"], [entry.question, "b", "keyword-5"], [entry.question, "a", "hybrid-5"], [entry.question, "a", "keyword-10"]]) {
    assert.equal(lookupCache(state, q, scope, policy), null);
  }
  assert.equal(lookupCache({ ...state, cache: [{ ...entry, outcome: "corrected" }] }, entry.question, "a", "keyword-5"), null);
});
test("graph edits reject oversized payloads and discard missing endpoints", () => {
  assert.equal(graphEditsSchema.safeParse({ labels: Array.from({ length: 101 }, () => ({ id: "a", label: "x" })) }).success, false);
  const edited = applyGraphEdits(graph, { labels: [], edges: [{ source: "doc:alpha", target: "missing", relation: "invented", disabled: false }] });
  assert.deepEqual(edited.links, graph.links);
});


test("code declarations and deep API headings retain exact source lines", () => {
  const code = extractCorpus([{ slug: "code", title: "index.js", body: "// public API\nexport default function pLimit(concurrency) {\n return concurrency;\n}", source_uri: "https://github.com/a/b/blob/123/index.js" }]);
  const symbol = code.nodes.find(n => n.kind === "symbol")!;
  assert.equal(symbol.label, "pLimit"); assert.equal(symbol.source_location, "L2");
  assert.equal(symbol.file_type, "js"); assert.equal(code.links[0].relation, "declares");
  const markdown = extractCorpus([{ slug: "docs", title: "API", body: "# API\n#### retries\nDefault: 10\n```md\n## fake heading\n```" }]);
  assert.ok(markdown.nodes.some(n => n.label === "retries" && n.source_location === "L2"));
  assert.ok(!markdown.nodes.some(n => n.label === "fake heading"));
});

test("repeated votes do not promote a source, and corrections revoke preference", async () => {
  const { reflect } = await import('./graphify/reflect');
  const now = Date.parse('2026-09-14T00:00:00Z');
  const memory = (questionHash: string, outcome: 'useful' | 'corrected', date = '2026-09-13T00:00:00Z') => ({ id: questionHash, type: 'query' as const, corpusId: 'a', questionHash, question: questionHash, date, answer: 'Evidence', outcome, correction: null, source_nodes: ['doc:alpha'], source_slugs: ['alpha'] });
  const state: GraphState = { graph, memory: [memory('same', 'useful'), memory('same', 'useful')], cache: [], learning: null };
  assert.equal(reflect(state, now).nodes[0].verdict, 'tentative');
  state.memory.push(memory('independent', 'useful'));
  assert.equal(reflect(state, now).nodes[0].verdict, 'preferred');
  state.memory.unshift(memory('same', 'corrected', '2026-09-14T00:00:00Z'));
  const learned = reflect(state, now).nodes[0];
  assert.equal(learned.verdict, 'contested');
  assert.equal(learned.useful, 1); assert.equal(learned.corrected, 1);
});

test("contested sources lose their graph boost while staying available as evidence", async () => {
  const { preferredSlugs } = await import('./graphify/query');
  const state: GraphState = { graph, memory: [], cache: [], learning: { schema: 1, generatedAt: '', halfLifeDays: 30, minCorroboration: 2, nodes: [{ id: 'doc:alpha', label: 'Orion queue', verdict: 'contested', score: 1, useful: 2, dead_end: 0, corrected: 1 }] } };
  assert.ok(!preferredSlugs(state, 'Orion queue').includes('alpha'));
  assert.ok(queryGraph(state.graph, 'Orion queue').slugs.includes('alpha'));
});
