export const GENERATION_MODEL = "gemini-3.7-flash";
export const GENERATION_MODEL_OPENROUTER = "google/gemini-3.7-flash";
export const GENERATION_MODEL_XAI = "grok-4.5";
export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_MODEL_OPENROUTER = "google/gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768;
export const CHUNK_SIZE_TOKENS = 512;
export const CHUNK_OVERLAP_TOKENS = 25;
export const RRF_K = 60;
export const FRESHNESS_HALF_LIFE_DAYS = 30;
export const CONTEXT_TOKEN_BUDGET = 1400;
/**
 * Relative floor vs rank-1 *calibrated* score. This is NOT an absolute cosine
 * or "confidence" threshold. A candidate at 0.50 cosine can still be packed
 * if rank-1 is 0.70; a candidate at 0.40 is dropped if rank-1 is 0.90.
 * A "0.55 context cliff" does NOT mean candidates below similarity 0.55 are removed.
 */
export const CONTEXT_RELATIVE_FLOOR = 0.62;
/** Calibrated-score floor. Below this, a chunk never enters the model context. */
export const CONTEXT_ABSOLUTE_FLOOR = 0.24;
/** If rank-1 / rank-2 is at least this and the query is not multi-source, pack only top-1. */
export const CONTEXT_SOLO_MARGIN = 1.35;
/**
 * Deprecated alias for CONTEXT_RELATIVE_FLOOR (0.62). Not an absolute 0.55 cosine cut.
 * Does a 0.55 context cliff mean candidates below similarity 0.55 are removed? No.
 */
export const CONTEXT_SCORE_CLIFF = CONTEXT_RELATIVE_FLOOR;

export type RetrievalMode = "hybrid" | "dense" | "keyword";
export type SourceType = "seed" | "markdown" | "github" | "url";
export type QueryIntent = "greeting" | "capability" | "document";
export type KeyProvider = "google" | "openrouter" | "xai";
export type ConsoleView = "reading" | "lab";
export type CoverageKind = "grounded" | "general" | "refused" | "guide";
export type ChunkKind = "prose" | "code";
export type StorageBackend = "neon" | "pglite" | "ephemeral";
export type EvidenceKind = "positive" | "negative_not_found" | "insufficient" | "ambiguous";

export type ChannelRanks = {
  dense: number | null;
  keyword: number | null;
  fused: number | null;
  rerank: number;
};

export type EvidenceGate = {
  kind: EvidenceKind;
  note: string;
  probe?: string;
  supportTermCount: number;
  supportHitCount: number;
  packedTopDense: number | null;
  packedTopLexical: number;
  clearedForInsufficient: boolean;
  denseRank1Slug: string | null;
  rerankRank1Slug: string | null;
  denseRerankDisagree: boolean;
};

export type StageRank = {
  slug: string;
  title: string;
  score: number;
  rank: number;
  corpusId: string;
};

export type StorageStatus = {
  backend: StorageBackend;
  durable: boolean;
  denseAvailable: boolean;
  warning: string | null;
};

export type DenseDiagnostics = {
  queryEmbeddingProduced: boolean;
  compatibleStoredVectors: number;
  denseCandidatesProduced: number;
  embeddingModelMatch: boolean;
  embeddingModelExpected: string;
  skippedReason: string | null;
};

export type DocumentRow = {
  id: string;
  slug: string;
  title: string;
  source_type: SourceType;
  source_uri: string | null;
  body: string;
  content_hash: string;
  version: number;
  embedding_model: string | null;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
  origin_repo: string | null;
  origin_ref: string | null;
  corpus_id: string;
};

export type ChunkRow = {
  id: string;
  document_id: string;
  ordinal: number;
  text: string;
  token_count: number;
  heading: string | null;
  embedding: string | null;
  embedding_model: string | null;
  content_hash: string;
  created_at: string;
  filepath: string | null;
  language: string | null;
  symbol: string | null;
  chunk_kind: ChunkKind;
  corpus_id: string;
};

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  slug: string;
  title: string;
  text: string;
  heading: string | null;
  score: number;
  rank: number;
  retriever: RetrievalMode | "hybrid";
  tokenCount: number;
  indexedAt: string | null;
  embeddingModel: string | null;
  filepath: string | null;
  language: string | null;
  symbol: string | null;
  chunkKind: ChunkKind;
  corpusId: string;
};

export type RetrievalStageScores = {
  /** Raw cosine similarity in [-1, 1], typically ~0.2–0.9. Not max-normalized. */
  dense: number | null;
  /** Raw BM25 score (unbounded). Not max-normalized. */
  keyword: number | null;
  /** Raw Reciprocal Rank Fusion score ≈ 1/(60+rank) + …. Not a probability. */
  hybrid: number | null;
  /** Calibrated 0–1 mix of cosine + BM25 + IDF overlap + title match. */
  rerank: number | null;
};

export type RetrievalCandidate = RetrievedChunk & {
  scores: RetrievalStageScores;
  usedInContext: boolean;
  cited: boolean;
  overlapTerms: string[];
  dropReason?: string;
  ranks: ChannelRanks;
};

export type RetrievalTrace = {
  query: string;
  mode: RetrievalMode;
  candidateCount: number;
  usedCount: number;
  candidates: RetrievalCandidate[];
  dense?: DenseDiagnostics;
  evidence?: EvidenceKind;
  evidenceGate?: EvidenceGate;
  storage?: StorageStatus;
  scoreSemantics?: string;
  corpusId?: string | null;
  corpusScope?: "corpus" | "all";
};

export type Citation = {
  sourceIndex: number;
  chunkId: string;
  documentId: string;
  title: string;
  textSnippet: string;
};

export type LayerLatencies = Record<string, number>;

export type StaleReason =
  | "missing_embeddings"
  | "model_mismatch"
  | "never_indexed"
  | "age"
  | "ephemeral_storage";

export type DocumentHealth = {
  id: string;
  slug: string;
  title: string;
  sourceType: SourceType;
  sourceUri: string | null;
  version: number;
  chunkCount: number;
  embeddedCount: number;
  embeddingModel: string | null;
  indexedAt: string | null;
  updatedAt: string;
  staleReasons: StaleReason[];
  originRepo: string | null;
  originRef: string | null;
  corpusId: string;
};

export type AuditFinding = {
  id: string;
  severity: "critical" | "high" | "medium";
  title: string;
  original: string;
  liveFix: string;
};

export type UpsertInput = {
  title: string;
  body: string;
  sourceType: SourceType;
  sourceUri?: string;
  slugHint?: string;
  originRepo?: string | null;
  originRef?: string | null;
  filepath?: string | null;
  language?: string | null;
  chunkKind?: ChunkKind;
  corpusId?: string | null;
};
