import type { CacheEntry, GraphJson, GraphNode, GraphState } from "./schema";
import { CACHE_JACCARD } from "./schema";
import { queryTokens } from "./extract";

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

function neighbors(graph: GraphJson, id: string): string[] {
  const out: string[] = [];
  for (const e of graph.links) {
    if (e.source === id) out.push(e.target);
    else if (e.target === id) out.push(e.source);
  }
  return out;
}

/** Graphify query: IDF-weighted label match, then BFS depth 3. */
export function queryGraph(graph: GraphJson, question: string, budget = 24) {
  const terms = queryTokens(question);
  const idf = idfVocab(graph);
  const scored = graph.nodes
    .map((n) => ({ n, s: scoreNode(n, terms, idf) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const start = scored.slice(0, 3).map((x) => x.n);
  const startIds = new Set(start.map((n) => n.id));
  const seen = new Set(startIds);
  const order = [...start.map((n) => n.id)];
  let frontier = [...startIds];
  for (let depth = 0; depth < 3; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of neighbors(graph, id)) {
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

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function lookupCache(state: GraphState, question: string, corpusId?: string): CacheEntry | null {
  const terms = queryTokens(question);
  if (!terms.length || !state.cache.length) return null;
  const scoped = state.cache.filter((c) => (c.corpusId ?? "seed-lab") === (corpusId ?? "seed-lab"));
  const exact = scoped.find((c) => queryTokens(c.question).join(" ") === terms.join(" "));
  if (exact && exact.outcome !== "dead_end" && exact.answer) return exact;
  let best: { entry: CacheEntry; score: number } | null = null;
  for (const entry of scoped) {
    if (entry.outcome !== "useful" || !entry.answer) continue;
    const score = jaccard(terms, queryTokens(entry.question));
    if (score < CACHE_JACCARD) continue;
    if (!best || score > best.score) best = { entry, score };
  }
  return best?.entry ?? null;
}

export function preferredSlugs(state: GraphState, question: string): string[] {
  const q = queryGraph(state.graph, question);
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
  for (const id of preferred) {
    const node = state.graph.nodes.find((n) => n.id === id);
    if (node?.slug && !slugs.includes(node.slug)) slugs.push(node.slug);
  }
  return slugs.slice(0, 6);
}
