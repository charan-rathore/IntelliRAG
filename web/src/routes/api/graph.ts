import { createFileRoute } from "@tanstack/react-router";
import { graphSnapshot } from "@/lib/rag/graphify/persist.server";
import { scopeGraph } from "@/lib/rag/graphify/edits";
export const Route = createFileRoute("/api/graph")({ server: { handlers: {
  GET: async ({ request }) => {
    const snapshot = await graphSnapshot();
    const graph = scopeGraph({ directed: false, multigraph: false, graph: { generator: "intellirag-graphify" }, nodes: snapshot.nodes, links: snapshot.links }, new URL(request.url).searchParams.get("corpus") || "all");
    return Response.json({ ...snapshot, ...graph, nodeCount: graph.nodes.length, edgeCount: graph.links.length }, { headers: { "Cache-Control": "no-store" } });
  },
} } });
