# V1 Architecture & Lifecycle (Production-Oriented RAG Platform)

This document defines the **exact V1 architecture and end-to-end lifecycle** of documents and queries for the AI Incident & Knowledge Intelligence Platform. It is designed from a **production engineering and distributed systems** perspective with explicit tradeoffs and operational reasoning.

> **Goal:** Build a scalable, reliable, and explainable RAG system for operational intelligence.
> **Non-goal for V1:** Full automation, complex self-optimizing pipelines, or advanced online learning.

---

## Architecture Diagram (V1)

```
┌─────────────────────────────────────────── SOURCES ───────────────────────────────────────────┐
│  GitHub Issues     Docs/Runbooks     Incidents     Release Notes                               │
└───────────────┬───────────────┬───────────────┬───────────────┬─────────────────────────────────┘
                        │               │               │               │
                        ▼               ▼               ▼               ▼
┌────────────────────────────────────── FASTAPI SERVICE ───────────────────────────────────────┐
│  Ingestion API (ingest/validate)        Query API (retrieve/answer)                           │
└───────────────┬───────────────────────────┬───────────────────────────────────────────────────┘
                        │                           │
                        │                           │
                        ▼                           ▼
┌─────────────────────────────── ASYNC PIPELINE (CELERY WORKERS) ──────────────────────────────┐
│  Parse/Normalize  →  Chunking  →  Embeddings  →  Indexing                                    │
└───────────────┬───────────────────────────────────────────────────────────────┬──────────────┘
                        │                                                               │
                        ▼                                                               ▼
┌─────────────────────────────── STORAGE & SYSTEMS ─────────────────────────────┐   ┌──────────┐
│  Postgres: metadata + lifecycle                                                │   │ Ollama  │
│  Qdrant: vectors + payload                                                     │   │  LLM    │
│  Redis: queue + cache                                                          │   └──────────┘
│  Raw Storage: original docs                                                    │
└───────────────┬───────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────── TELEMETRY ──────────────────────────────────────────────┐
│  Logs + Metrics + Traces (ingest, workers, query, LLM)                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Query flow:
   Query API → Qdrant (retrieve) → Rerank/Prompt → Ollama → Response → Postgres (audit)

Ingestion flow:
   Ingestion API → Redis (queue) → Workers → Postgres/Qdrant/Raw Storage
```

---

## 1) Full Document Ingestion Lifecycle

### 1.1 High-level flow

**Source → Intake → Normalize → Persist → Parse → Chunk → Embed → Index → Publish → Queryable**

### 1.2 Step-by-step lifecycle and state transitions

1. **Document Intake (Ingress)**
   - **Trigger:** webhook, scheduled pull, manual upload.
   - **Service:** API service (FastAPI) validates request and metadata.
   - **State transition:** `RECEIVED`.
   - **Why:** Establish traceability and enforce schema from the start.

2. **Deduplication & Identity Resolution**
   - **Service:** API or Worker (ingestion task).
   - **Action:** Compute content hash, check for existing document with same external ID or hash.
   - **State transition:** `DEDUPE_CHECKED`.
   - **Why:** Prevent duplicate ingestion, which is a major operational failure cause.

3. **Raw Storage Persistence**
   - **Service:** Worker writes raw document to object storage (or file store in V1).
   - **State transition:** `RAW_STORED`.
   - **Why:** Preserve original content for reprocessing and legal/audit needs.

4. **Canonical Record Creation**
   - **Service:** Postgres (metadata registry).
   - **Action:** Create canonical document record with metadata.
   - **State transition:** `REGISTERED`.
   - **Why:** Single source of truth for document lifecycle and lineage.

5. **Parsing & Normalization**
   - **Service:** Parsing worker.
   - **Action:** Extract clean text, structure, and normalized metadata.
   - **State transition:** `PARSED`.
   - **Why:** Make data consistent across sources for retrieval and analysis.

6. **Chunking**
   - **Service:** Chunking worker.
   - **Action:** Split into semantic or size-bound chunks with context windows.
   - **State transition:** `CHUNKED`.
   - **Why:** Chunks are the retrieval unit; quality here is decisive for search.

7. **Embedding Generation**
   - **Service:** Embedding worker using Ollama or future model.
   - **Action:** Generate vectors for each chunk.
   - **State transition:** `EMBEDDED`.
   - **Why:** Vector representations enable semantic retrieval.

8. **Indexing**
   - **Service:** Indexing worker.
   - **Action:** Insert vectors + payload into Qdrant and update Postgres index state.
   - **State transition:** `INDEXED`.
   - **Why:** Makes content queryable and consistent across storage systems.

9. **Publication**
   - **Service:** API or indexer marks document “queryable”.
   - **State transition:** `PUBLISHED`.
   - **Why:** Prevent partially indexed documents from being retrieved.

### 1.3 Event / message flow

- API enqueues ingestion job in Redis queue.
- Workers process tasks; each stage emits events to a lifecycle table in Postgres.
- Failed steps move to retry queues or DLQ.

---

## 2) Internal Canonical Document Schema

### 2.1 Core fields (minimum)

- **document_id**: internal UUID (immutable).
- **external_id**: source ID (e.g., GitHub issue number).
- **source_type**: `github_issue`, `incident`, `doc`, `release_note`.
- **source_uri**: canonical link.
- **title**: human-readable summary.
- **body_raw_uri**: pointer to raw content storage.
- **body_text**: normalized text (can be stored in Postgres or referenced by URI).
- **hash_content**: hash of raw or normalized body.
- **tenant_id**: for multi-tenant systems.
- **created_at, updated_at, ingested_at**.
- **lifecycle_state**: current state from ingestion pipeline.

### 2.2 Metadata fields

- **authors / owners**: who created or owns the document.
- **tags / labels**: operational labels like `sev-1`, `db`, `release`.
- **environment**: prod/staging/dev.
- **service / component**: impacted service.
- **time_window**: incident or release period.
- **access_policy**: ACL or RBAC group references.

### 2.3 Why fields matter

- **Identity fields** prevent duplication and support updates.
- **Lifecycle fields** ensure safe retries and reprocessing.
- **Source metadata** enables filtering, provenance, and compliance.
- **Tenant/ACL fields** are mandatory for enterprise safety.

### 2.4 Enterprise modeling pattern

Most enterprise systems model documents as **immutable versions** with mutable pointers:
- `Document` (stable identity)
- `DocumentVersion` (immutable snapshot)
- `DocumentSource` (external linkage)

---

## 3) Chunk Schema Design

### 3.1 Required fields

- **chunk_id**: UUID for each chunk.
- **document_id**: parent reference.
- **chunk_index**: ordinal position.
- **chunk_text**: normalized text content.
- **chunk_hash**: hash to detect duplicates.
- **chunk_token_count**: for prompt assembly and cost estimation.

### 3.2 Parent-child relationships

- A chunk links to one document version.
- Optionally store `parent_chunk_id` for nested chunking (future use).

### 3.3 Metadata strategy

- Store metadata both in Postgres and Qdrant payload for filtering.
- Minimum metadata for search payload:
  - `document_id`, `source_type`, `tenant_id`, `tags`, `created_at`, `access_policy`.

### 3.4 Traceability

- Each chunk must reference raw document and version.
- Store `source_uri` and `document_version` in payload.

### 3.5 Temporal/version metadata

- `document_version`, `valid_from`, `valid_to`.
- Allows filtering out stale chunks in retrieval.

---

## 4) Storage Architecture

### 4.1 Postgres

**Belongs here:**
- Canonical document metadata
- Lifecycle states and events
- Chunk registry (IDs, ordering, hash)
- Access control metadata
- Query logs and audit trails

**Why:**
- Strong consistency, relational joins, and transactional lifecycle tracking.

### 4.2 Qdrant

**Belongs here:**
- Vector embeddings
- Search payload metadata for filtering

**Why:**
- Specialized vector similarity search and filtering.

### 4.3 Redis

**Belongs here:**
- Task queues (Celery broker)
- Cache of hot queries/results
- Rate limiting and request throttling

**Why:**
- High throughput, low-latency transient storage.

### 4.4 Raw object storage (or file system in V1)

**Belongs here:**
- Original document payloads (JSON/HTML/PDF/etc.)
- Large extracted text files

**Why:**
- Reprocessability, audit retention, and cost efficiency.

---

## 5) Queue & Worker Architecture

### 5.1 Why queues are necessary

- Decouple ingestion from processing
- Absorb traffic spikes
- Enable retries without blocking the API

### 5.2 Task boundaries

- Ingestion → Parsing → Chunking → Embedding → Indexing

Each task should be **idempotent** and **state-aware**.

### 5.3 Retries

- Use exponential backoff
- Max retry threshold before DLQ

### 5.4 Dead-letter queues

- Capture permanently failed tasks
- Allow manual inspection and replay

### 5.5 Idempotency

- Use document and chunk hashes
- Check lifecycle state before executing
- Avoid duplicate vectors in Qdrant

### 5.6 Parallelization strategy

- Ingest in parallel by source
- Embed in parallel by chunk batch
- Index in parallel but atomic per document version

---

## 6) Failure Scenarios & Mitigations

- **Malformed documents** → parsing failures, move to DLQ.
- **Embedding failures** → retry with fallback model; log error.
- **Partial indexing** → keep `INDEXING_IN_PROGRESS`, retry; never publish until consistent.
- **Duplicate ingestion** → detect by `external_id` and `hash_content`.
- **Stale indexes** → compare `document_version` and mark outdated chunks inactive.
- **Race conditions** → optimistic locking in Postgres lifecycle table.

---

## 7) Retrieval Lifecycle

1. **Request received** → validated by API.
2. **Query normalization** → clean and expand query terms.
3. **Candidate retrieval** → Qdrant search with metadata filters.
4. **Reranking** → secondary model (cross-encoder or heuristic).
5. **Context assembly** → structured prompt with top-ranked chunks.
6. **LLM generation** → Ollama inference.
7. **Response logging** → audit + telemetry.

---

## 8) Metadata Filtering Strategy

- **Source filtering**: `source_type`, `source_uri`.
- **Tenant filtering**: `tenant_id` enforced at query time.
- **Time filtering**: `valid_from`, `valid_to` or `created_at`.
- **Access control**: `access_policy` or group membership.

Filtering must be enforced **inside Qdrant payload search** to avoid leakage.

---

## 9) Incremental Indexing & Freshness

- **Updates:** create new `document_version`, invalidate old chunks.
- **Re-indexing:** run pipeline on changed documents only.
- **Deletion:** mark as `DELETED`, remove vectors from Qdrant.
- **Version tracking:** always keep history for audit and rollback.

---

## 10) Recommended V1 Simplified Architecture

### Implement now
- FastAPI ingestion endpoints
- Celery workers for pipeline stages
- Postgres for lifecycle + metadata
- Qdrant for vector search
- Redis as broker and cache
- Basic Ollama inference

### Postpone (V2+)
- Multi-model routing and ensemble retrieval
- Dynamic learning / feedback loops
- Self-healing pipelines
- Advanced analytics dashboards

### Evolution path

Start with **clear boundaries** and **strict lifecycle tracking**. Add complexity only after retrieval accuracy, latency, and operational stability are proven.

---

## Why each component exists (first principles)

- **FastAPI:** controlled entrypoint and orchestration.
- **Postgres:** durable, auditable system of record.
- **Qdrant:** semantic retrieval at scale.
- **Redis + Celery:** asynchronous ingestion and task reliability.
- **Ollama:** local LLM inference with cost control.
- **Docker Compose:** reproducible local deployment.

Each exists to address **real production constraints**: throughput, reliability, debuggability, and traceability.
