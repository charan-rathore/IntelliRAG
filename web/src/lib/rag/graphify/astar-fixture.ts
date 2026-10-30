import { cosineSimilarity } from "../text";
import { semanticCost, vectorHash, type VectorEdge, type VectorNode } from "./vector";

/** Seeded synthetic semantic graph for tests and benchmarks. Same edge rule as learnVectors. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
export function randomGraph(seed: number, count: number, dim: number) {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const nodes: VectorNode[] = [];
  // points drift along a few noisy curves so clusters overlap and routes need several hops
  const base = Array.from({ length: dim }, gauss);
  const centers = Array.from({ length: 12 }, (_, i) =>
    base.map((x, j) => x + (i / 3) * Math.sin(j + i) + 0.3 * gauss()),
  );
  for (let i = 0; i < count; i++) {
    const c = centers[i % centers.length];
    const raw = c.map((x) => x + 0.9 * gauss());
    const norm = Math.hypot(...raw);
    const vector = raw.map((x) => x / norm);
    nodes.push({
      id: `n${i}`,
      chunkId: `c${i}`,
      documentId: "d",
      slug: "s",
      corpusId: "t",
      contentHash: "h",
      model: "m",
      dimension: dim,
      vectorHash: vectorHash(vector),
      vector,
      label: `n${i}`,
      learnedAt: "",
    });
  }
  // same edge rule as learnVectors: top 4 neighbours with cosine >= 0.70
  const edges: VectorEdge[] = [];
  const seen = new Set<string>();
  for (const a of nodes) {
    const near = nodes
      .filter((b) => b.id !== a.id)
      .map((b) => ({ b, s: cosineSimilarity(a.vector, b.vector) }))
      .filter((x) => x.s >= 0.7)
      .sort((x, y) => y.s - x.s)
      .slice(0, 4);
    for (const { b, s } of near) {
      const [source, target] = [a.id, b.id].sort();
      const key = source + "|" + target;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target, similarity: s, cost: semanticCost(s) });
    }
  }
  return { nodes, edges };
}
