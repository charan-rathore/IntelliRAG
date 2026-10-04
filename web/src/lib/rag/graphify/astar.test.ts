import { test } from "node:test";
import assert from "node:assert/strict";
import { guidedPath, shortestPath, makeHeuristic } from "./astar";
import { randomGraph, rng } from "./astar-fixture";
import { semanticCost, vectorHash, type VectorNode } from "./vector";

test("A* matches plain Dijkstra cost on every reachable pair across random graphs", () => {
  let compared = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const { nodes, edges } = randomGraph(seed, 120, 16);
    const r = rng(seed * 7);
    for (let i = 0; i < 40; i++) {
      const a = nodes[Math.floor(r() * nodes.length)].id;
      const b = nodes[Math.floor(r() * nodes.length)].id;
      const base = shortestPath(edges, a, b);
      const guided = guidedPath(nodes, edges, a, b);
      assert.equal(guided.found, base.found);
      if (base.found) {
        assert.ok(Math.abs(guided.cost - base.cost) < 1e-9, `${a}->${b}`);
        assert.equal(guided.path[0], a);
        assert.equal(guided.path.at(-1), b);
        compared++;
      }
    }
  }
  assert.ok(compared > 50, "enough reachable pairs were checked");
});

test("heuristic never overestimates the true remaining cost", () => {
  const { nodes, edges } = randomGraph(9, 120, 16);
  for (const goal of nodes.slice(0, 10)) {
    const h = makeHeuristic(nodes, edges, goal.id);
    for (const n of nodes) {
      const real = shortestPath(edges, n.id, goal.id);
      if (real.found) assert.ok(h(n.id) <= real.cost + 1e-9);
    }
  }
});

test("A* prefers the cheaper multihop route over an expensive direct edge", () => {
  const mk = (id: string, v: number[]): VectorNode => ({
    id,
    chunkId: id,
    documentId: id,
    slug: id,
    corpusId: "t",
    contentHash: id,
    model: "m",
    dimension: 2,
    vectorHash: vectorHash(v),
    vector: v,
    label: id,
    learnedAt: "",
  });
  const nodes = [mk("a", [1, 0]), mk("b", [0.9, 0.436]), mk("c", [0.72, 0.694])];
  const e = (s: string, t: string, sim: number) => ({
    source: s,
    target: t,
    similarity: sim,
    cost: semanticCost(sim),
  });
  const edges = [e("a", "c", 0.72), e("a", "b", 0.9), e("b", "c", 0.97)];
  const got = guidedPath(nodes, edges, "a", "c");
  assert.deepEqual(got.path, ["a", "b", "c"]);
});

test("unreachable goal, same node, and cost cap behave", () => {
  const { nodes, edges } = randomGraph(3, 40, 16);
  assert.deepEqual(guidedPath(nodes, edges, "n0", "n0").path, ["n0"]);
  assert.equal(guidedPath(nodes, edges, "n0", "missing").found, false);
  assert.equal(guidedPath(nodes, [], "n0", "n1").found, false);
  assert.equal(guidedPath(nodes, edges, "n0", "n5", 1e-9).found, false);
});
