# RAG Platform: Building Retrieval-Augmented Generation from Scratch

A production-oriented RAG (Retrieval-Augmented Generation) system built from first principles. This project demonstrates how to build a complete document intelligence pipeline—from ingesting raw documents to answering questions using retrieved context and a local LLM.

**Current Status:** Core ingestion pipeline and chunking library complete. Embeddings, vector search, and query API are next.

---

## Table of Contents

1. [What is This Project?](#what-is-this-project)
2. [Architecture Overview](#architecture-overview)
3. [What's Built vs What's Coming](#whats-built-vs-whats-coming)
4. [Tech Stack and Why](#tech-stack-and-why)
5. [Project Structure](#project-structure)
6. [Getting Started](#getting-started)
7. [The Document Lifecycle](#the-document-lifecycle)
8. [Deep Dive: Chunking](#deep-dive-chunking)
9. [Deep Dive: Evaluation](#deep-dive-evaluation)
10. [Configuration](#configuration)
11. [Development](#development)
12. [Roadmap](#roadmap)

---

## What is This Project?

RAG systems answer questions by first finding relevant pieces of your documents, then giving those pieces to an LLM as context. Instead of the LLM making things up, it generates answers grounded in your actual data.

**This project builds every piece of that system from scratch:**

```
Your Documents → Ingest → Chunk → Embed → Index → [Query] → Retrieve → Answer
```

Most tutorials show you how to call an API. This project shows you how to build the infrastructure that makes RAG work reliably at scale—with proper error handling, idempotency, observability, and data integrity.

### Who Is This For?

- Engineers who want to understand RAG systems beyond "call OpenAI"
- Teams building internal knowledge systems
- Anyone curious about production ML infrastructure

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
│    GitHub Issues    │    Markdown Docs    │    Runbooks    │    etc.        │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FASTAPI SERVICE                                    │
│                                                                              │
│  Ingestion API                              Query API (coming)               │
│  - Accept webhooks                          - Accept questions               │
│  - Validate payloads                        - Return answers with sources    │
│  - Queue processing tasks                                                    │
└─────────────────────┬───────────────────────┬───────────────────────────────┘
                      │                       │
                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ASYNC PIPELINE (CELERY WORKERS)                        │
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐               │
│  │  Fetch   │ →  │  Chunk   │ →  │  Embed   │ →  │  Index   │               │
│  │ Validate │    │  Split   │    │ Vectors  │    │  Qdrant  │               │
│  │  Store   │    │          │    │          │    │          │               │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘               │
│       ✓              ✓               TODO           TODO                     │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              STORAGE LAYER                                   │
│                                                                              │
│  PostgreSQL          Redis            Qdrant           Filesystem            │
│  - Documents         - Task queue     - Vectors        - Raw payloads        │
│  - Versions          - Cache          - Search         - Original docs       │
│  - Lifecycle         - Broker         - (coming)       - Audit trail         │
│  - Audit logs                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What's Built vs What's Coming

### Completed

| Component | Description |
|-----------|-------------|
| **GitHub Ingestion Pipeline** | Full webhook-to-database flow for GitHub issues and comments |
| **Document Model** | Immutable versioning, deterministic IDs, hash-based deduplication |
| **Raw Storage** | Atomic writes with date partitioning for audit and reprocessing |
| **Chunking Library** | 5 strategies tested with benchmark-driven defaults |
| **Evaluation Framework** | RAGAS integration for measuring chunking quality |
| **Celery Infrastructure** | Retry classes, dead-letter queues, late acknowledgment |
| **Structured Logging** | JSON logs with trace IDs for debugging distributed flows |
| **Database Migrations** | 4 migrations covering documents, versions, and ingestion tracking |

### Coming Next

| Component | Priority | Notes |
|-----------|----------|-------|
| **Worker Integration for Chunking** | High | Connect chunking library to Celery pipeline |
| **Embedding Generation** | High | Generate vectors using Ollama or sentence-transformers |
| **Qdrant Vector Index** | High | Store and search embeddings |
| **Query API** | High | Accept questions, retrieve context, generate answers |
| **Ollama Integration** | High | Local LLM for answer generation |
| **Reranking** | Medium | Re-score retrieved chunks for better precision |
| **Docker Compose** | Medium | One-command local deployment |
| **Metrics & Tracing** | Medium | Prometheus metrics, OpenTelemetry traces |
| **Dead-Letter Queue Handling** | Medium | UI/tools for inspecting failed tasks |

---

## Tech Stack and Why

Every choice has a reason. No "just because it's popular."

### Python 3.11+
**Why:** Native async support, type hints, fast enough for I/O-bound work (which is most of RAG). We're not doing ML training here—just orchestrating data flow.

### FastAPI
**Why:** Type-safe request/response handling via Pydantic. Automatic OpenAPI docs. Async support. It's the obvious choice for modern Python APIs.

### Celery + Redis
**Why queues?** Decouples accepting documents from processing them. If embedding takes 10 seconds, you don't want your API to block. Queues also give you automatic retries, dead-letter queues for failures, and horizontal scaling.

**Why Redis as broker?** Simple, fast, widely deployed. We don't need Kafka-level complexity for V1.

### PostgreSQL
**Why not just use the vector database for everything?** Vector databases are great at similarity search. They're terrible at:
- Joins across related data
- Transactional lifecycle updates
- Complex queries ("show me all failed ingestions from last week")
- Audit trails and compliance

PostgreSQL is the system of record. Qdrant handles vector search. Each does what it's best at.

### Qdrant (Coming)
**Why not Pinecone/Weaviate/Milvus?** Qdrant is open-source, runs locally, has excellent Python support, and handles metadata filtering well. For V1 learning purposes, local-first matters more than managed services.

### Ollama (Coming)
**Why not OpenAI API?** 
1. No API costs during development
2. No rate limits
3. Works offline
4. You learn what the LLM is actually doing

You can always swap to OpenAI/Claude/Anthropic later. The architecture is LLM-agnostic.

### Filesystem for Raw Storage (V1)
**Why not S3?** For V1, local disk with atomic writes is simpler to debug. The abstraction layer means we can add S3 later without changing the pipeline.

---

## Project Structure

```
rag-platform/
├── apps/                          # Deployable services
│   ├── api/                       # FastAPI ingestion & query service
│   │   ├── api/v1/               # API routes
│   │   ├── services/             # Business logic
│   │   ├── adapters/             # External integrations
│   │   └── middleware/           # Webhook verification, etc.
│   ├── workers/                   # Celery task workers
│   │   ├── core/                 # Celery configuration
│   │   └── tasks/                # Task definitions by domain
│   └── scheduler/                 # Scheduled jobs (placeholder)
│
├── libs/                          # Shared libraries
│   ├── connectors/                # Data sources and sinks
│   │   ├── sources/              # GitHub, Markdown, etc.
│   │   └── sinks/                # Postgres, filesystem
│   ├── rag/                       # RAG-specific logic
│   │   ├── chunking/             # Text splitting strategies
│   │   └── evaluation/           # Benchmark and metrics
│   └── shared/                    # Cross-cutting concerns
│       ├── models/               # Canonical data models
│       └── logging/              # Structured logging
│
├── infra/                         # Infrastructure configuration
│   ├── compose/                  # Docker Compose files
│   └── db/migrations/            # SQL migration files
│
├── scripts/                       # Development and evaluation scripts
│   ├── dev/                      # Local testing harnesses
│   └── eval/                     # Benchmark runners
│
└── docs/                          # Architecture documentation
    └── architecture/             # Design documents
```

---

## Getting Started

### Prerequisites

- Python 3.11 or higher
- PostgreSQL 15+
- Redis 7+
- Git

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd rag-platform

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -e .

# For evaluation/benchmarking (optional)
pip install -e ".[eval]"
```

### Database Setup

```bash
# Create database
createdb rag_platform

# Run migrations
psql -d rag_platform -f infra/db/migrations/001_init.sql
psql -d rag_platform -f infra/db/migrations/002_idempotency.sql
psql -d rag_platform -f infra/db/migrations/003_ingestion_runs_and_constraints.sql
psql -d rag_platform -f infra/db/migrations/004_enhanced_ingestion_tracking.sql
```

### Environment Variables

```bash
# Required
export POSTGRES_DSN="postgresql://localhost/rag_platform"
export CELERY_BROKER_URL="redis://localhost:6379/0"
export CELERY_RESULT_BACKEND="redis://localhost:6379/0"
export RAW_PAYLOAD_DIR="./data/raw"

# For GitHub ingestion
export GITHUB_TOKEN="ghp_your_token_here"

# Optional webhook security
export INGESTION_WEBHOOK_SECRET="your_webhook_secret"
```

### Running the Services

```bash
# Terminal 1: Start the API
cd apps/api
uvicorn main:app --reload --port 8000

# Terminal 2: Start the worker
cd apps/workers
celery -A core.celery_app worker --loglevel=info

# Terminal 3: Start Redis (if not running)
redis-server
```

### Quick Test: Ingest a GitHub Issue

```bash
# Using the development script
python scripts/dev/ingest_github_issue.py \
    --repo owner/repo \
    --issue 123
```

---

## The Document Lifecycle

Every document goes through a defined lifecycle. This isn't bureaucracy—it's how you build systems that don't lose data and can recover from failures.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  RECEIVED   │ ──▶ │ RAW_STORED  │ ──▶ │ REGISTERED  │ ──▶ │   CHUNKED   │
│             │     │             │     │             │     │             │
│ API accepts │     │ Original    │     │ Canonical   │     │ Split into  │
│ the payload │     │ saved to    │     │ record in   │     │ searchable  │
│             │     │ disk        │     │ Postgres    │     │ pieces      │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
      ┌────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  EMBEDDED   │ ──▶ │   INDEXED   │ ──▶ │  PUBLISHED  │
│             │     │             │     │             │
│ Vectors     │     │ Stored in   │     │ Available   │
│ generated   │     │ Qdrant      │     │ for queries │
│             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
   (coming)            (coming)            (coming)
```

### Why Explicit States Matter

**Debuggability:** When something goes wrong, you can see exactly where it stopped.

**Idempotency:** If a task fails and retries, checking the state tells you whether to redo the work or skip it.

**Partial Progress:** If embedding fails after chunking succeeded, you don't re-chunk—you pick up where you left off.

**Auditability:** You can answer "when was this document last indexed?" with a simple query.

---

## Deep Dive: Chunking

Chunking is one of the most impactful decisions in RAG. Split too large, and your retrieved context contains irrelevant information. Split too small, and you lose context that matters.

### Available Strategies

| Strategy | Best For | How It Works |
|----------|----------|--------------|
| **Recursive** | General text | Tries to split at headers first, then paragraphs, then sentences. Falls back gracefully. |
| **Structure-Aware** | Markdown docs | Respects markdown structure. Keeps code blocks and lists together. |
| **GitHub Issue** | Issues/comments | Treats title, body, and comments as logical units. Preserves metadata. |
| **Semantic** | Dense paragraphs | Uses embeddings to find natural topic boundaries. More expensive but can be more accurate. |
| **Hybrid** | Mixed content | Chooses between structure-aware and recursive based on document characteristics. |

### How We Chose Defaults

We didn't guess. We ran benchmarks.

```
Strategy              Chunk Size   Overlap   Precision   Recall   F1 Score
────────────────────────────────────────────────────────────────────────────
Recursive             512          25        0.94        0.76     0.8485
Recursive             512          50        0.93        0.75     0.8310
Structure-Aware       512          25        0.82        0.78     0.7996
Recursive             256          25        0.89        0.71     0.7900
Structure-Aware       256          50        0.80        0.77     0.7846
```

**Key findings:**
- **512 tokens** with **25-50 token overlap** works best for most content
- Recursive chunking outperformed structure-aware on precision
- Larger overlaps (100+) didn't improve results—they just increased storage
- Very small chunks (128) hurt recall significantly

These defaults are baked into the factory, but you can override them for specific use cases.

### Using the Chunking Library

```python
from libs.rag.chunking import get_chunker
from libs.shared.models.lifecycle import IngestionSource
from libs.shared.models.chunk import ChunkMetadata

# Get the right chunker for your source type
chunker = get_chunker(IngestionSource.GITHUB_ISSUE)

# Chunk your document
result = chunker.chunk(
    text=document_text,
    document_id=doc.document_id,
    version_id=doc.version_id,
    base_metadata=ChunkMetadata(
        source_type=IngestionSource.GITHUB_ISSUE,
        tags=["kubernetes", "networking"],
    ),
)

print(f"Created {len(result.chunks)} chunks")
for chunk in result.chunks:
    print(f"  [{chunk.chunk_index}] {chunk.token_count} tokens")
```

---

## Deep Dive: Evaluation

How do you know if your chunking is good? You measure it.

### What We Measure

**Context Precision:** Of the chunks we retrieved, how many were actually relevant?
- High precision = less noise in the LLM's context

**Context Recall:** Of all the relevant chunks, how many did we find?
- High recall = we're not missing important information

**Combined Score (F1):** Harmonic mean of precision and recall
- Balances the trade-off between finding everything and being precise

### Running Benchmarks

```bash
# Quick comparison of strategies
python scripts/eval/run_chunking_benchmark.py \
    --strategies recursive structure_aware \
    --chunk-sizes 256 512 1024 \
    --overlaps 25 50 100

# Detailed semantic comparison
python scripts/eval/run_semantic_benchmark.py --sample
```

### The Evaluation Framework

```python
from libs.rag.evaluation import ChunkingBenchmark, EvaluationDataset

# Create or load your evaluation dataset
dataset = EvaluationDataset(
    name="my_domain_eval",
    samples=[
        EvaluationSample(
            question="How do I restart the API service?",
            ground_truth="Run `kubectl rollout restart deployment/api`",
            reference_context=["The API service can be restarted using..."],
        ),
        # More samples...
    ],
)

# Run the benchmark
benchmark = ChunkingBenchmark(dataset)
results = benchmark.run_comparison(
    strategies=["recursive", "structure_aware"],
    chunk_sizes=[256, 512, 1024],
)

# See what works best
print(results.to_summary_table())
print(f"Best config: {results.best_result}")
```

### RAGAS Integration

We use [RAGAS](https://docs.ragas.io/) for evaluation metrics. By default, it runs with Ollama locally. If Ollama isn't available, it falls back to lexical (word-overlap) metrics—useful for quick iteration but less accurate.

```bash
# Install eval dependencies
pip install -e ".[eval]"

# Run with Ollama (recommended)
ollama pull llama3
python scripts/eval/run_chunking_benchmark.py --provider ollama

# Or use OpenAI for higher-quality evaluation
export OPENAI_API_KEY="sk-..."
pip install -e ".[eval-openai]"
python scripts/eval/run_chunking_benchmark.py --provider openai
```

---

## Configuration

### Chunker Configuration

```python
from libs.rag.chunking import ChunkerConfig

config = ChunkerConfig(
    chunk_size=512,           # Target size in tokens
    chunk_overlap=50,         # Overlap between chunks
    min_chunk_size=50,        # Don't create tiny chunks
    max_chunk_size=1024,      # Hard upper limit
    preserve_code_blocks=True,  # Keep code blocks atomic
    preserve_lists=True,      # Keep list items together
)
```

### Registering Custom Chunkers

```python
from libs.rag.chunking import register_chunker, BaseChunker
from libs.shared.models.lifecycle import IngestionSource

class MyChunker(BaseChunker):
    @property
    def strategy_name(self) -> str:
        return "my_custom"
    
    def chunk(self, text, document_id, version_id, base_metadata):
        # Your logic here
        pass

# Register it
register_chunker(IngestionSource.CUSTOM_TYPE, MyChunker)
```

---

## Development

### Running Tests

```bash
# All tests
pytest rag-platform/ -v

# Just chunking tests
pytest libs/rag/chunking/tests/ -v

# With coverage
pytest --cov=libs --cov-report=term-missing
```

### Code Style

We use black and ruff with 100-character line length:

```bash
black .
ruff check .
```

### Project Layout Convention

- **apps/** — Deployable services with their own main entry points
- **libs/** — Shared code that services import
- **infra/** — Docker, migrations, Kubernetes configs
- **scripts/** — One-off scripts for dev/eval, not imported elsewhere
- **docs/** — Architecture decisions and guides

---

## Roadmap

### Phase 1: Complete Core Pipeline (Current)
- [x] GitHub ingestion with idempotency
- [x] Chunking library with multiple strategies
- [x] Benchmark-driven optimization
- [ ] Wire chunking into worker pipeline
- [ ] Add chunks table migration

### Phase 2: Vector Search
- [ ] Embedding generation with Ollama/sentence-transformers
- [ ] Qdrant integration
- [ ] Similarity search API

### Phase 3: Query & Answer
- [ ] Query API endpoint
- [ ] Context assembly
- [ ] Ollama integration for answers
- [ ] Basic reranking

### Phase 4: Production Hardening
- [ ] Docker Compose for local deployment
- [ ] Prometheus metrics
- [ ] Proper error recovery UI
- [ ] Rate limiting and auth

### Phase 5: Advanced Features
- [ ] More source connectors (Confluence, Slack, etc.)
- [ ] Feedback loop for improving retrieval
- [ ] Multi-tenant support
- [ ] Hybrid search (keyword + vector)

---

## Why Build From Scratch?

You could just use LangChain or LlamaIndex. They're great for prototypes. But:

1. **Understanding:** When retrieval fails, do you know why? Can you debug it?
2. **Control:** Can you change how chunking works for your specific domain?
3. **Reliability:** Does your pipeline handle partial failures? Duplicates? Retries?
4. **Scale:** What happens when you have 1M documents instead of 1K?

This project is about understanding the internals so you can make informed decisions—whether you end up using a framework or building custom.

---

## License

MIT

---

## Contributing

Contributions welcome. Please open an issue first for major changes.
