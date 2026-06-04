# Ingestion Pipeline Audit Report

**Date:** June 2026  
**Scope:** Production-grade ingestion requirements for IntelliRAG

---

## Executive Summary

The current ingestion pipeline has **strong foundations** with proper document versioning, hash-based deduplication, and atomic transactions. However, several production-critical components need enhancement for reliability, observability, and failure recovery.

| Category | Status | Score |
|----------|--------|-------|
| Core Ingestion | ✅ Solid | 8/10 |
| Observability | ⚠️ Partial | 5/10 |
| Failure Handling | ⚠️ Partial | 6/10 |
| Testing | ⚠️ Minimal | 4/10 |

---

## Component-by-Component Audit

### 1. Webhook/Event Receiver

**Status:** ✅ IMPLEMENTED

**Current Implementation:**
```python
# apps/api/app/middleware/webhook.py
async def verify_webhook_signature(request: Request) -> None:
    secret = _get_secret()
    if not secret:
        return  # Bypasses if no secret configured
    # HMAC-SHA256 verification using constant-time comparison
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")
```

**What's Good:**
- Uses HMAC-SHA256 (GitHub's standard)
- Constant-time comparison (`hmac.compare_digest`) prevents timing attacks
- Configurable header name and secret via environment variables

**Risks/Gaps:**
- No request body size limit enforcement
- No replay attack protection (no timestamp validation)
- Gracefully bypasses verification when secret is not set (security risk in prod)

**Why It Matters:**
Webhooks are the primary entry point for data. Without proper validation, attackers could inject malicious payloads or replay old events to corrupt your document store.

**Improvements Needed:**
- Add request body size limits
- Add timestamp validation (reject events older than 5 minutes)
- Fail closed (reject if secret not configured in production)

---

### 2. Payload Schema Validation

**Status:** ✅ IMPLEMENTED

**Current Implementation:**
```python
# libs/connectors/sources/github/schemas.py
class GitHubIssuePayload(BaseModel):
    model_config = ConfigDict(extra="allow")  # Allows unknown fields
    id: int
    html_url: str
    title: Optional[str] = None
    body: Optional[str] = None
    created_at: str
    updated_at: str
    user: GitHubUser
    # ...
```

**What's Good:**
- Pydantic validation with type coercion
- Required fields enforced (`id`, `html_url`, `created_at`, `updated_at`, `user`)
- `extra="allow"` handles GitHub API evolution gracefully

**Risks/Gaps:**
- No validation of string lengths (body could be massive)
- No URL format validation for `html_url`
- ValidationError messages are raw Pydantic output (not structured for ops)

**Why It Matters:**
Schema validation is your first line of defense against malformed data corrupting your canonical store. Without size limits, a single malicious payload with a 100MB body could crash your worker.

**Improvements Needed:**
- Add `max_length` constraints on text fields
- Add URL format validation
- Categorize validation errors (missing_field, invalid_type, constraint_violation)

---

### 3. Raw Payload Persistence

**Status:** ✅ IMPLEMENTED

**Current Implementation:**
```python
# libs/connectors/sinks/filesystem/raw_payload_store.py
class RawPayloadStore:
    def write_json(self, document_id: UUID, payload: Dict[str, Any]) -> tuple[UUID, str]:
        payload_id = uuid4()
        ts = datetime.now(timezone.utc).strftime("%Y%m%d")
        dir_path = os.path.join(self._base_dir, ts)
        os.makedirs(dir_path, exist_ok=True)
        file_name = f"{document_id}-{payload_id}.json"
        # Direct write to filesystem
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)
        return payload_id, file_path
```

**What's Good:**
- Date-partitioned storage for easy retention management
- Unique payload_id prevents collisions
- Document_id in filename enables manual recovery

**Risks/Gaps:**
- No atomic write (partial writes on crash corrupt file)
- No integrity verification (no checksum stored)
- Filesystem path stored in DB (breaks on path changes/migrations)

**Why It Matters:**
Raw payloads are your audit trail and reprocessing source. If they're corrupted or lost, you cannot recover from ingestion bugs or replay data after schema changes.

**Improvements Needed:**
- Write to temp file, then atomic rename
- Store checksum in raw_payloads table
- Consider relative paths or storage abstraction

---

### 4. Canonical Document Model

**Status:** ✅ IMPLEMENTED

**Current Implementation:**
```python
# libs/shared/models/document.py
class CanonicalDocument(BaseModel):
    document_id: UUID           # Deterministic from natural key
    external_id: str            # Source system ID
    title: Optional[str]
    metadata: DocumentMetadata  # Rich metadata container
    hash_content: str           # SHA256 of body text
    created_at: datetime
    updated_at: datetime
    ingested_at: datetime
    lifecycle_state: IngestionState

def make_document_id(source_type, external_id, tenant_id) -> UUID:
    key = f"{source_type}:{external_id}:{tenant_id or 'default'}"
    return uuid5(NAMESPACE_DOCUMENT, key)  # Deterministic!
```

**What's Good:**
- Deterministic document_id from natural key (idempotent identity)
- Separation of content hash vs payload hash
- Rich metadata with extensible `extra` field
- Multi-tenant ready with tenant_id

**Risks/Gaps:**
- `hash_content` only hashes body, not title (title changes don't trigger version)
- No schema version field for future migrations

**Why It Matters:**
The canonical model is your system of record. Every downstream system (chunking, embedding, retrieval) depends on this being consistent and correct.

**Improvements Needed:**
- Include title in content hash calculation
- Add `schema_version` field for migration tracking

---

### 5. Versioning System

**Status:** ✅ IMPLEMENTED (Well-designed)

**Current Implementation:**
```python
# Document versions table enforces single active version
CREATE UNIQUE INDEX idx_document_versions_single_active
    ON document_versions (document_id)
    WHERE is_active = TRUE;

# Pipeline handles version transitions
def _prepare_version_transition(active: dict | None, now: datetime) -> tuple[int, bool]:
    if active:
        version_index = int(active.get("version_index", 0)) + 1
        return version_index, True  # Increment and mark to deactivate old
    return 1, False
```

**What's Good:**
- Partial unique index guarantees exactly one active version
- Version index monotonically increases
- `valid_from` / `valid_to` enables temporal queries
- Previous versions preserved (audit trail)

**Risks/Gaps:**
- No explicit version limit (could accumulate thousands of versions)
- Deactivation and insert are separate statements (race window)

**Why It Matters:**
Version control is critical for understanding document evolution. Without it, you can't debug "why did my search results change?" or roll back bad updates.

**Improvements Needed:**
- Consider version retention policy (e.g., keep last N versions)
- Use single CTE for atomic version transition

---

### 6. Idempotency Guarantees

**Status:** ✅ IMPLEMENTED (Strong)

**Current Implementation:**
```python
# Hash-based duplicate detection
active = repository.get_active_version(document.document_id, conn=conn)
if active and active.get("hash_payload") == version.hash_payload:
    # No change detected - skip processing
    ingestion_run_repo.update_status(
        run_id=run_id,
        status=IngestionRunStatus.SKIPPED_NO_CHANGE.value,
        ...
    )
    continue  # Idempotent: same input = same output (no-op)

# DB constraint as safety net
ON CONFLICT (document_id, hash_payload) DO NOTHING
```

**What's Good:**
- Two-layer idempotency: application check + DB constraint
- Full payload hash (not just content) catches metadata changes
- Explicit "skipped" status for observability

**Risks/Gaps:**
- `continue` doesn't count as "processed" - returns 0 which might confuse callers

**Why It Matters:**
In distributed systems, messages are delivered "at least once." Without idempotency, webhook retries create duplicate documents, corrupt version history, and waste compute.

**Improvements Needed:**
- Document that "skipped" runs are successful (exit code 0)
- Add metrics for skip rate

---

### 7. Payload Hash-Based Update Detection

**Status:** ✅ IMPLEMENTED (Excellent)

**Current Implementation:**
```python
# libs/connectors/sources/github/transformer.py
def _hash_payload(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()
```

**What's Good:**
- `sort_keys=True` ensures deterministic serialization
- SHA256 is collision-resistant
- Hashes full payload (catches any change)

**Risks/Gaps:**
- Floating point numbers serialize differently across platforms
- `updated_at` in payload means timestamp changes trigger new version even if content identical

**Why It Matters:**
Hash-based detection is the foundation of your idempotency. If hashes are non-deterministic, you'll create spurious versions and waste storage/compute.

**Improvements Needed:**
- Consider normalizing timestamps before hashing
- Or hash only semantic fields (body, title, labels)

---

### 8. Atomic Transaction Handling

**Status:** ✅ IMPLEMENTED (Good)

**Current Implementation:**
```python
with psycopg.connect(repository.dsn, row_factory=dict_row) as conn:
    # All operations in same connection
    repository.deactivate_active_version(document.document_id, now, conn=conn)
    repository.upsert_document(document, conn=conn)
    repository.insert_versions([version], conn=conn)
    raw_payload_repo.insert_payload(..., conn=conn)
    ingestion_run_repo.update_status(..., conn=conn)
    conn.commit()  # Single commit point
```

**What's Good:**
- All DB operations share single connection
- Explicit commit after all operations
- Rollback on exception (psycopg default)

**Risks/Gaps:**
- `payload_store.write_json()` happens BEFORE commit (file exists but DB might rollback)
- No explicit transaction isolation level set

**Why It Matters:**
Without atomicity, a crash mid-ingestion leaves your system in an inconsistent state: file exists but no DB record, or document exists but version doesn't.

**Improvements Needed:**
- Move file write inside transaction or implement compensation
- Set explicit isolation level (`SERIALIZABLE` for critical paths)
- Add distributed transaction handling or saga pattern

---

### 9. Metadata Extraction

**Status:** ✅ IMPLEMENTED

**Current Implementation:**
```python
# libs/connectors/sources/github/transformer.py
metadata = DocumentMetadata(
    source_type=IngestionSource.GITHUB_ISSUE,
    source_uri=source_uri,
    tenant_id=self._tenant_id,
    labels=[label.get("name") for label in payload.get("labels", [])],
    owners=[payload.get("user", {}).get("login")],
    extra={
        "repo": payload.get("repository_url"),
        "issue_number": payload.get("number"),
        "state": payload.get("state"),
        "is_pull_request": "pull_request" in payload,
    },
)
```

**What's Good:**
- Structured metadata separate from content
- `extra` field for source-specific data
- Labels extracted for filtering

**Risks/Gaps:**
- No assignees, milestones, or reactions extracted
- `extra` is untyped (hard to query)

**Why It Matters:**
Metadata enables filtering during retrieval. Without proper extraction, users can't filter by "show me only sev-1 issues" or "issues assigned to me."

**Improvements Needed:**
- Extract more GitHub fields (assignees, milestone, reactions count)
- Consider typed metadata schema per source

---

### 10. Processing Status Tracking

**Status:** ✅ IMPLEMENTED (Good)

**Current Implementation:**
```python
# libs/shared/models/lifecycle.py
class IngestionRunStatus(str, Enum):
    RECEIVED = "received"
    VALIDATED = "validated"
    DEDUPE_CHECKED = "dedupe_checked"
    RAW_STORED = "raw_stored"
    REGISTERED = "registered"
    SKIPPED_NO_CHANGE = "skipped_no_change"
    FAILED = "failed"

# ingestion_runs table tracks each run
CREATE TABLE ingestion_runs (
    run_id UUID PRIMARY KEY,
    status TEXT NOT NULL,
    error_message TEXT,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);
```

**What's Good:**
- Granular status progression
- `error_message` captures failure reason
- `started_at` / `finished_at` enables duration tracking

**Risks/Gaps:**
- No `error_code` for programmatic error handling
- No `retry_count` tracking
- Status history not preserved (only current status)

**Why It Matters:**
Status tracking is your operational visibility. Without it, you can't answer "how many documents are stuck?" or "what's our ingestion success rate?"

**Improvements Needed:**
- Add structured error codes
- Add retry_count field
- Consider ingestion_run_events table for status history

---

### 11. Structured Logging and Observability

**Status:** ⚠️ PARTIAL

**Current Implementation:**
```python
# libs/shared/logging/structured.py
class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "event"):
            payload["event"] = record.event
        if hasattr(record, "fields"):
            payload.update(record.fields)
        return json.dumps(payload, default=str)

# Usage in pipeline
log_event(logger, "ingestion_received", "Received GitHub issue payload.", {
    "run_id": str(run_id),
    "source_type": IngestionSource.GITHUB_ISSUE.value,
    "source_uri": source_uri,
    "external_id": external_id,
})
```

**What's Good:**
- JSON structured logs (machine-parseable)
- Event-based logging with context fields
- Consistent log_event helper

**Risks/Gaps:**
- No trace_id for request correlation
- No timestamp in log payload (relies on log infrastructure)
- No log levels used (all INFO)
- No duration tracking per operation

**Why It Matters:**
In production, you'll have thousands of concurrent ingestions. Without trace correlation, debugging "why did document X fail?" requires grep archaeology through millions of lines.

**Improvements Needed:**
- Add trace_id / correlation_id passed through entire flow
- Add timestamps and duration_ms
- Use appropriate log levels (DEBUG, WARN, ERROR)
- Add metrics emission points

---

### 12. Retry-Safe Ingestion Behavior

**Status:** ⚠️ PARTIAL

**Current Implementation:**
```python
# apps/workers/app/core/celery_app.py
celery_app.conf.update(
    task_acks_late=True,          # Ack after completion (not before)
    worker_prefetch_multiplier=1,  # Process one task at a time
)

# No explicit retry configuration
@celery_app.task(name="...")
def ingest_github_issues(request_payload: Dict[str, Any]) -> int:
    # No retry decorator
    # No max_retries
    # No exponential backoff
```

**What's Good:**
- `task_acks_late=True` ensures tasks aren't lost on crash
- `worker_prefetch_multiplier=1` prevents worker overload

**Risks/Gaps:**
- No automatic retry on transient failures (network, DB connection)
- No exponential backoff
- No dead letter queue for permanent failures

**Why It Matters:**
Transient failures (network blips, DB restarts) are normal in production. Without automatic retry, these require manual intervention, creating operational burden.

**Improvements Needed:**
- Add `@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)`
- Implement exponential backoff with jitter
- Configure dead letter queue

---

### 13. Database Constraints and Indexes

**Status:** ✅ IMPLEMENTED (Strong)

**Current Implementation:**
```sql
-- Natural key uniqueness
ALTER TABLE documents
    ADD CONSTRAINT uq_documents_source_external
    UNIQUE (source_type, external_id, tenant_id);

-- Single active version per document
CREATE UNIQUE INDEX idx_document_versions_single_active
    ON document_versions (document_id)
    WHERE is_active = TRUE;

-- Version ordering
CREATE UNIQUE INDEX idx_document_versions_doc_version
    ON document_versions (document_id, version_index);

-- Hash-based deduplication
CREATE UNIQUE INDEX idx_document_versions_doc_hash
    ON document_versions (document_id, hash_payload);
```

**What's Good:**
- Excellent constraint design
- Partial unique index for active version is elegant
- Proper indexes for all query patterns

**Risks/Gaps:**
- No `CHECK` constraints on status values
- `tenant_id` allows NULL which affects uniqueness

**Why It Matters:**
Database constraints are your last line of defense. Even if application code has bugs, constraints prevent data corruption.

**Improvements Needed:**
- Add CHECK constraint for valid status values
- Consider making tenant_id NOT NULL with default 'default'

---

### 14. Replay/Reprocessing Capability

**Status:** ✅ IMPLEMENTED

**Current Implementation:**
```python
# apps/workers/app/tasks/ingestion/github/pipeline.py
def reprocess_github_payloads_to_postgres(
    transformer, repository, raw_payload_repo, ingestion_run_repo, document_id
) -> int:
    payload_rows = raw_payload_repo.list_payloads_for_document(document_id)
    for payload_row in payload_rows:
        storage_uri = payload_row.get("storage_uri")
        with open(storage_uri, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        # Re-run transformation and validation
        # Creates new version if payload changed
```

**What's Good:**
- Raw payloads preserved for replay
- Reprocessing creates proper ingestion_run records
- Validates payload again (catches schema evolution issues)

**Risks/Gaps:**
- No bulk reprocessing API
- No "reprocess all documents of type X" capability
- Filesystem paths are absolute (breaks on migration)

**Why It Matters:**
Reprocessing is essential for: fixing transformer bugs, schema migrations, and recovering from partial failures. Without it, you'd need to re-fetch everything from source.

**Improvements Needed:**
- Add bulk reprocessing endpoint
- Store relative paths or use content-addressed storage
- Add reprocessing reason to audit trail

---

## Summary: Implementation Priorities

### Critical (Must Fix)

1. **Add trace_id correlation** - Essential for debugging production issues
2. **Add retry configuration** - Celery tasks need proper retry behavior
3. **Atomic file writes** - Prevent corruption on crash
4. **Error categorization** - Structured error codes for alerting

### Important (Should Fix)

5. **Request validation limits** - Prevent DoS via oversized payloads
6. **Ingestion lifecycle events table** - Track status history
7. **More comprehensive tests** - Cover edge cases
8. **Timestamp validation in webhooks** - Prevent replay attacks

### Nice to Have (Can Defer)

9. **Version retention policy** - Automatic cleanup
10. **Bulk reprocessing API** - Operational convenience
11. **Metrics emission** - Prometheus/StatsD integration

---

## Ingestion Lifecycle Flow (Current)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INGESTION LIFECYCLE FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

     ┌──────────┐
     │ WEBHOOK  │  POST /ingestion/github/issues
     │ RECEIVED │  ↓ verify_webhook_signature()
     └────┬─────┘
          │
          ▼
     ┌──────────┐
     │  CELERY  │  enqueue_task() → Redis
     │  QUEUED  │
     └────┬─────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WORKER PROCESSING                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐          │
│  │ RECEIVED │ ──► │VALIDATED │ ──► │ DEDUPE   │ ──► │RAW_STORED│          │
│  │          │     │          │     │ CHECKED  │     │          │          │
│  └──────────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘          │
│                        │                │                │                 │
│                        ▼                ▼                ▼                 │
│                   ValidationError   Hash Match      File Write             │
│                        │                │                │                 │
│                        ▼                ▼                ▼                 │
│                   ┌────────┐      ┌──────────┐    ┌──────────┐            │
│                   │ FAILED │      │ SKIPPED  │    │REGISTERED│            │
│                   │        │      │NO_CHANGE │    │          │            │
│                   └────────┘      └──────────┘    └──────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

State Transitions:
  RECEIVED ──────► VALIDATED ──────► DEDUPE_CHECKED ──────► RAW_STORED ──────► REGISTERED
      │                │                    │                    │
      │                │                    │                    │
      ▼                ▼                    ▼                    ▼
   FAILED           FAILED           SKIPPED_NO_CHANGE       FAILED
```

---

## Database Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMA                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────┐       ┌─────────────────────────┐
│       documents         │       │    document_versions    │
├─────────────────────────┤       ├─────────────────────────┤
│ document_id (PK)        │◄──────│ document_id (FK)        │
│ external_id             │       │ version_id (PK)         │
│ title                   │       │ version_index           │
│ source_type             │       │ body_text               │
│ source_uri              │       │ body_raw_uri            │
│ tenant_id               │       │ source_payload_uri      │
│ owners[]                │       │ hash_payload            │
│ tags[]                  │       │ valid_from              │
│ labels[]                │       │ valid_to                │
│ environment             │       │ is_active               │
│ service                 │       └─────────────────────────┘
│ component               │
│ access_policy (JSONB)   │       ┌─────────────────────────┐
│ hash_content            │       │      raw_payloads       │
│ created_at              │       ├─────────────────────────┤
│ updated_at              │       │ payload_id (PK)         │
│ ingested_at             │◄──────│ document_id (FK)        │
│ lifecycle_state         │       │ source_type             │
└─────────────────────────┘       │ source_uri              │
                                  │ storage_uri             │
┌─────────────────────────┐       │ hash_payload            │
│    ingestion_runs       │       │ received_at             │
├─────────────────────────┤       └─────────────────────────┘
│ run_id (PK)             │
│ source_type             │
│ source_uri              │
│ external_id             │
│ document_id (FK)────────│───────► documents
│ payload_hash            │
│ status                  │
│ error_message           │
│ started_at              │
│ finished_at             │
└─────────────────────────┘

Key Constraints:
  • UNIQUE (source_type, external_id, tenant_id) on documents
  • UNIQUE (document_id, hash_payload) on document_versions
  • UNIQUE (document_id) WHERE is_active = TRUE on document_versions
  • UNIQUE (document_id, version_index) on document_versions
```
