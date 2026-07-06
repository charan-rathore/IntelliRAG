# Phase 7: Reranking Architecture

## Problem Statement

Retrieval returns candidates ranked by vector similarity or BM25 score. These scores are computed independently per chunk and do not model query-document interaction. Cross-encoders jointly encode (query, document) pairs and produce more accurate relevance scores, especially for disambiguating similar-looking chunks.

## Functional Requirements

1. Rerank top-N retrieval candidates to top-K final results
2. Support local cross-encoder models (no paid APIs)
3. Provide lexical fallback for fast testing without model download
4. Integrate with existing RetrievalService (dense, keyword, hybrid)
5. Benchmark reranking lift with standard IR metrics

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Latency | Rerank 20 candidates in <500ms on CPU (MiniLM-L-6) |
| Cost | Zero API spend (local sentence-transformers) |
| Memory | <500MB for MiniLM cross-encoder |
| Extensibility | Reranker protocol allows swapping models |

## Design Options

| Option | Pros | Cons | Decision |
|---|---|---|---|
| Cross-encoder (local) | Best quality/cost ratio locally | CPU-bound, ~80MB model download | **Chosen for production path** |
| Cohere Rerank API | Highest quality, managed | Paid, violates budget constraint | Documented as production upgrade |
| LLM-as-judge reranking | Flexible scoring | Slow, expensive even locally | Rejected for V1 |
| Lexical reranker | Zero deps, instant | Limited semantic understanding | **Chosen for tests/baselines** |
| MonoT5 / RankGPT | SOTA quality | Heavy models, slow on CPU | Future upgrade path |

## Architecture

```
Query
  |
  v
RetrievalService (hybrid, top_n=50)
  |
  v
CrossEncoderReranker (score query-chunk pairs)
  |
  v
Top-K RerankedChunk results
```

## Evaluation Strategy

The reranking benchmark (`libs/rag/evaluation/reranking_benchmark.py`) measures:

1. **MRR lift**: Mean Reciprocal Rank before vs after reranking
2. **NDCG lift**: Ranking quality improvement at top-K
3. **Recall@K / Precision@K**: Whether reranking preserves recall while improving precision
4. **Top-1 change rate**: How often reranking changes the highest-ranked result
5. **Rank displacement**: Average position change per chunk
6. **Latency breakdown**: Retrieval vs rerank vs total time
7. **Ablation**: dense+rerank vs keyword+rerank vs hybrid+rerank

Run: `PYTHONPATH=rag-platform python scripts/eval/run_reranking_benchmark.py`

## Failure Modes

| Failure | Symptom | Mitigation |
|---|---|---|
| Cross-encoder model not installed | ImportError on rerank | Fall back to LexicalReranker, log warning |
| Too many candidates | Slow reranking | Cap retrieve_top_n (default 50) |
| Empty candidates | No results | Return empty RerankResult gracefully |
| Score ties | Unstable ordering | Stable sort by chunk_id as tiebreaker |

## Production Gap

| Local | Production | Upgrade Trigger |
|---|---|---|
| ms-marco-MiniLM-L-6-v2 | Cohere Rerank 3.5 | Quality plateau on benchmark |
| CPU inference | GPU batch serving | >100 QPS reranking |
| Single reranker | Cascade (bi-encoder -> cross-encoder -> LLM) | Complex multi-hop queries |

## Rollout Plan

1. Deploy LexicalReranker in tests (done)
2. Benchmark with cross-encoder on eval dataset
3. Wire RerankingService into query API (Phase 9)
4. Monitor MRR lift in production eval pipeline
