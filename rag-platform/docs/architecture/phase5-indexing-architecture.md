# Phase 5: Indexing Architecture — Design Document

## Problem Statement

After chunking (Phase 3) and embedding generation (Phase 4), we have document chunks and the ability to generate vector embeddings. But there is **no persistent storage** for either:

1. **Chunks are not persisted** — The `chunks` table doesn't exist in the database. After chunking, chunks live only in memory. If a worker crashes between chunking and embedding, all work is lost.
2. **Embeddings have no destination** — The `Embedder` class generates vectors, but there is no vector store to write them to. Embeddings cannot be searched.
3. **The lifecycle is broken** — Documents get stuck at `CHUNKED` state. The transitions CHUNKED → EMBEDDED → INDEXED → PUBLISHED don't exist in code.

Without indexing, the entire RAG pipeline is non-functional: no retrieval, no reranking, no generation.

---

## Functional Requirements

1. **Chunk Persistence**: Persist chunks to the database with full metadata, hash-based deduplication, and parent document linkage.
2. **Vector Indexing**: Store chunk embeddings in a vector store with payload metadata for filtered search.
3. **Lifecycle Transitions**: Implement CHUNKED → EMBEDDED → INDEXED state transitions with proper error handling.
4. **Idempotent Indexing**: Re-indexing the same document version must not create duplicates.
5. **Incremental Updates**: When a document gets a new version, old chunks/vectors must be invalidated and new ones inserted.
6. **Search API**: Provide a basic vector search interface to validate indexing works.

---

## Non-Functional Requirements

### Reliability
- Atomic chunk persistence (all-or-nothing per document version)
- Graceful handling of Ollama downtime (retry with backoff)
- Partial indexing detection (never publish half-indexed documents)

### Scalability
- Batch embedding generation (configurable batch size)
- Chunk storage must handle 100K+ chunks per tenant
- Vector store must support filtered search at sub-100ms latency for 100K vectors

### Latency
- Embedding generation: ~50ms/chunk for nomic-embed-text via Ollama
- Vector insertion: sub-10ms per point in ChromaDB
- End-to-end indexing per document: < 30s for a 10-chunk document

### Cost
- Zero external API cost (Ollama only)
- Storage: ~3KB per chunk (768 float32 dims = 3072 bytes + metadata)
- At 100K chunks: ~300MB vector storage

### Observability
- Track embedding generation time, vector insertion time
- Count chunks per document, vectors per collection
- Log embedding model version alongside vectors for future migration

---

## Constraints

- **Local-only**: Everything runs on the developer's machine
- **No paid APIs**: Embeddings via Ollama (nomic-embed-text)
- **Limited disk**: Prefer quantized or dimensionally-reduced embeddings when possible
- **Existing schema**: Must integrate with current migration chain (001-004)

---

## Design Options

### Vector Store Selection

| Criteria | ChromaDB | SQLite-VSS | pgvector | Qdrant |
|---|---|---|---|---|
| Setup complexity | pip install | Compile C ext | Postgres ext | Docker container |
| Filtered search | Yes (metadata) | Limited | Yes (SQL) | Yes (payload) |
| Persistence | SQLite-backed | SQLite | Postgres | RocksDB |
| Memory footprint | Low (~50MB) | Low | Shared w/ PG | ~200MB+ |
| Python API | Native | Raw SQL | psycopg | REST/gRPC |
| Scale ceiling | ~1M vectors | ~100K | ~10M | ~100M+ |
| Operational cost | Zero (embedded) | Zero | Already have PG | Docker overhead |

### Decision: ChromaDB (for now)

**Why ChromaDB over Qdrant (which the architecture doc mentions)?**

The V1 architecture doc recommends Qdrant. However, per the environment constraints:
- Qdrant requires Docker (200MB+ image, ~200MB RAM)
- ChromaDB is pip-installable, SQLite-backed, zero-infrastructure
- Both support metadata filtering and persistence
- ChromaDB is sufficient for 100K-500K vectors (our V1 scale)

**When to upgrade to Qdrant:**
- When we exceed ~500K vectors
- When we need HNSW tuning, sharding, or replication
- When we need quantization beyond what ChromaDB offers
- When sub-10ms p99 latency is required at scale

**Gap vs production recommendation:**
- Production: Qdrant Cloud or managed Pinecone for scale, SLA, and ops
- Us: ChromaDB embedded for zero-cost, zero-infra local development
- Tradeoff: We sacrifice horizontal scaling and advanced index tuning

### Chunk Persistence Strategy

**Option A: Postgres only** — Store chunks as rows with text, hash, metadata
- Pro: Transactional, consistent with document lifecycle
- Pro: Can JOIN chunks with documents for complex queries
- Con: No vector search capability in SQLite mode

**Option B: Vector store only** — Store chunks + vectors in ChromaDB
- Pro: Single store for retrieval
- Con: No transactional lifecycle management
- Con: Harder to do metadata-only queries, reporting

**Option C: Dual storage** — Chunks in Postgres, vectors in ChromaDB
- Pro: Best of both worlds (transactional lifecycle + vector search)
- Con: Must keep both in sync
- Con: More complexity

### Decision: Option C (Dual Storage)

Postgres is our system of record for document lifecycle. ChromaDB is our search index. This mirrors the production pattern of "database + search engine" (like Postgres + Elasticsearch). The sync complexity is manageable because:
- Writes are always through our indexing service (single writer)
- ChromaDB supports upsert (idempotent)
- We track `lifecycle_state` in Postgres to detect inconsistencies

---

## Failure Modes

1. **Ollama down during embedding** → Embedding fails, document stays at CHUNKED. Retry with exponential backoff.
2. **ChromaDB write failure** → Vectors not indexed. Document stays at EMBEDDED. Retry.
3. **Partial indexing** → Some chunks embedded but not all. Solution: Embed all chunks before writing any to ChromaDB. All-or-nothing per document.
4. **Stale vectors** → Document updated but old vectors still in ChromaDB. Solution: Delete old vectors by document_id before inserting new ones.
5. **Dimension mismatch** → Embedding model changed but old vectors have different dimensions. Solution: Track `embedding_model` and `embedding_dimensions` per chunk. Reject mismatched inserts.
6. **Disk full** → ChromaDB SQLite grows too large. Solution: Monitor disk before large batch operations. Implement collection size limits.

---

## Rollout Plan

### Step 1: Database Schema
- Create migration 005 for `chunks` table
- Add embedding tracking columns

### Step 2: Vector Store Abstraction
- Create `VectorStore` protocol/interface
- Implement `ChromaVectorStore` backend
- Support: add, search, delete by document_id

### Step 3: Indexing Service
- Create `IndexingService` that orchestrates: embed → persist chunks → index vectors
- Wire into lifecycle: CHUNKED → EMBEDDED → INDEXED

### Step 4: Tests
- Unit tests for vector store operations
- Integration tests for full indexing pipeline
- Idempotency tests (re-index same document)

### Step 5: Validation
- End-to-end: ingest document → chunk → embed → index → search
- Verify search returns relevant results
