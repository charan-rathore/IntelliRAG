import type { GraphNode } from "./schema.ts";

export const MEMORY_VIEWS = [
  { id: "sources", label: "Sources" },
  { id: "questions", label: "Saved questions" },
  { id: "vectors", label: "Vector memory" },
  { id: "all", label: "All nodes" },
] as const;
export type MemoryView = typeof MEMORY_VIEWS[number]["id"];

export function matchesMemoryView(node: GraphNode, view: MemoryView): boolean {
  return view === "all" || node.kind === ({ sources: "document", questions: "query", vectors: "chunk" } as const)[view];
}

export function explorerNodes(nodes: GraphNode[], view: MemoryView, search: string): GraphNode[] {
  const query = search.normalize("NFKC").trim().toLocaleLowerCase();
  return nodes.filter(node => matchesMemoryView(node, view) && (!query ||
    [node.label, node.source_file, node.source_location].some(value => value.normalize("NFKC").toLocaleLowerCase().includes(query))));
}
