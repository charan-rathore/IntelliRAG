# RAG Platform: Production-Grade Retrieval-Augmented Generation from Scratch

A production-oriented RAG platform built from first principles, not a demo. This project implements the full document intelligence pipeline: ingestion, chunking, embedding, indexing, hybrid retrieval, reranking, context assembly, citation-aware generation, unified evaluation, and observability.

**Current Status:** Phases 1-12 complete. Query API operational. Full RAG pipeline with benchmark-driven evaluation and CI quality gates.

**Repository:** [github.com/charan-rathore/IntelliRAG](https://github.com/charan-rathore/IntelliRAG)

---

## Table of Contents

1. [What is This Project?](#what-is-this-project)
2. [Pipeline Architecture](#pipeline-architecture)
3. [What's Built (Phases 1-11)](#whats-built-phases-111)
4. [Evaluation Results](#evaluation-results)
5. [Tech Stack](#tech-stack)
6. [Project Structure](#project-structure)
7. [Getting Started](#getting-started)
8. [Query Console (UI)](#query-console-ui)
9. [Running Benchmarks & Evaluation](#running-benchmarks--evaluation)
10. [Observability Dashboard](#observability-dashboard)
11. [CI/CD Quality Gates](#cicd-quality-gates)
12. [Configuration](#configuration)
13. [Roadmap](#roadmap)

---

## What is This Project?

RAG systems answer questions by finding relevant document chunks, then generating answers grounded in that context. Most tutorials stop at `vectorstore.similarity_search() + llm.invoke()`. This project builds every production layer:

```
Ingest → Chunk → Embed → Index → Retrieve → Rerank → Assemble Context → Generate → Evaluate → Observe
```

**Design principles:** correctness over speed, local-first (Ollama, ChromaDB, no paid APIs), benchmark-driven defaults, structured logging, and CI quality gates.

### Who Is This For?

- Engineers learning production AI systems beyond API wrappers
- Teams building internal knowledge platforms
- Anyone who wants to understand *why* retrieval fails and *how* to measure it

---

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
│         GitHub Issues  │  Markdown Docs  │  Runbooks  │  etc.               │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  INGESTION (Phase 1-2)          FastAPI + Celery Workers                    │
│  Webhook → Validate → Dedupe → Raw Store → Postgres (lifecycle tracking)    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PROCESSING PIPELINE (Phases 3-5)                                           │
│  Chunk (5 strategies) → Embed (Ollama nomic-embed-text) → Index (ChromaDB) │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  QUERY PIPELINE (Phases 6-9)                                                │
│                                                                              │
│  Retrieve ──▶ Rerank ──▶ Context Assembly ──▶ Generate (Ollama + citations) │
│  (hybrid)     (cross-enc)  (dedup/MMR/budget)   (G-Cite prompts)            │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EVALUATION + OBSERVABILITY (Phases 10-11)                                  │
│  Quality gates │ Adversarial probes │ Metrics │ Tracing │ Dashboard         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What's Built (Phases 1-11)

| Phase | Component | Status | Key Files |
|-------|-----------|--------|-----------|
| **1** | GitHub Ingestion | ✅ | `apps/api/`, `apps/workers/` |
| **1** | Document Model & Versioning | ✅ | `libs/shared/models/` |
| **1** | Raw Storage (atomic, partitioned) | ✅ | `libs/connectors/sinks/` |
| **2** | Celery Workers + Retry/DLQ | ✅ | `apps/workers/core/` |
| **2** | Structured JSON Logging | ✅ | `libs/shared/logging/structured.py` |
| **3** | Chunking (5 strategies) | ✅ | `libs/rag/chunking/` |
| **3** | Chunking Benchmarks | ✅ | `scripts/eval/run_chunking_benchmark.py` |
| **4** | Embedding (Ollama nomic-embed-text) | ✅ | `libs/rag/embeddings/` |
| **5** | Indexing (ChromaDB + Postgres) | ✅ | `libs/rag/indexing/` |
| **6** | Retrieval (dense/keyword/hybrid RRF) | ✅ | `libs/rag/retrieval/` |
| **7** | Reranking (cross-encoder + lexical) | ✅ | `libs/rag/reranking/` |
| **8** | Context Assembly (dedup/MMR/budget) | ✅ | `libs/rag/context/` |
| **9** | LLM Generation (Ollama + G-Cite) | ✅ | `libs/rag/generation/` |
| **9** | Faithfulness Evaluation | ✅ | `libs/rag/evaluation/faithfulness.py` |
| **10** | Unified Evaluation Platform | ✅ | `libs/rag/evaluation/platform.py` |
| **10** | CI Quality Gates + Golden Dataset | ✅ | `.github/workflows/rag-eval.yml` |
| **11** | Observability (metrics/tracing/dashboard) | ✅ | `libs/observability/` |
| **12** | Scalability Reviews + Query API | ✅ | `libs/scalability/`, `apps/api/app/api/v1/query.py` |

### Test Coverage

| Module | Tests |
|--------|-------|
| Chunking | 30+ |
| Indexing | 33 |
| Retrieval | 10+ |
| Context Assembly | 8 |
| Generation | 10 |
| Evaluation Platform | 12 |
| Observability | 13 |
| **Total** | **100+** |

---

## Evaluation Results

All benchmarks run on a **2-document test corpus** (Kubernetes incident runbook + Python asyncio guide) with **mock embeddings** and **mock LLM** for deterministic CI. Re-run with `--use-ollama` for real model scores.

> **Important:** Mock embeddings produce deterministic but non-semantic retrieval rankings. Precision metrics are artificially low (0.20) because 5 chunks are retrieved but only 1 is labeled relevant per query. Recall is 1.0 because all relevant content is found. Real Ollama embeddings will change absolute scores but the relative ranking patterns (hybrid > dense, reranking lifts MRR) should hold.

### Phase 3: Chunking Benchmark

Best configuration from RAGAS-style evaluation on sample technical docs:

| Strategy | Chunk Size | Overlap | Precision | Recall | F1 |
|----------|-----------|---------|-----------|--------|-----|
| **Recursive** | **512** | **25** | **0.94** | **0.76** | **0.8485** |
| Recursive | 512 | 50 | 0.93 | 0.75 | 0.8310 |
| Structure-Aware | 512 | 25 | 0.82 | 0.78 | 0.7996 |
| Recursive | 256 | 25 | 0.89 | 0.71 | 0.7900 |

**Finding:** 512 tokens with 25-token overlap is the default. Larger overlaps (100+) increase storage without improving recall.

### Phase 6: Retrieval Benchmark (4 queries, top_k=5)

| Retriever | Recall@5 | Precision@5 | MRR | NDCG@5 | Latency |
|-----------|----------|-------------|-----|--------|---------|
| Dense | 1.0000 | 0.2000 | 0.8333 | 0.8750 | 5.4 ms |
| Keyword | 1.0000 | 0.2000 | 0.8750 | 0.9077 | 0.05 ms |
| **Hybrid (RRF)** | **1.0000** | **0.2000** | **1.0000** | **1.0000** | **1.7 ms** |

**Finding:** Hybrid retrieval achieves perfect MRR and NDCG on the test corpus. Keyword is fastest; dense is slowest.

### Phase 7: Reranking Benchmark (4 queries, top_k=5, retrieve_top_n=20)

| Pipeline | MRR | MRR Lift | NDCG@5 | Top-1 Change | Rerank Latency |
|----------|-----|----------|--------|--------------|----------------|
| dense (baseline) | 0.8750 | N/A | 0.9077 | N/A | N/A |
| keyword (baseline) | 1.0000 | N/A | 1.0000 | N/A | N/A |
| hybrid (baseline) | 0.8750 | N/A | 0.9077 | N/A | N/A |
| **dense + lexical rerank** | **1.0000** | **+0.1250** | **1.0000** | **25%** | **0.1 ms** |
| keyword + lexical rerank | 1.0000 | +0.0000 | 1.0000 | 0% | 0.0 ms |
| hybrid + lexical rerank | 1.0000 | +0.1250 | 1.0000 | 25% | 0.1 ms |

**Finding:** Reranking provides +12.5% MRR lift on dense and hybrid retrieval. Rerank latency is negligible (<0.1 ms with lexical reranker).

### Phase 8: Context Assembly Benchmark (4 queries, max_tokens=1024)

| Strategy | Precision | Recall | Token Efficiency | Dedup Rate | Latency |
|----------|-----------|--------|------------------|------------|---------|
| top_k | 0.3362 | 1.0000 | 0.9808 | 0.00 | 0.04 ms |
| dedup_only | 0.3362 | 1.0000 | 0.9808 | 0.00 | 0.26 ms |
| mmr | 0.3362 | 1.0000 | 0.9808 | 0.00 | 0.83 ms |
| budget | 0.3362 | 1.0000 | 0.9808 | 0.00 | 0.05 ms |
| full | 0.3362 | 1.0000 | 0.9808 | 0.00 | 1.30 ms |
| full_compressed | 0.3362 | 1.0000 | 0.9808 | 0.00 | 0.55 ms |

**Finding:** All strategies achieve 100% context recall on this corpus. Strategies are equivalent when deduplication has nothing to remove (small corpus). `top_k` is fastest.

### Phase 9: Generation + Faithfulness Benchmark (3 queries, mock LLM)

| Metric | Score |
|--------|-------|
| Faithfulness | 0.5000 |
| Citation Precision | 0.5000 |
| Citation Recall | 0.5000 |
| Hallucination Rate | 0.5000 |
| Citation Coverage | 1.0000 |
| Answer Relevancy | 0.1429 |
| Refusal Rate | 0.0% |
| Citation Rate | 100.0% |

**Finding:** Mock LLM returns the same answer regardless of query, limiting faithfulness/relevancy scores. With real Ollama (`--use-ollama`), scores reflect actual model grounding. Citation coverage is 100%: every answer includes `[Source N]` tags.

### Phase 10: Full Pipeline Evaluation (5 golden queries)

End-to-end evaluation across all layers on `data/eval/golden_dataset.json`:

#### Aggregate Metrics

| Metric | Mean | P10 | P50 | P90 |
|--------|------|-----|-----|-----|
| Retrieval MRR | 0.7000 | 0.500 | 0.500 | 1.000 |
| Retrieval Recall@5 | 1.0000 | 1.000 | 1.000 | 1.000 |
| Retrieval Precision@5 | 0.2400 | 0.200 | 0.200 | 0.320 |
| Rerank MRR Lift | +0.2000 | N/A | N/A | N/A |
| Context Precision | 0.4063 | 0.343 | 0.345 | 0.531 |
| Context Recall | 1.0000 | 1.000 | 1.000 | 1.000 |
| Faithfulness | 0.5000 | 0.500 | 0.500 | 0.500 |
| Citation Precision | 0.5000 | 0.500 | 0.500 | 0.500 |
| Hallucination Rate | 0.5000 | 0.500 | 0.500 | 0.500 |
| Answer Relevancy | 0.1524 | 0.000 | 0.000 | 0.391 |
| Adversarial Pass Rate | 1.0000 | N/A | N/A | N/A |
| E2E Latency P95 | 12.6 ms | N/A | 4.0 | N/A |

#### Per-Layer Latency

| Layer | Avg Latency | P50 | P95 |
|-------|-------------|-----|-----|
| Retrieval | 3.9 ms | N/A | N/A |
| Reranking | 1.8 ms | N/A | N/A |
| Context Assembly | 0.5 ms | N/A | N/A |
| Generation (mock) | 0.1 ms | N/A | N/A |
| Faithfulness Eval | 0.4 ms | N/A | N/A |
| **E2E Total** | **6.2 ms** | **4.0 ms** | **12.6 ms** |

#### Quality Gate (lenient thresholds)

| Check | Result |
|-------|--------|
| Retrieval MRR | ✅ PASS (0.70) |
| Retrieval Recall | ✅ PASS (1.00) |
| Retrieval Precision | ❌ FAIL (0.24 < 0.30) |
| Context Recall | ✅ PASS (1.00) |
| Context Precision | ❌ FAIL (0.41 < threshold) |
| Faithfulness | ✅ PASS (0.50, lenient) |
| Adversarial Probes | ✅ PASS (5/5, 100%) |
| E2E Latency P95 | ✅ PASS (12.6 ms) |

**Adversarial faithfulness:** Canary injection test passes 5/5: the system does not cite injected misleading DNS misconfiguration content.

### Phase 11: Observability (3 demo queries)

| Layer | P50 Latency | P95 Latency |
|-------|-------------|-------------|
| Retrieval | 2.7 ms | 10.1 ms |
| Reranking | 0.1 ms | 0.1 ms |
| Context Assembly | 0.7 ms | 0.7 ms |
| Generation | 0.1 ms | 0.1 ms |
| Faithfulness Eval | 0.2 ms | 0.4 ms |
| **E2E** | **4.0 ms** | **13.5 ms** |

Span-attached eval scores (faithfulness, citation_precision, hallucination_rate, answer_relevancy) are recorded on every query trace. Dashboard available at `data/observability/dashboard.html`.

---

## Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| **Language** | Python 3.12 | Type hints, async, ecosystem |
| **API** | FastAPI | Pydantic validation, OpenAPI docs |
| **Workers** | Celery + Redis | Retries, DLQ, horizontal scaling |
| **Database** | PostgreSQL | System of record, lifecycle, audit |
| **Vector Store** | ChromaDB | Local-first, zero infra, SQLite-backed |
| **Embeddings** | Ollama `nomic-embed-text` (768d) | Free, local, no API keys |
| **LLM** | Ollama `llama3.2` (3B) | Free, local, citation-aware generation |
| **Reranking** | `ms-marco-MiniLM-L-6-v2` | 80MB, local cross-encoder |
| **Evaluation** | Custom + RAGAS (optional) | Layer-specific + unified platform |
| **Observability** | Custom metrics/tracing | Prometheus export, HTML dashboard |
| **CI** | GitHub Actions | Unit tests + quality gate on every PR |

**Budget constraint:** Zero paid API keys. Everything runs locally via Ollama.

---

## Project Structure

```
rag-platform/
├── apps/
│   ├── api/                    # FastAPI ingestion service
│   └── workers/                # Celery task workers
│
├── libs/
│   ├── connectors/             # Data sources (GitHub) and sinks (Postgres, FS)
│   ├── rag/
│   │   ├── chunking/           # Phase 3: 5 chunking strategies
│   │   ├── embeddings/         # Phase 4: Ollama nomic-embed-text
│   │   ├── indexing/           # Phase 5: ChromaDB vector store
│   │   ├── retrieval/          # Phase 6: dense/keyword/hybrid
│   │   ├── reranking/          # Phase 7: cross-encoder reranking
│   │   ├── context/            # Phase 8: dedup/MMR/budget assembly
│   │   ├── generation/         # Phase 9: Ollama + G-Cite citations
│   │   └── evaluation/         # Phases 3,10: benchmarks + quality gates
│   ├── observability/          # Phase 11: metrics, tracing, dashboard
│   └── shared/
│       ├── models/             # Document, chunk, lifecycle models
│       └── logging/            # Structured JSON logging with trace_id
│
├── data/
│   ├── eval/
│   │   ├── golden_dataset.json # Versioned eval dataset (5 samples)
│   │   ├── baselines/          # Regression baselines
│   │   └── reports/            # CI eval reports
│   └── observability/
│       └── dashboard.html      # Generated ops dashboard
│
├── scripts/
│   ├── dev/                    # Local testing harnesses
│   ├── eval/                   # Benchmark runners (Phases 3-10)
│   └── observability/          # Dashboard server + demo queries
│
├── docs/
│   ├── architecture/           # Per-phase architecture docs (Phases 5-11)
│   └── engineering-journal.md  # Decisions, tradeoffs, failure logs
│
├── infra/db/migrations/        # PostgreSQL schema migrations
└── .github/workflows/          # CI: unit tests + quality gate
```

---

## Getting Started

### Prerequisites

- Python 3.12+
- PostgreSQL 15+ (for ingestion pipeline)
- Redis 7+ (for Celery workers)
- Ollama (optional, for real embeddings/generation)

### Installation

```bash
git clone https://github.com/charan-rathore/IntelliRAG.git
cd IntelliRAG/rag-platform

python -m venv .venv
source .venv/bin/activate

pip install -e ".[eval]"
```

### Ollama Setup (for real embeddings and generation)

```bash
# Install Ollama: https://ollama.ai
ollama pull nomic-embed-text    # 768d embeddings
ollama pull llama3.2            # 3B generation model
ollama serve                    # Runs on localhost:11434
```

### Database Setup

```bash
createdb rag_platform
psql -d rag_platform -f infra/db/migrations/001_init.sql
psql -d rag_platform -f infra/db/migrations/002_idempotency.sql
psql -d rag_platform -f infra/db/migrations/003_ingestion_runs_and_constraints.sql
psql -d rag_platform -f infra/db/migrations/004_enhanced_ingestion_tracking.sql
```

### Environment Variables

```bash
export POSTGRES_DSN="postgresql://localhost/rag_platform"
export CELERY_BROKER_URL="redis://localhost:6379/0"
export CELERY_RESULT_BACKEND="redis://localhost:6379/0"
export RAW_PAYLOAD_DIR="./data/raw"
```

---

## Query Console (UI)

Launch the API and open the IntelliRAG console in your browser:

```bash
cd rag-platform
source .venv/bin/activate
export PYTHONPATH=.
export RAG_CHROMA_DIR=./data/index/chroma
# Generation uses Ollama automatically when it is reachable (RAG_USE_OLLAMA=auto).
# export RAG_LLM_MODEL=llama3
# Do not set RAG_USE_OLLAMA_EMBED=true unless you re-index — the local Chroma
# collection is TF-IDF by default.

uvicorn apps.api.app.main:app --reload --host 0.0.0.0 --port 8000
```

Open [http://localhost:8000](http://localhost:8000). Ask a question, inspect citations, latency by layer, and quality scores.

The top-bar health pill shows the active LLM backend. If it says **Mock LLM**, answers will be weak — run `ollama serve` and restart the API.

**Failure-mode routing (interactive console):**
- Greetings (`hey`, `hi`) → instant welcome
- Capability asks (`what can you do`) → indexed topics + source links (no LLM wait)
- Off-topic (`weather`, `joke`, …) → fast refuse with guidance
- Document questions → retrieve → generate (Ollama)

**Source links:** each citation includes `url` like `/sources/k8s-incident` (full document page). Quality scores are **off by default** to keep latency down; enable “Show quality scores” in Options when debugging.

**Latency note:** local `llama3` (8B) generation often takes ~15–25s on a laptop. Keep Ollama warm (`keep_alive`), or install a smaller model (`ollama pull llama3.2`) and set `RAG_LLM_MODEL=llama3.2`.

```bash
curl -s http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"question":"What caused the Kubernetes pod scheduling failures?","retrieval_mode":"hybrid","top_k":5}'
```

---

## Running Benchmarks & Evaluation

All commands assume `cd rag-platform && PYTHONPATH=.`.

### Per-Layer Benchmarks

```bash
# Phase 3: Chunking strategy comparison
python scripts/eval/run_chunking_benchmark.py --sample

# Phase 6: Retrieval (dense vs keyword vs hybrid)
python scripts/eval/run_retrieval_benchmark.py

# Phase 7: Reranking lift analysis
python scripts/eval/run_reranking_benchmark.py

# Phase 8: Context assembly strategies
python scripts/eval/run_context_benchmark.py

# Phase 9: Generation + faithfulness
python scripts/eval/run_generation_benchmark.py
python scripts/eval/run_generation_benchmark.py --use-ollama  # real LLM
```

### Full Pipeline Evaluation (Phase 10)

```bash
# Complete eval report with quality gate
python scripts/eval/run_full_evaluation.py

# Save results as regression baseline
python scripts/eval/run_full_evaluation.py --save-baseline

# CI quality gate (used in GitHub Actions)
python scripts/eval/run_quality_gate.py --lenient
```

### Unit Tests

```bash
python -m pytest libs/rag/ libs/observability/ -v
```

---

## Observability Dashboard

### Demo: Run Instrumented Queries

```bash
python scripts/observability/demo_observed_query.py
# Generates data/observability/dashboard.html
```

### Live Dashboard Server

```bash
python scripts/observability/serve_dashboard.py --port 8080
# Open http://localhost:8080/dashboard
```

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Component health check |
| `GET /metrics` | Prometheus-format metrics |
| `GET /dashboard` | HTML operational dashboard |
| `GET /traces` | Recent request traces |
| `GET /traces/{id}` | Full trace with per-layer spans |

Every query trace includes span-attached eval scores (faithfulness, citation precision, hallucination rate), the same rubrics used in CI.

---

## CI/CD Quality Gates

GitHub Actions workflow (`.github/workflows/rag-eval.yml`) runs on every PR:

1. **unit-tests**: pytest across all modules (100+ tests)
2. **quality-gate**: full pipeline eval on golden dataset (5 samples)
3. **nightly-full-eval**: manual dispatch with baseline save

Eval reports are uploaded as CI artifacts.

### Quality Gate Thresholds

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Faithfulness | ≥0.85 | ≥0.70 | <0.70 |
| Context Precision | ≥0.85 | ≥0.65 | <0.65 |
| Hallucination Rate | ≤0.15 | ≤0.30 | >0.30 |
| Adversarial Pass Rate | ≥0.90 | ≥0.70 | <0.70 |
| E2E Latency P95 | ≤5s | ≤10s | >10s |

---

## Configuration

### Chunking Defaults (benchmark-selected)

```python
from libs.rag.chunking import ChunkerConfig

config = ChunkerConfig(
    chunk_size=512,
    chunk_overlap=25,
    min_chunk_size=50,
    max_chunk_size=1024,
)
```

### Full RAG Query (instrumented)

```python
from libs.observability import ObservedRAGPipeline
from libs.rag.generation import GenerationService, MockLLMClient

pipeline = ObservedRAGPipeline(
    retrieval_service=retrieval_svc,
    reranking_service=rerank_svc,
    context_service=context_svc,
    generation_service=GenerationService(llm_client=MockLLMClient()),
)

result = pipeline.query("What caused the pod scheduling failures?")
print(result.answer)
print(f"Faithfulness: {result.eval_scores['faithfulness']:.2f}")
print(f"Trace ID: {result.trace_id}")
```

---

## Roadmap

### Completed (Phases 1-12)

- [x] Ingestion pipeline with idempotency and lifecycle tracking
- [x] Chunking library (5 strategies, benchmark-driven defaults)
- [x] Ollama embedding generation (nomic-embed-text, 768d)
- [x] ChromaDB vector indexing with Postgres dual storage
- [x] Hybrid retrieval (dense + BM25 + RRF fusion)
- [x] Cross-encoder reranking with MRR lift measurement
- [x] Context assembly (dedup, MMR, budget packing, compression)
- [x] Citation-aware Ollama generation (G-Cite)
- [x] Faithfulness evaluation (atomic claims + entailment)
- [x] Unified evaluation platform with CI quality gates
- [x] Observability (metrics, tracing, dashboard, span-attached eval)
- [x] Query API endpoint (`POST /query` with full instrumented pipeline)
- [x] Query console UI for live grounded Q&A testing
- [x] Scalability reviews (10K-10M capacity model, load test harness)

### Coming Next (Phase 13+)

- [ ] Docker Compose for one-command local deployment
- [ ] Expand golden dataset to 100+ production-sampled cases
- [ ] Strict CI merge gate (after golden set ≥50 samples)
- [ ] Failure feed auto-promotion from observability traces

---

## Architecture Documentation

Per-phase design docs with tradeoff analysis:

| Phase | Document |
|-------|----------|
| 5 Indexing | `docs/architecture/phase5-indexing-architecture.md` |
| 7 Reranking | `docs/architecture/phase7-reranking-architecture.md` |
| 8 Context Assembly | `docs/architecture/phase8-context-assembly-architecture.md` |
| 9 LLM Generation | `docs/architecture/phase9-llm-generation-architecture.md` |
| 10 Evaluation | `docs/architecture/phase10-evaluation-platform-architecture.md` |
| 11 Observability | `docs/architecture/phase11-observability-architecture.md` |

Engineering journal with decisions, alternatives, and failure logs: `docs/engineering-journal.md`

---

## Why Build From Scratch?

LangChain and LlamaIndex are great for prototypes. This project exists because:

1. **Debuggability**: When retrieval fails, you know which layer broke and have metrics to prove it
2. **Control**: Every chunking, retrieval, and generation decision is configurable and benchmarked
3. **Reliability**: Idempotent ingestion, lifecycle states, retry classes, dead-letter queues
4. **Evaluation**: CI quality gates with distribution tracking (P10/P90), not just averages
5. **Cost**: Zero API spend. Everything runs on local Ollama

---

## License

MIT
