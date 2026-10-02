import { createHash } from "node:crypto";
import { cosineSimilarity, parseEmbedding } from "../text";
import type { SearchRow } from "../retrieve-core";

/** Bounded learned vector working set, not a second copy of the whole index. */
export const VECTOR_LIMIT = 256;
export const GRAPH_SEED_COSINE = 0.88;
export const GRAPH_MEMBER_COSINE = 0.7;
export const GRAPH_MAX_COST = 0.45;
export type VectorNode = {
  id: string;
  chunkId: string;
  documentId: string;
  slug: string;
  corpusId: string;
  contentHash: string;
  model: string;
  dimension: number;
  vectorHash: string;
  vector: number[];
  label: string;
  learnedAt: string;
};
export type VectorEdge = { source: string; target: string; similarity: number; cost: number };
export type VectorMemory = { schema: 1; nodes: VectorNode[]; edges: VectorEdge[] };
export type VectorPath = {
  id: string;
  chunkId: string;
  similarity: number;
  cost: number;
  path: string[];
};
export type VectorLookup = {
  reason: string;
  roots: string[];
  paths: VectorPath[];
  compared: number;
  model: string;
  dimension: number;
};
export const emptyVectorMemory = (): VectorMemory => ({ schema: 1, nodes: [], edges: [] });
export const vectorHash = (v: number[]) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const valid = (v: number[]) => v.length > 0 && v.every(Number.isFinite) && v.some((x) => x !== 0);
const clamp = (x: number) => Math.max(-1, Math.min(1, x));
/** Cosine distance is a dissimilarity cost, not geographic distance or a probability. */
export const semanticCost = (similarity: number) => Math.max(0.001, 1 - clamp(similarity));

export function learnVectors(
  memory: VectorMemory,
  rows: SearchRow[],
  model: string,
  dimension: number,
): VectorMemory {
  const incoming: VectorNode[] = [];
  for (const row of rows) {
    const vector = parseEmbedding(row.chunk.embedding);
    if (
      row.chunk.embedding_model !== model ||
      !vector ||
      vector.length !== dimension ||
      !valid(vector)
    )
      continue;
    incoming.push({
      id: `chunk:${row.corpusId}:${row.chunk.id}`,
      chunkId: row.chunk.id,
      documentId: row.chunk.document_id,
      slug: row.slug,
      corpusId: row.corpusId,
      contentHash: row.chunk.content_hash,
      model,
      dimension,
      vectorHash: vectorHash(vector),
      vector,
      label: `${row.title}: ${row.chunk.heading ?? row.chunk.ordinal}`,
      learnedAt: new Date().toISOString(),
    });
  }
  if (
    incoming.length &&
    incoming.every((n) =>
      memory.nodes.some(
        (old) =>
          old.id === n.id &&
          old.contentHash === n.contentHash &&
          old.model === n.model &&
          old.dimension === n.dimension &&
          old.vectorHash === n.vectorHash,
      ),
    )
  )
    return memory;
  const replace = new Set(incoming.map((n) => n.id));
  const nodes = [...incoming, ...memory.nodes.filter((n) => !replace.has(n.id))].slice(
    0,
    VECTOR_LIMIT,
  );
  const edges: VectorEdge[] = [];
  const seen = new Set<string>();
  for (const a of nodes) {
    const neighbors = nodes
      .filter(
        (b) =>
          a.id !== b.id &&
          a.corpusId === b.corpusId &&
          a.model === b.model &&
          a.dimension === b.dimension,
      )
      .map((b) => ({ b, similarity: clamp(cosineSimilarity(a.vector, b.vector)) }))
      .filter((x) => x.similarity >= GRAPH_MEMBER_COSINE)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 4);
    for (const { b, similarity } of neighbors) {
      const [source, target] = [a.id, b.id].sort();
      const key = JSON.stringify([source, target]);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target, similarity, cost: semanticCost(similarity) });
    }
  }
  return { schema: 1, nodes, edges };
}

/** Multi-source Dijkstra. Positive varying edge costs; path selection affects retrieval. */
export function dijkstra(
  ids: Set<string>,
  edges: VectorEdge[],
  seeds: Map<string, number>,
  maxCost = GRAPH_MAX_COST,
) {
  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const settled = new Set<string>();
  const adjacency = new Map<string, Array<{ id: string; cost: number }>>();
  for (const edge of edges) {
    if (
      !ids.has(edge.source) ||
      !ids.has(edge.target) ||
      !Number.isFinite(edge.cost) ||
      edge.cost < 0
    )
      continue;
    for (const [from, to] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ]) {
      const list = adjacency.get(from) ?? [];
      list.push({ id: to, cost: edge.cost });
      adjacency.set(from, list);
    }
  }
  for (const [id, cost] of seeds)
    if (ids.has(id) && Number.isFinite(cost) && cost >= 0) distances.set(id, cost);
  while (true) {
    let current: string | undefined;
    let best = Infinity;
    for (const [id, cost] of distances)
      if (!settled.has(id) && cost < best) {
        current = id;
        best = cost;
      }
    if (!current || best > maxCost) break;
    settled.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      const next = best + edge.cost;
      if (!settled.has(edge.id) && next <= maxCost && next < (distances.get(edge.id) ?? Infinity)) {
        distances.set(edge.id, next);
        previous.set(edge.id, current);
      }
    }
  }
  return [...settled].map((id) => {
    const path = [id];
    let cursor = id;
    while (previous.has(cursor)) {
      cursor = previous.get(cursor)!;
      path.unshift(cursor);
    }
    return { id, cost: distances.get(id)!, path };
  });
}

export function lookupVectors(
  memory: VectorMemory,
  queryVector: number[],
  model: string,
  corpusId: string,
  limit = 24,
): VectorLookup {
  const base = {
    roots: [] as string[],
    paths: [] as VectorPath[],
    compared: 0,
    model,
    dimension: queryVector.length,
  };
  if (!valid(queryVector)) return { ...base, reason: "invalid-query-vector" };
  const nodes = memory.nodes.filter(
    (n) =>
      (corpusId === "all" || n.corpusId === corpusId) &&
      n.model === model &&
      n.dimension === queryVector.length &&
      valid(n.vector) &&
      n.vector.length === n.dimension &&
      vectorHash(n.vector) === n.vectorHash,
  );
  const scores = new Map(nodes.map((n) => [n.id, clamp(cosineSimilarity(queryVector, n.vector))]));
  const matched = [...nodes].sort((a, b) => scores.get(b.id)! - scores.get(a.id)!);
  const best = matched.length ? scores.get(matched[0].id)! : -1;
  if (best < GRAPH_SEED_COSINE)
    return {
      ...base,
      compared: nodes.length,
      reason: nodes.length ? "weak-vector-match" : "no-compatible-learned-vectors",
    };
  const roots = matched
    .filter((n) => scores.get(n.id)! >= Math.max(GRAPH_SEED_COSINE, best - 0.02))
    .slice(0, 3);
  const paths = dijkstra(
    new Set(nodes.map((n) => n.id)),
    memory.edges,
    new Map(roots.map((n) => [n.id, semanticCost(scores.get(n.id)!)])),
  )
    .map((p) => ({
      ...p,
      chunkId: nodes.find((n) => n.id === p.id)!.chunkId,
      similarity: scores.get(p.id)!,
    }))
    .filter((p) => p.similarity >= GRAPH_MEMBER_COSINE)
    .sort((a, b) => a.cost - b.cost || b.similarity - a.similarity)
    .slice(0, limit);
  return {
    roots: roots.map((n) => n.id),
    paths,
    compared: nodes.length,
    model,
    dimension: queryVector.length,
    reason: "candidates",
  };
}

export function validateVectorRows(nodes: VectorNode[], rows: SearchRow[]): boolean {
  const byId = new Map(rows.map((r) => [r.chunk.id, r]));
  return (
    nodes.length > 0 &&
    nodes.every((n) => {
      const r = byId.get(n.chunkId);
      const v = r && parseEmbedding(r.chunk.embedding);
      return (
        !!r &&
        r.corpusId === n.corpusId &&
        r.chunk.document_id === n.documentId &&
        r.chunk.content_hash === n.contentHash &&
        r.chunk.embedding_model === n.model &&
        !!v &&
        v.length === n.dimension &&
        vectorHash(v) === n.vectorHash
      );
    })
  );
}
