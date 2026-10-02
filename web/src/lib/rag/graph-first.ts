import { retrieveFromRows, type SearchRow, type RetrieveResult } from "./retrieve-core";
import { queryChunkSupport } from "./evidence";
import { validateVectorRows, type VectorNode, type VectorLookup } from "./graphify/vector";
import type { CorpusScope } from "./corpus-scope";
import type { StorageStatus, RetrievalMode } from "./types";

export type VectorTrace = VectorLookup & {
  nodes?: Array<Omit<VectorNode, "vector" | "vectorHash">>;
  edges?: import("./graphify/vector").VectorEdge[];
  route: "graph" | "full";
  fetched: number;
  durationMs: number;
};
/** Dependency injection proves which storage path ran, not merely which label was emitted. */
export async function graphFirstRetrieve(
  opts: {
    query: string;
    queryVector: number[] | null;
    embeddingModel: string | null;
    mode: RetrievalMode;
    topK: number;
    storage: StorageStatus;
    scope: CorpusScope;
    preferredSlugs?: string[];
  },
  deps: {
    lookup: (
      vector: number[],
      model: string,
      corpus: string,
    ) => Promise<{
      lookup: VectorLookup;
      nodes: VectorNode[];
      edges?: import("./graphify/vector").VectorEdge[];
    }>;
    fetch: (ids: string[], scope: CorpusScope) => Promise<SearchRow[]>;
    full: () => Promise<RetrieveResult>;
  },
): Promise<{ result: RetrieveResult; vectorTrace: VectorTrace }> {
  const started = performance.now();
  let reason = "dense-unavailable";
  let fetched = 0;
  let lookup: VectorLookup = {
    reason,
    roots: [],
    paths: [],
    compared: 0,
    model: opts.embeddingModel ?? "none",
    dimension: opts.queryVector?.length ?? 0,
  };
  try {
    if (
      opts.mode !== "keyword" &&
      opts.queryVector &&
      opts.embeddingModel &&
      opts.storage.denseAvailable
    ) {
      const graph = await deps.lookup(
        opts.queryVector,
        opts.embeddingModel,
        opts.scope.kind === "all" ? "all" : opts.scope.corpusId,
      );
      lookup = graph.lookup;
      reason = lookup.reason;
      const traceNodes = graph.nodes.map(({ vector, vectorHash, ...n }) => n);
      if (lookup.paths.length) {
        const rows = await deps.fetch(
          lookup.paths.map((p) => p.chunkId),
          opts.scope,
        );
        fetched = rows.length;
        if (validateVectorRows(graph.nodes, rows)) {
          const result = retrieveFromRows({
            ...opts,
            rows,
            corpusScope: opts.scope,
            graphPathCosts: new Map(lookup.paths.map((p) => [p.chunkId, p.cost])),
          });
          const support = queryChunkSupport(opts.query, result.chunks);
          // Conservative local coverage proxy, not a probability of correctness or full-index recall guarantee.
          if (
            result.evidence === "positive" &&
            result.chunks.length > 0 &&
            support.terms.length >= 2 &&
            support.ratio >= 0.8 &&
            !/\b(compare|versus|across|all sources|every|both)\b/i.test(opts.query)
          ) {
            return {
              result,
              vectorTrace: {
                ...lookup,
                nodes: traceNodes,
                edges: graph.edges,
                reason: "positive-evidence-and-80pct-query-support",
                route: "graph",
                fetched,
                durationMs: performance.now() - started,
              },
            };
          }
          reason = "weak-graph-evidence-or-query-coverage";
        } else reason = "stale-or-missing-vector-reference";
      }
    }
  } catch {
    reason = "graph-lookup-or-fetch-error";
  }
  const result = await deps.full();
  return {
    result,
    vectorTrace: {
      ...lookup,
      reason,
      route: "full",
      fetched,
      durationMs: performance.now() - started,
    },
  };
}
