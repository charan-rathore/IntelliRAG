import type { CacheEntry, GraphJson, GraphNode, GraphState } from "./schema";
import { queryTokens } from "./extract";
import { scopeGraph } from "./edits";

function idfVocab(graph: GraphJson): Map<string, number> {
  const df = new Map<string, number>();
  for (const n of graph.nodes) {
    const bag = new Set(queryTokens(n.label));
    for (const t of bag) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(1, graph.nodes.length);
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log(n / c));
  return idf;
}

function scoreNode(node: GraphNode, terms: string[], idf: Map<string, number>): number {
  const label = node.label.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (label.includes(t)) s += idf.get(t) ?? 1;
  }
  return s;
}

/** Graphify query: IDF-weighted label match, then BFS depth 3. */
export function queryGraph(graph: GraphJson, question: string, budget = 24) {
  const terms = queryTokens(question);
  const idf = idfVocab(graph);
  const scored = graph.nodes
    .map((n) => ({ n, s: scoreNode(n, terms, idf) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  budget = Math.max(0, Math.floor(budget));
  const start = scored.slice(0, Math.min(3, budget)).map((x) => x.n);
  const startIds = new Set(start.map((n) => n.id));
  const seen = new Set(startIds);
  const order = [...start.map((n) => n.id)];
  const adjacency = new Map<string, string[]>();
  for (const e of graph.links) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    if (!adjacency.has(e.target)) adjacency.set(e.target, []);
    adjacency.get(e.source)!.push(e.target);
    adjacency.get(e.target)!.push(e.source);
  }
  let frontier = [...startIds];
  for (let depth = 0; depth < 3 && order.length < budget; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adjacency.get(id) ?? []) {
        if (order.length >= budget) break;
        if (seen.has(nb)) continue;
        seen.add(nb);
        order.push(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = order.map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n)).slice(0, budget);
  const ids = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter((e) => ids.has(e.source) && ids.has(e.target));
  const slugs = [
    ...new Set(nodes.map((n) => n.slug).filter((s): s is string => Boolean(s))),
  ];
  return { start, nodes, links, slugs, terms };
}

/** Cache identity preserves numbers, negation, punctuation and ordering. No fuzzy answer reuse. */
export function lookupCache(state: GraphState, question: string, corpusId = "seed-lab", policy = ""): CacheEntry | null {
  const normalize = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ");
  const exact = state.cache.find(c => (c.corpusId ?? "seed-lab") === corpusId && (c.policy ?? "") === policy && normalize(c.question) === normalize(question));
  return exact?.answer && exact.outcome !== "dead_end" && exact.outcome !== "corrected" ? exact : null;
}

export function preferredSlugs(state: GraphState, question: string, corpusId = "all"): string[] {
  const q = queryGraph(scopeGraph(state.graph, corpusId), question);
  const preferred = new Set(
    (state.learning?.nodes ?? [])
      .filter((n) => n.verdict === "preferred")
      .map((n) => n.id),
  );
  const slugs: string[] = [];
  for (const node of q.nodes) {
    if (node.kind === "document" && node.slug && (preferred.has(node.id) || q.slugs.includes(node.slug))) {
      if (!slugs.includes(node.slug)) slugs.push(node.slug);
    }
  }
  return slugs.slice(0, 6);
}
