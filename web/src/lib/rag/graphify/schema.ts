/** Graphify-compatible graph.json types (node-link, confidence-tagged edges). */

export type GraphConfidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export type GraphOutcome = "useful" | "dead_end" | "corrected";

export type GraphNodeKind = "document" | "heading" | "term" | "query";

export type GraphNode = {
  id: string;
  label: string;
  source_file: string;
  source_location: string;
  file_type: string;
  kind: GraphNodeKind;
  community: number;
  slug?: string;
};

export type GraphLink = {
  source: string;
  target: string;
  relation: string;
  confidence: GraphConfidence;
};

/** NetworkX node-link JSON, the same shape graphify export.to_json writes. */
export type GraphJson = {
  directed: false;
  multigraph: false;
  graph: { built_at?: string; generator: "intellirag-graphify" };
  nodes: GraphNode[];
  links: GraphLink[];
};

export type MemoryDoc = {
  id: string;
  type: "query";
  date: string;
  question: string;
  questionHash: string;
  answer: string;
  outcome: GraphOutcome | null;
  correction: string | null;
  source_nodes: string[];
  source_slugs: string[];
};

export type CacheEntry = {
  questionHash: string;
  question: string;
  answer: string;
  sourceSlugs: string[];
  sourceNodes: string[];
  coverage: string;
  citations: unknown;
  candidates: unknown;
  chunks: unknown;
  contextTokens: number;
  outcome: GraphOutcome | null;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
  corpusId?: string;
};

export type LearningNode = {
  id: string;
  label: string;
  verdict: "preferred" | "tentative" | "contested" | "dead_end";
  score: number;
  useful: number;
  dead_end: number;
  corrected: number;
};

export type LearningSidecar = {
  schema: 1;
  generatedAt: string;
  halfLifeDays: number;
  minCorroboration: number;
  nodes: LearningNode[];
};

export type GraphState = {
  graph: GraphJson;
  memory: MemoryDoc[];
  cache: CacheEntry[];
  learning: LearningSidecar | null;
};

export const GRAPHIFY_HALF_LIFE_DAYS = 30;
export const GRAPHIFY_MIN_CORROBORATION = 2;
export const CACHE_JACCARD = 0.75;
