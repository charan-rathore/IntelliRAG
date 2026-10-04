// Compares plain Dijkstra and guided A* for point-to-point routes over a synthetic semantic graph.
// Run: npx tsx scripts/benchmark-guided-routing.ts
import { guidedPath, shortestPath } from "../src/lib/rag/graphify/astar";
import { randomGraph, rng } from "../src/lib/rag/graphify/astar-fixture";

const rows: string[] = [];
for (const [count, dim] of [
  [256, 16],
  [256, 64],
  [1000, 16],
  [1000, 64],
] as const) {
  let pairs = 0,
    baseExp = 0,
    guidedExp = 0,
    baseMs = 0,
    guidedMs = 0,
    mismatches = 0,
    fewer = 0;
  for (const seed of [11, 12, 13]) {
    const { nodes, edges } = randomGraph(seed, count, dim);
    const r = rng(seed * 31);
    for (let i = 0; i < 100; i++) {
      const a = nodes[Math.floor(r() * count)].id;
      const b = nodes[Math.floor(r() * count)].id;
      let t = performance.now();
      const base = shortestPath(edges, a, b);
      baseMs += performance.now() - t;
      t = performance.now();
      const guided = guidedPath(nodes, edges, a, b);
      guidedMs += performance.now() - t;
      if (!base.found || a === b) continue;
      pairs++;
      baseExp += base.expanded;
      guidedExp += guided.expanded;
      if (guided.expanded < base.expanded) fewer++;
      if (Math.abs(guided.cost - base.cost) > 1e-9) mismatches++;
    }
  }
  rows.push(
    `| ${count} | ${dim} | ${pairs} | ${(baseExp / pairs).toFixed(1)} | ${(guidedExp / pairs).toFixed(1)} | ${(100 * (1 - guidedExp / baseExp)).toFixed(1)}% | ${fewer}/${pairs} | ${mismatches} | ${(baseMs / 300).toFixed(3)} | ${(guidedMs / 300).toFixed(3)} |`,
  );
}
console.log(
  "| nodes | dim | routes | Dijkstra expanded | A* expanded | fewer | A* strictly fewer | cost mismatches | Dijkstra ms | A* ms |",
);
console.log("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
console.log(rows.join("\n"));
