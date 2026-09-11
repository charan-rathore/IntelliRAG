import { z } from "zod";
import type { GraphJson, GraphLink } from "./schema";

export const graphEditsSchema = z.object({
  labels: z.array(z.object({ id: z.string().min(1).max(600), label: z.string().trim().min(1).max(160) })).max(100).default([]),
  edges: z.array(z.object({
    source: z.string().min(1).max(600), target: z.string().min(1).max(600),
    relation: z.string().trim().min(1).max(80), disabled: z.boolean().default(false),
  })).max(200).default([]),
});
export type GraphEdits = z.infer<typeof graphEditsSchema>;
export const EMPTY_EDITS: GraphEdits = { labels: [], edges: [] };
export const GRAPH_EDITS_STORAGE = "intellirag.graph-edits.v1";
export function loadGraphEdits(): GraphEdits {
  try { return graphEditsSchema.parse(JSON.parse(localStorage.getItem(GRAPH_EDITS_STORAGE) ?? "{}")); }
  catch { return { labels: [], edges: [] }; }
}
export function edgeKey(edge: Pick<GraphLink, "source" | "target">) {
  return JSON.stringify([edge.source, edge.target].sort());
}

/** Shared terms survive only when attached to a source in this scope. Query memory cannot bridge corpora. */
export function scopeGraph(graph: GraphJson, corpusId: string): GraphJson {
  if (corpusId === "all") return graph;
  const ids = new Set(graph.nodes.filter(n => n.kind !== "term" && (n.corpusId ?? "seed-lab") === corpusId).map(n => n.id));
  const terms = new Set(graph.nodes.filter(n => n.kind === "term").map(n => n.id));
  for (const e of graph.links) {
    if (ids.has(e.source) && terms.has(e.target)) ids.add(e.target);
    if (ids.has(e.target) && terms.has(e.source)) ids.add(e.source);
  }
  return { ...graph, nodes: graph.nodes.filter(n => ids.has(n.id)), links: graph.links.filter(e => ids.has(e.source) && ids.has(e.target)) };
}

/** Edits guide traversal only. Original source text and citation locations stay intact. */
export function applyGraphEdits(graph: GraphJson, edits: GraphEdits): GraphJson {
  const ids = new Set(graph.nodes.map(n => n.id));
  const labels = new Map(edits.labels.map(n => [n.id, n.label]));
  const links = new Map(graph.links.map(e => [edgeKey(e), e]));
  for (const e of edits.edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    if (e.disabled) links.delete(edgeKey(e));
    else links.set(edgeKey(e), { source: e.source, target: e.target, relation: e.relation, confidence: "USER_EDITED" });
  }
  return { ...graph, nodes: graph.nodes.map(n => ({ ...n, label: labels.get(n.id) ?? n.label })), links: [...links.values()] };
}

export type GraphTrace = {
  nodes: GraphJson["nodes"];
  links: GraphJson["links"];
  slugs: string[];
  cache: "hit" | "miss" | "bypass";
  durationMs: number;
};
