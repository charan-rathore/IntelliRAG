# Phase 12: Scalability Reviews Architecture

## Problem Statement

Phases 1-11 built a functional RAG pipeline with evaluation and observability, but no formal analysis of what breaks as document volume grows from 10K to 10M. Production systems require capacity planning before infrastructure spend.

## Functional Requirements

1. Capacity model estimating storage, compute, and latency at 10K / 100K / 1M / 10M documents
2. Synthetic corpus generator for load testing
3. Query API load test harness measuring P50/P95 under concurrency
4. Bottleneck identification with mitigations per scale tier
5. Cost estimates for local-first stack (Ollama + ChromaDB)

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Disk budget | Stay under 5GB for 100K docs with 768d float32 |
| Query latency | P95 < 5s at 10K docs on local hardware |
| Load test | Support 20 concurrent requests without crash |

## Scale Tier Analysis

| Tier | Chunks (~8/doc) | Vector Storage | Primary Bottleneck | Mitigation |
|---|---|---|---|---|
| 10K | 80K | ~235 MB | None significant | Current architecture sufficient |
| 100K | 800K | ~2.3 GB | Chroma SQLite index size | Collection sharding by tenant |
| 1M | 8M | ~23 GB | BM25 in-memory rebuild | Persistent inverted index |
| 10M | 80M | ~230 GB | Ollama embedding throughput | Batch workers + int8 quantization |

## Query API (Phase 12 deliverable)

`POST /query` wires `ObservedRAGPipeline` to FastAPI with:
- Hybrid retrieval + reranking + context assembly + generation
- Span-attached eval scores on every request
- Failure feed promotion for low-faithfulness traces
- Shared pipeline factory with evaluation scripts

## Evaluation Strategy

1. **Document-scoped relevance**: chunks from the target document count as relevant (fixes artificially low precision)
2. **TF-IDF content-aware embeddings**: deterministic offline retrieval that beats random mock vectors
3. **Context-aware MockLLM**: extracts answers from retrieved sources for CI without Ollama
4. **Baseline comparison gate**: `compare_baseline.py` blocks push unless 3+ metrics improve

## Production Gap vs Local

| Component | Local (current) | Production recommendation |
|---|---|---|
| Vector store | ChromaDB SQLite | Qdrant/pgvector with HNSW |
| Embeddings | Ollama single-process | Dedicated embedding service with batching |
| BM25 | In-memory rebuild | Elasticsearch/Tantivy persistent index |
| LLM | Ollama llama3 | Managed inference with autoscaling |

## Rollout Plan

1. Query API deployed with mock/ollama toggle via env vars
2. Capacity report generated via `scripts/scalability/run_capacity_review.py`
3. Load test validates Query API under 20 concurrent requests
4. Benchmark gate ensures no regression before merge
