# Engineering Journal

Decisions, tradeoffs, and lessons learned during platform development.

---

## Phase 5: Indexing Architecture

**Date:** 2026-06-09

### Why

The first four phases built ingestion (Phase 1), async processing (Phase 2), chunking (Phase 3), and embedding infrastructure (Phase 4). But the pipeline had a critical gap: chunks existed only in memory after chunking, embeddings had no destination, and documents were stuck at CHUNKED state. Without indexing, the entire RAG pipeline is non-functional.

### What We Built

1. **Migration 005** - `chunks` table in Postgres with denormalized metadata columns, embedding tracking, and vector store tracking
2. **VectorStore Protocol** - Runtime-checkable Python protocol defining the interface any vector store backend must implement (add, search, delete, count)
3. **ChromaVectorStore** - ChromaDB-backed implementation with upsert semantics, metadata filtering, and SQLite persistence
4. **IndexingService** - Orchestrator that embeds chunks (via Embedder) and inserts vectors into the store, with all-or-nothing semantics per document
5. **Updated ChunkRepository** - Postgres repository aligned with the new schema, supporting embedding/indexing status tracking
6. **33 unit + integration tests** - Covering CRUD, idempotency, validation, error handling, persistence, and metadata sanitization
7. **E2E validation script** - Full pipeline: document -> chunk -> embed -> index -> search -> cleanup

### Alternatives Considered

| Decision | Options Evaluated | Chosen | Rationale |
|---|---|---|---|
| Vector store | ChromaDB, Qdrant, pgvector, SQLite-VSS | ChromaDB | Zero-infra (pip install), SQLite-backed, sufficient for <500K vectors. Qdrant needs Docker. |
| Chunk storage | Postgres-only, Vector-store-only, Dual storage | Dual storage | Postgres = system of record (lifecycle, joins). ChromaDB = search index. If ChromaDB breaks, rebuild from Postgres. |
| Metadata storage | Single JSONB column, Denormalized columns | Denormalized | Enables partial indexes, type-safe constraints, efficient filtered queries without JSON extraction |
| Indexing scope | Per-chunk, Per-document | Per-document (all-or-nothing) | Prevents partial indexing that returns incomplete results. Simpler failure handling. |

### Tradeoffs

**What we gained:**
- Zero-infrastructure vector search (ChromaDB is embedded, no Docker/containers)
- Idempotent indexing via upsert semantics
- Dual storage gives us both transactional lifecycle management AND vector search
- Full metadata in both stores enables filtered search in ChromaDB and analytical queries in Postgres

**What we sacrificed:**
- No horizontal scaling (ChromaDB is single-process)
- No HNSW tuning controls (ChromaDB abstracts this away)
- No vector quantization (ChromaDB uses float32 only)
- Dual storage means keeping two systems in sync (write amplification)

### Assumptions

1. **Scale**: We assume <500K vectors for V1. ChromaDB performance degrades beyond this.
2. **Concurrency**: Single writer (one indexing worker). ChromaDB doesn't support concurrent writers.
3. **Ollama availability**: Embedding generation requires Ollama running locally. The mock path exists for testing.
4. **Dimension stability**: We assume nomic-embed-text (768 dims) throughout V1. Model migration would require re-embedding all chunks.

### Risks

- **Disk growth**: Each vector = ~3KB (768 float32 + metadata). At 100K chunks = ~300MB. Monitor before scaling.
- **Model lock-in**: Changing embedding models requires re-embedding everything. The `embedding_model` column in the chunks table enables migration tracking.
- **ChromaDB maturity**: ChromaDB is newer than Qdrant/pgvector. May hit edge cases at scale.

### When to Upgrade

| Trigger | Action |
|---|---|
| >500K vectors | Migrate to Qdrant (Docker, HNSW tuning) |
| Need concurrent indexing workers | Qdrant or pgvector (supports multiple connections) |
| Need binary quantization | Qdrant (native support) |
| Need sub-10ms p99 search latency | Qdrant with optimized HNSW params |
| Need managed service | Qdrant Cloud or Pinecone |

### Production Gap Documentation

| Component | Our Implementation | Production Recommendation | Gap |
|---|---|---|---|
| Vector store | ChromaDB (embedded, SQLite) | Qdrant Cloud or Pinecone | No SLA, no replication, no horizontal scaling |
| Embeddings | Ollama nomic-embed-text | OpenAI text-embedding-3-large or Cohere | Lower MTEB scores, no GPU acceleration |
| Chunk storage | Local Postgres (pending Docker setup) | Managed RDS/Aurora | No automated backups, no failover |
| Index rebuild | Manual script | Automated pipeline with canary | No automated testing of index quality |

---

## Phase 6: Retrieval Layer

**Date:** 2026-07-06

### Why

Phase 5 made documents searchable via vector index, but search alone is not retrieval. Production RAG needs multiple retrieval strategies because dense embeddings miss exact keyword matches (error codes, API names, IDs) while keyword search misses semantic paraphrases. Hybrid retrieval combines both.

### What We Built

1. **DenseRetriever** - wraps IndexingService vector search with structured RetrievalResult
2. **KeywordRetriever** - pure-Python BM25 index, zero external deps, works offline
3. **HybridRetriever** - Reciprocal Rank Fusion (RRF) combining dense + keyword rankings
4. **RetrievalService** - unified facade with mode selection (dense/keyword/hybrid)
5. **RetrievalBenchmark** - standard IR metrics: Recall@K, Precision@K, MRR, NDCG@K
6. **Eval script** - `scripts/eval/run_retrieval_benchmark.py` compares all three retrievers
7. **Phase 5 completion** - ChunkRepository aligned to migration 005, ProcessingPipeline wired, Celery processing task added
8. **Tests** - retrieval layer tests + chunk repository schema tests

### Alternatives Considered

| Decision | Options | Chosen | Rationale |
|---|---|---|---|
| Keyword search | Postgres FTS, Elasticsearch, in-memory BM25 | In-memory BM25 | Zero infra, sufficient for <100K chunks locally. FTS adds migration complexity. |
| Hybrid fusion | Weighted sum, RRF, learned reranker | RRF (k=60) | No score normalization needed between dense and BM25. Robust, parameter-free. |
| Retrieval API | Direct vector store access, service facade | RetrievalService | Single entry point for query API and benchmarks. |

### Benchmark Results (mock embeddings, built-in corpus)

Run `PYTHONPATH=rag-platform python scripts/eval/run_retrieval_benchmark.py` to reproduce.

Expected pattern with real Ollama embeddings:
- **Keyword** wins on exact term matches (error codes, function names)
- **Dense** wins on paraphrased questions
- **Hybrid** should match or beat both on average MRR

### Tradeoffs

**Gained:**
- Three retrieval modes with benchmark comparison
- Standard IR metrics for objective quality measurement
- Full pipeline from REGISTERED to PUBLISHED

**Sacrificed:**
- BM25 index is in-memory (rebuilt from Postgres on startup)
- No cross-encoder reranking yet (Phase 7)
- Mock embedding benchmark may not reflect real Ollama quality

### Production Gap

| Component | Local | Production | Gap |
|---|---|---|---|
| Keyword index | In-memory BM25 | Elasticsearch BM25 or Postgres FTS | No persistence, no distributed search |
| Hybrid fusion | RRF | Learned fusion or Cohere Rerank | No score calibration |
| Retrieval eval | Local benchmark script | Continuous eval pipeline with held-out set | Manual, not automated in CI |

### Next: Phase 7 Reranking

Cross-encoder reranking on top of hybrid retrieval. Benchmark with MRR before/after reranking to quantify lift.

---

## Phase 7: Reranking Layer

**Date:** 2026-07-06

### Why

Retrieval scores (cosine similarity, BM25) treat query and document independently. Cross-encoders jointly encode (query, chunk) pairs, capturing interaction effects that bi-encoders miss. This is the standard second stage in production multi-stage retrieval.

### What We Built

1. **Reranker protocol** - swappable interface for any reranking backend
2. **CrossEncoderReranker** - local ms-marco-MiniLM-L-6-v2 via sentence-transformers
3. **LexicalReranker** - token overlap reranker for fast tests and baselines
4. **RerankingService** - two-stage retrieve (top-N) then rerank (top-K) pipeline
5. **RerankingBenchmark** - comprehensive eval: MRR lift, NDCG lift, top-1 change rate, rank displacement, latency breakdown, ablation across retrieval modes
6. **Eval script** - `scripts/eval/run_reranking_benchmark.py`
7. **Architecture doc** - `docs/architecture/phase7-reranking-architecture.md`

### Evaluation Strategies

| Strategy | What It Measures | Why |
|---|---|---|
| MRR lift | Ranking quality before vs after rerank | Primary success metric for reranking |
| NDCG lift | Graded ranking improvement | Captures partial relevance |
| Recall@K preservation | Whether reranking loses relevant docs | Reranking should not drop recall |
| Precision@K gain | Relevant docs in top-K | Reranking should improve precision |
| Top-1 change rate | How often best result changes | Quantifies reranker impact |
| Rank displacement | Average position shift | Detects excessive reordering |
| Latency breakdown | Retrieval vs rerank time | Cost-awareness for production |
| Mode ablation | dense/keyword/hybrid + reranker | Find best pipeline combination |

### Alternatives Considered

| Decision | Chosen | Rationale |
|---|---|---|
| Reranker model | ms-marco-MiniLM-L-6-v2 | Best quality/size ratio for local CPU. 80MB, fast inference. |
| Paid reranking | Rejected (Cohere) | Budget constraint. Documented as production upgrade. |
| Test reranker | LexicalReranker | Zero model download, deterministic, fast CI. |

### Production Gap

| Local | Production | Upgrade Trigger |
|---|---|---|
| MiniLM cross-encoder on CPU | Cohere Rerank or GPU-served cross-encoder | MRR lift <5% or latency >500ms |
| Manual benchmark script | Continuous eval in CI | After query API ships |

### Next: Phase 8 Context Assembly

Select, deduplicate, and budget reranked chunks for LLM prompt. Measure token efficiency and context precision.

---

## Phase 8: Context Assembly

**Date:** 2026-07-06

### Why

Reranking gives an ordered candidate list, but LLMs have finite context windows. Sending all chunks wastes tokens on duplicates and low-value content. Context assembly maximizes answer-relevant information per token before Phase 9 generation.

### What We Built

1. **Deduplication** - Jaccard similarity (threshold 0.85) removes near-duplicate chunks
2. **MMR Selection** - Maximal Marginal Relevance balances relevance and diversity
3. **Token Budget Packing** - Greedy score-per-token knapsack fits chunks within budget
4. **Extractive Compression** - Query-guided sentence extraction preserves headers and key facts
5. **ContextAssemblyService** - Orchestrates 6 strategies: top_k, dedup_only, mmr, budget, full, full_compressed
6. **Citation formatting** - [Source N] labels ready for Phase 9 attribution
7. **ContextBenchmark** - 8 metrics with strategy comparison and budget sweep
8. **Eval script** - `scripts/eval/run_context_benchmark.py`

### Evaluation Strategies

| Metric | What It Measures |
|---|---|
| Context precision | Relevant tokens / total tokens in assembled context |
| Context recall | Reference phrase coverage in final context |
| Token efficiency | Precision * recall / budget utilization |
| Dedup rate | Fraction of redundant chunks removed |
| Budget utilization | Tokens used vs budget limit |
| Source diversity | Unique documents represented |
| Compression ratio | Tokens saved by extractive compression |
| Budget sweep | Optimal token budget inflection point |

### Alternatives Considered

| Decision | Chosen | Rationale |
|---|---|---|
| Dedup method | Jaccard on tokens | Zero deps, fast, sufficient for chunk-level overlap |
| Selection | MMR | No extra model, proven diversity selection |
| Compression | Extractive | Free, preserves facts; LLM summarize deferred to scale needs |
| Token counting | chars/4 heuristic | Consistent with chunking layer; tiktoken at Phase 9 |

### Production Gap

| Local | Production | Upgrade Trigger |
|---|---|---|
| chars/4 token estimate | Model-specific tokenizer | Before production LLM integration |
| Jaccard dedup | Embedding-based semantic dedup | When paraphrase dupes are common |
| Extractive compression | Ollama summarization | Budget <512 tokens |

### Next: Phase 9 LLM Generation

Feed AssembledContext into Ollama with citation-aware prompts. Evaluate faithfulness and citation accuracy.

---

## Phase 9: LLM Generation Layer

**Date:** 2026-07-06

### Why

Context assembly produces citation-labeled chunks, but users need grounded answers with verifiable source attribution. Generation-time citations (G-Cite) commit the model to evidence during decoding, avoiding post-hoc rationalization where models generate answers first and hunt for supporting passages afterward.

### What We Built

1. **GenerationService** - Ollama-based answer generation from AssembledContext
2. **Citation-aware prompts** - G-Cite system prompts requiring inline [Source N] citations
3. **Citation parser** - Maps generated citations back to chunk IDs
4. **OllamaClient** - httpx /api/chat client (consistent with embedder pattern)
5. **MockLLMClient** - Deterministic client for tests and offline benchmarks
6. **FaithfulnessEvaluator** - Atomic claim decomposition + entailment checking
7. **GenerationBenchmark** - End-to-end eval with prompt style comparison
8. **Eval script** - `scripts/eval/run_generation_benchmark.py`
9. **Architecture doc** - `docs/architecture/phase9-llm-generation-architecture.md`

### Evaluation Strategies (Best Practices)

| Strategy | What It Measures | Source |
|---|---|---|
| Atomic claim decomposition | One verifiable assertion per claim | Tian Pan 2026, Wallat 2025 |
| Citation entailment (SUPPORTS/CONTRADICTS/NEUTRAL) | Citation correctness per claim | RAG Triad, NLI-based eval |
| Faithfulness score | Fraction of claims grounded in cited sources | RAGAS faithfulness |
| Citation precision/recall | Correct citations / cited claims | Fine-grained attribution eval |
| Hallucination rate | Unsupported or uncited claims | Inverse groundedness |
| G-Cite over P-Cite | Generation-time vs post-hoc attribution | Wallat et al. 2025 |
| LLM-as-judge + lexical fallback | Accurate eval with offline resilience | SN Computer Science 2026 |
| Prompt style ablation | citation_aware vs concise vs detailed | A/B testable configs |

### Alternatives Considered

| Decision | Chosen | Rationale |
|---|---|---|
| Citation approach | G-Cite (generation-time) | 94% correctness vs 75% for post-hoc on FEVER |
| LLM client | httpx direct to Ollama | No LangChain dep for core path; matches embedder |
| Entailment judge | LLM-as-judge + lexical fallback | Best accuracy with offline test support |
| Default model | llama3.2 (3B) | Smallest model meeting quality bar per constraints |

### Production Gap

| Local | Production | Upgrade Trigger |
|---|---|---|
| llama3.2 3B on CPU | GPU-served 7B+ or fine-tuned RAG model | Faithfulness <70% |
| Lexical entailment proxy | Dedicated NLI model (deberta-v3) | Judge accuracy insufficient |
| Single judge | Multi-judge agreement (2+ models) | Before production SLA |
| No adversarial faithfulness test | Canary injection in irrelevant docs | Phase 10 eval platform |

### Next: Phase 10 Evaluation Platform

Unified eval dashboard tracking retrieval, generation, and operational metrics. Continuous eval in CI with held-out dataset.

---
