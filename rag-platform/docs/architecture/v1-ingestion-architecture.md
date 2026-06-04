# V1 Ingestion Architecture (GitHub Issues, Comments, Markdown)

This document defines the **V1 ingestion architecture** and lifecycle for the initial sources:

- GitHub Issues
- GitHub Issue Comments
- Markdown documentation

The design is intentionally **production-oriented** and **minimal**: reliable ingestion, clear lifecycle, strict normalization, and operational safety. Retrieval/embeddings are out of scope here.

---

## 1) Ingestion Architecture for V1

### 1.1 Flow overview

**Sources → Ingestion API → Queue → Workers → Raw Storage → Normalized Records (Postgres)**

### 1.2 Responsibilities

**API (FastAPI)**
- Validate ingestion requests and source configuration.
- Assign request IDs and create a **canonical ingestion record** in Postgres.
- Enqueue ingestion tasks to workers via Redis (Celery broker).
- Never do heavy fetch/parse work synchronously.

**Workers (Celery)**
- Fetch source data (GitHub, Markdown files).
- Normalize payload into canonical internal document schema.
- Store raw payloads and normalized records.
- Update lifecycle states in Postgres.

### 1.3 Lifecycle ownership

- **Postgres is the system of record.**
- API creates the initial lifecycle state and is responsible for **request identity**.
- Workers own state transitions for fetch/normalize/store stages.

### 1.4 Normalization flow (V1)

1. Fetch raw payload
2. Store raw payload (file store / object storage)
3. Normalize into canonical `Document` and `DocumentVersion`
4. Persist normalized records
5. Emit state transitions

---

## 2) Canonical Internal Document Model

### 2.1 Schema intent

- Support multi-source ingestion with a **single internal model**.
- Enable idempotency (hashing and stable external identity).
- Preserve lineage to raw payloads.

### 2.2 Document identity strategy

- `document_id` is internal UUID (stable identity).
- `external_id` is the source’s stable identity (e.g., GitHub issue id).
- `source_type + external_id + tenant_id` is the **natural key**.

### 2.3 Metadata strategy

- Separate **source metadata** (GitHub repo, issue number) from **operational metadata** (environment, labels).
- Store **access control context** in metadata even if enforcement is V2.

### 2.4 Versioning strategy for V1

- V1 supports **single active version** per document.
- A document update creates a **new version record** and marks the previous version inactive.

---

## 3) GitHub Connector Design

### 3.1 Structure

- **Fetcher:** handles API calls and pagination.
- **Transformer:** converts GitHub payload → canonical schema.
- **Rate limiter:** enforces GitHub API constraints.

### 3.2 Pagination handling

- Fetch issues in pages using `since` + `page` or cursor, depending on endpoint.
- Always capture **last seen cursor** for incremental ingestion.

### 3.3 Rate limiting

- Track `X-RateLimit-Remaining` and `X-RateLimit-Reset`.
- Use exponential backoff and circuit breaker when exhausted.

---

## 4) Ingestion Task Pipeline (Celery)

### 4.1 Task flow

1. `ingest_github_issues`
2. `ingest_github_comments`
3. `ingest_markdown_docs`
4. `normalize_and_store`

### 4.2 Task chaining

- Chain per source per batch to ensure ordering of lifecycle transitions.
- Use task groups for parallelizing across repositories.

### 4.3 Retries

- Network/API errors → retry with exponential backoff.
- Payload errors → send to DLQ (future) or mark failed state.

### 4.4 Idempotency

- Use `hash_payload` + `external_id` for dedupe.
- State-aware tasks should check if a document/version already exists.

---

## 5) Storage Design for V1

- **Raw payloads:** stored in filesystem (V1), designed to switch to object storage later.
- **Normalized documents:** stored in Postgres (primary record).
- **Postgres includes:**
  - document registry
  - version table
  - lifecycle events

### Postponed
- Distributed object storage
- Distributed dedupe service

---

## 6) Recommended V1 Simplifications

**Ignore initially**
- Full access-control enforcement
- Cross-source deduplication
- Automated backfills

**Keep from day one**
- Canonical schema
- Document versioning
- Lifecycle event tracking
- Idempotent ingestion tasks

---

## 7) V1 Scaffolding (Code Structure)

- `libs/shared/models/ingestion/` → canonical schemas and lifecycle enums
- `libs/connectors/sources/github/` → fetchers + transformers
- `apps/api/app/services/ingestion/` → ingestion service entry
- `apps/workers/app/tasks/ingestion/` → Celery task skeletons
