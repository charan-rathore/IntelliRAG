"""Lifecycle enums, state transitions, and error codes for ingestion.

This module defines the canonical lifecycle states and error taxonomy for the
ingestion pipeline. Understanding these is critical for debugging and monitoring.

LIFECYCLE CONCEPT:
- IngestionState: Document-level state in the full RAG pipeline (ingestion → retrieval)
- IngestionRunStatus: Per-ingestion-attempt status (one document may have many runs)
- IngestionErrorCode: Structured error categorization for alerting and retry logic

WHY THIS MATTERS:
In production, you'll have thousands of ingestion runs per day. Without structured
error codes, you can't distinguish "retry-safe transient errors" from "permanent
failures requiring human intervention."
"""

from enum import Enum
from typing import NamedTuple


class IngestionState(str, Enum):
    """Document lifecycle state in the full RAG pipeline.
    
    These states track a document's progress from initial receipt through
    to being queryable. The ingestion layer only handles RECEIVED → REGISTERED.
    Later stages (PARSED → PUBLISHED) are handled by downstream pipelines.
    
    State machine (ingestion layer):
        RECEIVED → REGISTERED (success path)
        RECEIVED → FAILED (any stage can fail)
    """
    RECEIVED = "received"
    DEDUPE_CHECKED = "dedupe_checked"
    RAW_STORED = "raw_stored"
    REGISTERED = "registered"
    PARSED = "parsed"
    CHUNKED = "chunked"
    EMBEDDED = "embedded"
    INDEXED = "indexed"
    PUBLISHED = "published"
    FAILED = "failed"


class IngestionSource(str, Enum):
    """Supported ingestion sources.
    
    Each source has its own fetcher, transformer, and schema.
    The source_type is part of the document's natural key.
    """
    GITHUB_ISSUE = "github_issue"
    GITHUB_ISSUE_COMMENT = "github_issue_comment"
    MARKDOWN_DOC = "markdown_doc"


class IngestionRunStatus(str, Enum):
    """Status of a single ingestion run (attempt).
    
    A document may be ingested multiple times (updates, retries).
    Each attempt creates an ingestion_run record with its own status.
    
    Terminal states: REGISTERED, SKIPPED_NO_CHANGE, FAILED
    Non-terminal states: All others (processing in progress)
    
    SUCCESS SEMANTICS:
    - REGISTERED: New document or new version created
    - SKIPPED_NO_CHANGE: Idempotent re-run, no changes needed (also success!)
    
    Both REGISTERED and SKIPPED_NO_CHANGE are successful outcomes.
    """
    RECEIVED = "received"
    VALIDATED = "validated"
    DEDUPE_CHECKED = "dedupe_checked"
    RAW_STORED = "raw_stored"
    REGISTERED = "registered"
    SKIPPED_NO_CHANGE = "skipped_no_change"
    FAILED = "failed"

    def is_terminal(self) -> bool:
        """Check if this status is a terminal (final) state."""
        return self in (
            IngestionRunStatus.REGISTERED,
            IngestionRunStatus.SKIPPED_NO_CHANGE,
            IngestionRunStatus.FAILED,
        )

    def is_success(self) -> bool:
        """Check if this status represents a successful outcome.
        
        IMPORTANT: SKIPPED_NO_CHANGE is a SUCCESS, not a failure.
        It means the system correctly detected no changes were needed.
        """
        return self in (
            IngestionRunStatus.REGISTERED,
            IngestionRunStatus.SKIPPED_NO_CHANGE,
        )


class IngestionErrorCategory(str, Enum):
    """High-level error categories for alerting and retry decisions.
    
    VALIDATION: Bad input data - won't succeed on retry
    TRANSIENT: Temporary failures - should retry with backoff
    INFRASTRUCTURE: System-level issues - may need operator intervention
    INTERNAL: Bugs in our code - needs developer attention
    """
    VALIDATION = "validation"
    TRANSIENT = "transient"
    INFRASTRUCTURE = "infrastructure"
    INTERNAL = "internal"


class IngestionErrorCode(str, Enum):
    """Structured error codes for programmatic error handling.
    
    Format: {CATEGORY}_{SPECIFIC_ERROR}
    
    USAGE:
    - Alerting: Alert on INTERNAL_* errors (bugs)
    - Retry: Auto-retry TRANSIENT_* errors
    - Dashboards: Group by category for error trends
    
    WHY NOT JUST USE EXCEPTION MESSAGES?
    Exception messages are for humans. Error codes are for machines.
    You can't build reliable alerting on string matching.
    """
    # Validation errors - won't succeed on retry
    VALIDATION_SCHEMA_MISMATCH = "validation_schema_mismatch"
    VALIDATION_MISSING_REQUIRED_FIELD = "validation_missing_required_field"
    VALIDATION_INVALID_FIELD_TYPE = "validation_invalid_field_type"
    VALIDATION_FIELD_CONSTRAINT = "validation_field_constraint"
    VALIDATION_PAYLOAD_TOO_LARGE = "validation_payload_too_large"
    VALIDATION_MALFORMED_JSON = "validation_malformed_json"

    # Transient errors - should retry
    TRANSIENT_DATABASE_CONNECTION = "transient_database_connection"
    TRANSIENT_DATABASE_TIMEOUT = "transient_database_timeout"
    TRANSIENT_FILESYSTEM_IO = "transient_filesystem_io"
    TRANSIENT_NETWORK = "transient_network"
    TRANSIENT_RATE_LIMITED = "transient_rate_limited"

    # Infrastructure errors - may need operator intervention
    INFRA_DATABASE_UNAVAILABLE = "infra_database_unavailable"
    INFRA_STORAGE_FULL = "infra_storage_full"
    INFRA_QUEUE_UNAVAILABLE = "infra_queue_unavailable"

    # Internal errors - bugs, needs developer attention
    INTERNAL_UNEXPECTED = "internal_unexpected"
    INTERNAL_ASSERTION_FAILED = "internal_assertion_failed"
    INTERNAL_TRANSFORMER_ERROR = "internal_transformer_error"

    @property
    def category(self) -> IngestionErrorCategory:
        """Get the error category from the error code."""
        prefix = self.value.split("_")[0].lower()
        mapping = {
            "validation": IngestionErrorCategory.VALIDATION,
            "transient": IngestionErrorCategory.TRANSIENT,
            "infra": IngestionErrorCategory.INFRASTRUCTURE,
            "internal": IngestionErrorCategory.INTERNAL,
        }
        return mapping.get(prefix, IngestionErrorCategory.INTERNAL)

    @property
    def is_retryable(self) -> bool:
        """Check if this error type should be automatically retried."""
        return self.category == IngestionErrorCategory.TRANSIENT


class IngestionErrorInfo(NamedTuple):
    """Structured error information for logging and persistence.
    
    Combines error code with human-readable message and optional details.
    """
    code: IngestionErrorCode
    message: str
    details: dict | None = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "error_code": self.code.value,
            "error_category": self.code.category.value,
            "error_message": self.message,
            "error_details": self.details,
            "is_retryable": self.code.is_retryable,
        }
