import { cosineSimilarity } from "../text";
import type { VectorEdge, VectorNode } from "./vector";

export type GuidedPath = {
  found: boolean;
  cost: number;
  path: string[];
  /** Nodes taken off the queue and expanded. The honest measure of search work. */
  expanded: number;
};

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

/** Small binary min-heap keyed by priority. */
class Heap<T> {
  private items: Array<{ p: number; v: T }> = [];
  get size() {
    return this.items.length;
  }
  push(p: number, v: T) {
    const a = this.items;
    a.push({ p, v });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].p <= a[i].p) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): { p: number; v: T } | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Lower bound on the remaining path cost to the goal, built from the graph itself.
 *
 * Edge cost is 1 - cos(angle), which is NOT a metric, so using 1 - cos(node, goal)
 * directly as a heuristic can overestimate and return a worse route. This bound
 * is safe instead: the angle to the goal can shrink by at most one edge angle per
 * hop (triangle inequality on the sphere), so a route needs at least
 * k = ceil(angle / widest edge angle) hops. Cost is convex in the hop angle, so k
 * hops covering that angle cost at least k * (1 - cos(angle / k)), and every hop
 * costs at least the cheapest edge. Falls back to 0 (plain Dijkstra) when the
 * convexity range does not hold.
 */
export function makeHeuristic(nodes: VectorNode[], edges: VectorEdge[], goalId: string) {
  const goal = nodes.find((n) => n.id === goalId);
  if (!goal || !edges.length) return () => 0;
  let minCost = Infinity;
  let minSim = 1;
  for (const e of edges) {
    minCost = Math.min(minCost, e.cost);
    minSim = Math.min(minSim, clamp(e.similarity));
  }
  if (!(minSim > 0) || !Number.isFinite(minCost)) return () => 0;
  const widest = Math.acos(minSim); // <= pi/2
  const vectors = new Map(nodes.map((n) => [n.id, n.vector]));
  return (id: string) => {
    const v = vectors.get(id);
    if (!v || id === goalId) return 0;
    const angle = Math.acos(clamp(cosineSimilarity(v, goal.vector)));
    const k = Math.max(1, Math.ceil(angle / widest - 1e-9));
    const sameK = Math.max(k * minCost, k * (1 - Math.cos(angle / k)));
    const moreHops = (k + 1) * minCost;
    return Math.max(0, Math.min(sameK, moreHops) - 1e-12);
  };
}

/**
 * Point-to-point shortest path over the semantic graph. With a heuristic this is
 * A*, a goal-directed best-first search; with the default zero heuristic it is
 * plain Dijkstra, kept here as the baseline for tests and benchmarks.
 * Stale queue entries are skipped and nodes may be reopened, so the answer stays
 * optimal even if a heuristic is not consistent.
 */
export function shortestPath(
  edges: VectorEdge[],
  startId: string,
  goalId: string,
  heuristic: (id: string) => number = () => 0,
  maxCost = Infinity,
): GuidedPath {
  const adjacency = new Map<string, Array<{ id: string; cost: number }>>();
  for (const e of edges) {
    if (!Number.isFinite(e.cost) || e.cost < 0) continue;
    for (const [a, b] of [
      [e.source, e.target],
      [e.target, e.source],
    ]) {
      const list = adjacency.get(a) ?? [];
      list.push({ id: b, cost: e.cost });
      adjacency.set(a, list);
    }
  }
  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const heap = new Heap<string>();
  heap.push(heuristic(startId), startId);
  let expanded = 0;
  while (heap.size) {
    const { p, v: id } = heap.pop()!;
    const d = dist.get(id)!;
    if (p > d + heuristic(id) + 1e-12) continue; // stale entry
    if (id === goalId) {
      const path = [id];
      while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
      return { found: true, cost: d, path, expanded };
    }
    expanded += 1;
    for (const edge of adjacency.get(id) ?? []) {
      const next = d + edge.cost;
      if (next > maxCost || next >= (dist.get(edge.id) ?? Infinity)) continue;
      dist.set(edge.id, next);
      prev.set(edge.id, id);
      heap.push(next + heuristic(edge.id), edge.id);
    }
  }
  return { found: false, cost: Infinity, path: [], expanded };
}

/** Guided (A*) route between two learned chunk nodes. */
export function guidedPath(
  nodes: VectorNode[],
  edges: VectorEdge[],
  startId: string,
  goalId: string,
  maxCost = Infinity,
): GuidedPath {
  return shortestPath(edges, startId, goalId, makeHeuristic(nodes, edges, goalId), maxCost);
}
