# Ingestion Pipeline Implementation Guide

**Version:** 1.1 (Post-Audit)  
**Last Updated:** June 2026

This document explains the production-grade ingestion pipeline implementation, covering what each component does, why it exists, and how to debug issues.

---

## Table of Contents

1. [Ingestion Lifecycle Flow](#ingestion-lifecycle-flow)
2. [Component Overview](#component-overview)
3. [Error Handling Strategy](#error-handling-strategy)
4. [Idempotency and Deduplication](#idempotency-and-deduplication)
5. [Transaction Guarantees](#transaction-guarantees)
6. [Observability](#observability)
7. [Checklist of Ingestion Responsibilities](#checklist)

---

## Ingestion Lifecycle Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION INGESTION LIFECYCLE                           │
└─────────────────────────────────────────────────────────────────────────────┘

WEBHOOK RECEIVED
       │
       ▼
┌──────────────────┐
│  VERIFY SIGNATURE│  HMAC-SHA256 verification
│  (middleware)    │  Constant-time comparison
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  ENQUEUE TASK    │  Celery task with trace_id
│  (API service)   │  Returns 202 Accepted
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                      WORKER PROCESSING                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐                                                    │
│  │ RECEIVED │ ← Create ingestion_run record                      │
│  │          │   Log: ingestion_received                          │
│  └────┬─────┘                                                    │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │VALIDATED │ ← Pydantic schema validation                       │
│  │          │   Size limits enforced                             │
│  │          │   Error categorization on failure                  │
│  └────┬─────┘                                                    │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │ DEDUPE   │ ← Compute payload hash                             │
│  │ CHECKED  │   Compare with active version                      │
│  │          │   Log: ingestion_dedupe_checked                    │
│  └────┬─────┘                                                    │
│       │                                                          │
│       ├─── Hash matches ──► SKIPPED_NO_CHANGE (success, exit 0)  │
│       │                                                          │
│       ▼ (hash differs)                                           │
│  ┌──────────┐                                                    │
│  │RAW_STORED│ ← Atomic file write (temp + rename)                │
│  │          │   Store in date-partitioned directory              │
│  │          │   Log: ingestion_raw_stored                        │
│  └────┬─────┘                                                    │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │REGISTERED│ ← Single atomic transaction:                       │
│  │          │   1. Deactivate old version                        │
│  │          │   2. Insert new version                            │
│  │          │   3. Upsert document metadata                      │
│  │          │   4. Insert raw_payload record                     │
│  │          │   5. Update ingestion_run status                   │
│  │          │   6. COMMIT                                        │
│  └──────────┘   Log: ingestion_registered                        │
│                                                                  │
│  ERROR PATH:                                                     │
│  Any step ──► FAILED                                             │
│               - Categorized error code                           │
│               - Rollback transaction                             │
│               - Log: ingestion_failed                            │
│               - Retry if transient, DLQ if permanent             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Overview

### 1. Webhook Middleware (`middleware/webhook.py`)

**Purpose:** Verify webhook authenticity before processing.

**How it works:**
```python
# 1. Extract signature from header (X-Hub-Signature-256)
# 2. Compute HMAC-SHA256 of request body with shared secret
# 3. Compare using constant-time comparison (prevents timing attacks)
# 4. Reject if mismatch
```

**Key security properties:**
- Constant-time comparison prevents timing attacks
- Signature includes full body (can't modify payload)
- Secret loaded from environment (never in code)

### 2. Schema Validation (`sources/github/schemas.py`)

**Purpose:** Reject malformed payloads before any processing.

**Validation enforced:**
- Required fields: `id`, `html_url`, `created_at`, `updated_at`, `user`
- Type checking: `id` must be integer > 0
- Size limits: `body` ≤ 64KB, `title` ≤ 256 chars
- Format validation: Timestamps must be ISO 8601

**Why size limits matter:**
Without limits, an attacker could send a 1GB body field, exhausting worker memory. Our limits match GitHub's actual constraints.

### 3. Transformer (`sources/github/transformer.py`)

**Purpose:** Convert source-specific payloads to canonical format.

**Key transformations:**
```python
# External ID → Document ID (deterministic)
document_id = uuid5(NAMESPACE, f"{source_type}:{external_id}:{tenant_id}")

# Payload → Content Hash (for deduplication)
hash_payload = sha256(json.dumps(payload, sort_keys=True))

# Source metadata → Canonical metadata
metadata = DocumentMetadata(
    source_type=IngestionSource.GITHUB_ISSUE,
    source_uri=payload["html_url"],
    labels=[l["name"] for l in payload.get("labels", [])],
    owners=[payload["user"]["login"]],
)
```

### 4. Raw Payload Store (`sinks/filesystem/raw_payload_store.py`)

**Purpose:** Preserve original payload for reprocessing and audit.

**Atomic write process:**
```python
# 1. Write to temp file in same directory
# 2. Atomic rename to final path
# 3. If crash before rename, temp file is orphaned (harmless)
```

**Path structure:**
```
/data/raw_payloads/
└── 20260604/                    # Date partition
    └── {document_id}-{payload_id}.json
```

### 5. Document Repository (`sinks/postgres/document_repository.py`)

**Purpose:** Persist canonical documents with version history.

**Key operations:**
- `upsert_document`: Create or update document metadata
- `insert_versions`: Add new version (with conflict handling)
- `deactivate_active_version`: Mark old version inactive
- `get_active_version`: Fetch current version for comparison

### 6. Ingestion Run Repository (`sinks/postgres/ingestion_run_repository.py`)

**Purpose:** Track every ingestion attempt for observability.

**Fields tracked:**
- Status progression (received → validated → registered)
- Error details (code, category, message)
- Timing (started_at, finished_at)
- Correlation (trace_id, document_id)

---

## Error Handling Strategy

### Error Categories

| Category | Description | Action | Example |
|----------|-------------|--------|---------|
| **validation** | Bad input data | Don't retry, alert on spike | Missing required field |
| **transient** | Temporary failure | Auto-retry with backoff | DB connection timeout |
| **infrastructure** | System-level issue | Alert ops, may need manual fix | Disk full |
| **internal** | Bug in our code | Alert engineering | Assertion failed |

### Error Code Examples

```python
# Validation errors (don't retry)
VALIDATION_MISSING_REQUIRED_FIELD  # { "id": ... } is missing
VALIDATION_PAYLOAD_TOO_LARGE       # body > 64KB
VALIDATION_SCHEMA_MISMATCH         # Unknown format

# Transient errors (auto-retry)
TRANSIENT_DATABASE_CONNECTION      # Connection refused
TRANSIENT_DATABASE_TIMEOUT         # Query timeout
TRANSIENT_FILESYSTEM_IO            # Disk temporarily unavailable

# Infrastructure errors (alert ops)
INFRA_DATABASE_UNAVAILABLE         # DB down for extended period
INFRA_STORAGE_FULL                 # No space left

# Internal errors (alert engineering)
INTERNAL_UNEXPECTED                # Unhandled exception
INTERNAL_ASSERTION_FAILED          # Code invariant violated
```

### Retry Configuration

```python
# Celery task configuration
@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(RetryableTaskError,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def ingest_github_issues(self, payload):
    ...
```

**Backoff schedule:**
- Retry 1: 60 seconds
- Retry 2: 120 seconds
- Retry 3: 240 seconds
- After 3 failures: Dead letter queue

---

## Idempotency and Deduplication

### How Idempotency Works

```
Payload A (hash: abc123) ──► Ingestion ──► Version 1 created
       │
       │ (same payload received again)
       ▼
Payload A (hash: abc123) ──► Ingestion ──► SKIPPED_NO_CHANGE (no new version)
       │
       │ (payload modified)
       ▼
Payload A' (hash: def456) ──► Ingestion ──► Version 2 created
```

### Hash Computation

```python
def _hash_payload(payload: Dict[str, Any]) -> str:
    # sort_keys=True ensures deterministic serialization
    raw = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()
```

**Important:** We hash the entire payload, not just content. This means:
- Timestamp changes create new versions (tracks when source was modified)
- Label changes create new versions (metadata is part of document)

### Database Constraints (Defense in Depth)

```sql
-- Only one active version per document
CREATE UNIQUE INDEX idx_document_versions_single_active
    ON document_versions (document_id)
    WHERE is_active = TRUE;

-- Prevent duplicate versions with same hash
CREATE UNIQUE INDEX idx_document_versions_doc_hash
    ON document_versions (document_id, hash_payload);

-- Natural key uniqueness
ALTER TABLE documents
    ADD CONSTRAINT uq_documents_source_external
    UNIQUE (source_type, external_id, tenant_id);
```

---

## Transaction Guarantees

### Atomic Operations

All database operations for a single document happen in one transaction:

```python
with psycopg.connect(dsn) as conn:
    # Step 1: Check for existing version
    active = repository.get_active_version(document_id, conn=conn)
    
    # Step 2: Deactivate old version (if exists)
    if active:
        repository.deactivate_active_version(document_id, now, conn=conn)
    
    # Step 3: Insert new version
    repository.insert_versions([version], conn=conn)
    
    # Step 4: Upsert document metadata
    repository.upsert_document(document, conn=conn)
    
    # Step 5: Record raw payload reference
    raw_payload_repo.insert_payload(..., conn=conn)
    
    # Step 6: Update ingestion run status
    ingestion_run_repo.update_status(..., conn=conn)
    
    # COMMIT - all or nothing
    conn.commit()
```

### Failure Scenarios

| Failure Point | Outcome | Recovery |
|---------------|---------|----------|
| Before any DB write | Clean state, retry safe | Auto-retry |
| After file write, before commit | Orphan file, no DB record | File cleanup job |
| After commit | Complete, consistent | N/A (success) |
| During commit | Rollback, consistent | Auto-retry |

---

## Observability

### Structured Logging

Every log entry is JSON-structured with trace correlation:

```json
{
  "timestamp": "2026-06-04T12:30:45.123456Z",
  "level": "INFO",
  "logger": "ingestion",
  "message": "Document registered successfully",
  "event": "ingestion_registered",
  "trace_id": "abc-123-def-456",
  "run_id": "789-ghi-012",
  "document_id": "345-jkl-678",
  "version_index": 2,
  "elapsed_ms": 150
}
```

### Key Log Events

| Event | When | Key Fields |
|-------|------|------------|
| `ingestion_received` | Payload received | source_type, external_id |
| `ingestion_validated` | Schema validation passed | payload_hash |
| `ingestion_validation_failed` | Schema validation failed | error_code, error_details |
| `ingestion_dedupe_checked` | Dedup check complete | is_duplicate |
| `ingestion_skipped_no_change` | No changes detected | document_id |
| `ingestion_raw_stored` | File written | storage_uri |
| `ingestion_registered` | Document saved | version_index |
| `ingestion_failed` | Processing failed | error_code, error_category |

### Debugging with trace_id

```sql
-- Find all events for a specific request
SELECT * FROM ingestion_runs WHERE trace_id = 'abc-123-def-456';

-- Find lifecycle history
SELECT * FROM ingestion_run_events 
WHERE run_id = '789-ghi-012' 
ORDER BY event_timestamp;
```

---

## Checklist of Ingestion Responsibilities {#checklist}

### ✅ Completed

- [x] **Webhook signature verification** - HMAC-SHA256 with constant-time comparison
- [x] **Payload schema validation** - Pydantic with size limits
- [x] **Raw payload persistence** - Atomic file writes with date partitioning
- [x] **Canonical document model** - Deterministic IDs, rich metadata
- [x] **Versioning system** - Single active version, history preserved
- [x] **Idempotency guarantees** - Hash-based deduplication, DB constraints
- [x] **Payload hash-based update detection** - SHA256 of sorted JSON
- [x] **Atomic transaction handling** - Single commit for all DB operations
- [x] **Metadata extraction** - Labels, owners, source-specific fields
- [x] **Processing status tracking** - ingestion_runs table with events
- [x] **Structured logging** - JSON logs with trace correlation
- [x] **Error categorization** - Structured codes for alerting
- [x] **Database constraints** - Unique indexes, CHECK constraints
- [x] **Replay/reprocessing capability** - Reprocess from stored payloads

### 🔜 Future Enhancements

- [ ] Dead letter queue consumer with manual replay UI
- [ ] Metrics emission (Prometheus/StatsD)
- [ ] Version retention policy (auto-archive old versions)
- [ ] Bulk reprocessing API
- [ ] Cross-source deduplication (same content from different sources)

---

## Quick Reference

### Running Tests

```bash
# Unit tests
pytest apps/workers/app/tests/test_ingestion_versioning.py -v

# All tests
pytest rag-platform/ -v
```

### Applying Migrations

```bash
# Apply all migrations
psql $POSTGRES_DSN -f infra/db/migrations/001_init.sql
psql $POSTGRES_DSN -f infra/db/migrations/002_idempotency.sql
psql $POSTGRES_DSN -f infra/db/migrations/003_ingestion_runs_and_constraints.sql
psql $POSTGRES_DSN -f infra/db/migrations/004_enhanced_ingestion_tracking.sql
```

### Key Environment Variables

```bash
POSTGRES_DSN=postgresql://user:pass@localhost:5432/rag
GITHUB_TOKEN=ghp_xxxxx
CELERY_BROKER_URL=redis://localhost:6379/0
RAW_PAYLOAD_DIR=/data/raw_payloads
INGESTION_WEBHOOK_SECRET=your-webhook-secret
```
