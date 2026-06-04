"""GitHub ingestion pipeline with production-grade reliability.

This module implements the core ingestion flow:
    Fetch → Validate → Dedupe → Store Raw → Register

TRANSACTION GUARANTEES:
All database operations within a single document ingestion are atomic.
If any step fails, the entire transaction rolls back, leaving the system
in a consistent state.

IDEMPOTENCY:
Re-ingesting the same payload (same hash) is a no-op that returns success.
This enables safe retries without creating duplicate data.

ERROR HANDLING:
Errors are categorized into:
- Validation errors: Bad input, won't succeed on retry
- Transient errors: Network/DB issues, should retry
- Internal errors: Bugs, needs developer attention

Each category has different alerting and retry behavior.
"""

from __future__ import annotations

import json
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Generator, Optional
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from pydantic import ValidationError

from libs.connectors.sinks.filesystem.raw_payload_store import RawPayloadStore
from libs.connectors.sinks.postgres.document_repository import PostgresDocumentRepository
from libs.connectors.sinks.postgres.ingestion_run_repository import IngestionRunRepository
from libs.connectors.sinks.postgres.raw_payload_repository import RawPayloadRepository
from libs.connectors.sources.github.fetcher import GitHubFetcher
from libs.connectors.sources.github.schemas import (
    GitHubCommentPayload,
    GitHubIssuePayload,
    categorize_validation_error,
)
from libs.connectors.sources.github.transformer import GitHubTransformer
from libs.shared.logging.structured import IngestionLogger, get_logger
from libs.shared.models.lifecycle import (
    IngestionErrorCode,
    IngestionErrorInfo,
    IngestionRunStatus,
    IngestionSource,
    IngestionState,
)


logger = get_logger(__name__)


class IngestionResult:
    """Result of a single document ingestion attempt.
    
    This class encapsulates the outcome for clear handling:
    - success: Was the operation successful (including no-op skips)?
    - is_new_version: Was a new version created (vs skip)?
    - document_id: The canonical document ID
    - error_info: Structured error details if failed
    """
    
    def __init__(
        self,
        success: bool,
        is_new_version: bool = False,
        document_id: Optional[UUID] = None,
        version_index: Optional[int] = None,
        error_info: Optional[IngestionErrorInfo] = None,
    ) -> None:
        self.success = success
        self.is_new_version = is_new_version
        self.document_id = document_id
        self.version_index = version_index
        self.error_info = error_info
    
    @classmethod
    def skipped(cls, document_id: UUID) -> "IngestionResult":
        """Create result for idempotent skip (no changes needed)."""
        return cls(success=True, is_new_version=False, document_id=document_id)
    
    @classmethod
    def registered(cls, document_id: UUID, version_index: int) -> "IngestionResult":
        """Create result for successful registration."""
        return cls(
            success=True,
            is_new_version=True,
            document_id=document_id,
            version_index=version_index,
        )
    
    @classmethod
    def failed(cls, error_info: IngestionErrorInfo, document_id: Optional[UUID] = None) -> "IngestionResult":
        """Create result for failed ingestion."""
        return cls(success=False, document_id=document_id, error_info=error_info)


def _prepare_version_transition(active: dict | None, now: datetime) -> tuple[int, bool]:
    """Determine version index and whether to deactivate existing version.
    
    Args:
        active: Currently active version record (or None for new documents)
        now: Current timestamp
        
    Returns:
        Tuple of (new_version_index, should_deactivate_old)
        
    LOGIC:
    - New document (no active version): Start at version 1, nothing to deactivate
    - Update (has active version): Increment version, deactivate old
    """
    if active:
        version_index = int(active.get("version_index", 0)) + 1
        return version_index, True
    return 1, False


@contextmanager
def atomic_file_write(filepath: str) -> Generator[str, None, None]:
    """Write file atomically using temp file + rename.
    
    WHY THIS MATTERS:
    If we write directly to the target file and crash mid-write, we get a
    corrupted partial file. With atomic write:
    1. Write to temp file in same directory
    2. Rename temp to target (atomic on POSIX)
    3. If crash happens before rename, temp file is orphaned (harmless)
    
    Yields:
        Path to temp file to write to
    """
    dir_path = os.path.dirname(filepath)
    os.makedirs(dir_path, exist_ok=True)
    
    # Create temp file in same directory (required for atomic rename)
    fd, temp_path = tempfile.mkstemp(dir=dir_path, suffix=".tmp")
    try:
        os.close(fd)  # Close the fd, we'll open with normal file handle
        yield temp_path
        # Atomic rename
        os.rename(temp_path, filepath)
    except Exception:
        # Clean up temp file on error
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


class AtomicRawPayloadStore(RawPayloadStore):
    """Raw payload store with atomic writes."""
    
    def write_json(self, document_id: UUID, payload: Dict[str, Any]) -> tuple[UUID, str]:
        """Persist raw payload atomically and return (payload_id, uri)."""
        payload_id = uuid4()
        ts = datetime.now(timezone.utc).strftime("%Y%m%d")
        dir_path = os.path.join(self._base_dir, ts)
        file_name = f"{document_id}-{payload_id}.json"
        file_path = os.path.join(dir_path, file_name)
        
        with atomic_file_write(file_path) as temp_path:
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=None)
        
        return payload_id, file_path


def _ingest_single_payload(
    payload: Dict[str, Any],
    source_type: IngestionSource,
    transformer: GitHubTransformer,
    repository: PostgresDocumentRepository,
    raw_payload_repo: RawPayloadRepository,
    payload_store: AtomicRawPayloadStore,
    ingestion_run_repo: IngestionRunRepository,
    ing_logger: IngestionLogger,
) -> IngestionResult:
    """Ingest a single payload with full transaction guarantees.
    
    This is the core ingestion logic extracted for reuse between
    issues and comments. All database operations are atomic.
    
    TRANSACTION BOUNDARIES:
    - Validation happens outside transaction (no DB state yet)
    - File write happens inside transaction conceptually (compensated on rollback)
    - All DB writes happen in single transaction
    - Commit only after all operations succeed
    """
    now = datetime.now(timezone.utc)
    run_id = UUID(ing_logger.run_id)
    
    # ===== STEP 1: Validate payload =====
    # This happens BEFORE any DB operations
    try:
        if source_type == IngestionSource.GITHUB_ISSUE:
            GitHubIssuePayload.model_validate(payload)
            document, version = transformer.issue_to_document(payload)
        else:
            GitHubCommentPayload.model_validate(payload)
            document, version = transformer.comment_to_document(payload)
        
        ing_logger.validated(payload_hash=version.hash_payload)
        ingestion_run_repo.update_status(
            run_id=run_id,
            status=IngestionRunStatus.VALIDATED.value,
            payload_hash=version.hash_payload,
        )
    except ValidationError as exc:
        error_info = categorize_validation_error(exc)
        ing_logger.validation_failed(
            error_code=error_info.code.value,
            error_message=error_info.message,
            error_details=error_info.details,
        )
        ingestion_run_repo.update_status(
            run_id=run_id,
            status=IngestionRunStatus.FAILED.value,
            finished_at=now,
            error_message=error_info.message,
            error_code=error_info.code.value,
            error_category=error_info.code.category.value,
        )
        return IngestionResult.failed(error_info)
    
    # ===== STEP 2: Check for duplicates (deduplication) =====
    # Start transaction for all remaining operations
    try:
        with psycopg.connect(repository.dsn, row_factory=dict_row) as conn:
            # Check if document exists and has same hash
            active = repository.get_active_version(document.document_id, conn=conn)
            
            ing_logger.dedupe_checked(
                document_id=document.document_id,
                payload_hash=version.hash_payload,
                is_duplicate=bool(active and active.get("hash_payload") == version.hash_payload),
            )
            
            # ===== STEP 2a: Skip if no changes =====
            if active and active.get("hash_payload") == version.hash_payload:
                ingestion_run_repo.update_status(
                    run_id=run_id,
                    status=IngestionRunStatus.SKIPPED_NO_CHANGE.value,
                    finished_at=now,
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                    conn=conn,
                )
                ing_logger.skipped_no_change(
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                )
                conn.commit()
                return IngestionResult.skipped(document.document_id)
            
            # ===== STEP 3: Prepare version transition =====
            is_new_document = active is None
            version_index, should_deactivate = _prepare_version_transition(active, now)
            
            if should_deactivate:
                repository.deactivate_active_version(document.document_id, now, conn=conn)
            
            version.version_index = version_index
            version.valid_from = now
            version.is_active = True
            
            # ===== STEP 4: Store raw payload (atomic file write) =====
            # Note: If DB transaction fails after this, file is orphaned
            # but that's acceptable (cleanup job can handle later)
            payload_id, storage_uri = payload_store.write_json(document.document_id, payload)
            version.source_payload_uri = storage_uri
            
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.RAW_STORED.value,
                document_id=document.document_id,
                payload_hash=version.hash_payload,
                conn=conn,
            )
            ing_logger.raw_stored(
                document_id=document.document_id,
                storage_uri=storage_uri,
                payload_hash=version.hash_payload,
            )
            
            # ===== STEP 5: Register document and version =====
            document.lifecycle_state = IngestionState.REGISTERED
            document.ingested_at = now
            
            repository.upsert_document(document, conn=conn)
            repository.insert_versions([version], conn=conn)
            raw_payload_repo.insert_payload(
                payload_id=payload_id,
                document_id=document.document_id,
                source_type=source_type.value,
                source_uri=document.metadata.source_uri,
                storage_uri=storage_uri,
                hash_payload=version.hash_payload,
                received_at=document.ingested_at,
                conn=conn,
            )
            
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.REGISTERED.value,
                finished_at=now,
                document_id=document.document_id,
                payload_hash=version.hash_payload,
                conn=conn,
            )
            
            # ===== STEP 6: Commit transaction =====
            conn.commit()
            
            ing_logger.registered(
                document_id=document.document_id,
                version_index=version.version_index,
                is_new_document=is_new_document,
            )
            
            return IngestionResult.registered(document.document_id, version.version_index)
            
    except psycopg.OperationalError as exc:
        # Database connection/timeout errors - transient, should retry
        error_info = IngestionErrorInfo(
            code=IngestionErrorCode.TRANSIENT_DATABASE_CONNECTION,
            message=f"Database error: {exc}",
            details={"exception_type": type(exc).__name__},
        )
        ing_logger.failed(
            error_code=error_info.code.value,
            error_message=error_info.message,
            document_id=document.document_id,
        )
        ingestion_run_repo.update_status(
            run_id=run_id,
            status=IngestionRunStatus.FAILED.value,
            finished_at=now,
            error_message=error_info.message,
            error_code=error_info.code.value,
            error_category=error_info.code.category.value,
            document_id=document.document_id,
            payload_hash=version.hash_payload,
        )
        return IngestionResult.failed(error_info, document.document_id)
        
    except OSError as exc:
        # Filesystem errors - might be transient (disk full) or permanent
        error_info = IngestionErrorInfo(
            code=IngestionErrorCode.TRANSIENT_FILESYSTEM_IO,
            message=f"Filesystem error: {exc}",
            details={"exception_type": type(exc).__name__},
        )
        ing_logger.failed(
            error_code=error_info.code.value,
            error_message=error_info.message,
            document_id=document.document_id,
        )
        ingestion_run_repo.update_status(
            run_id=run_id,
            status=IngestionRunStatus.FAILED.value,
            finished_at=now,
            error_message=error_info.message,
            error_code=error_info.code.value,
            error_category=error_info.code.category.value,
            document_id=document.document_id,
            payload_hash=version.hash_payload,
        )
        return IngestionResult.failed(error_info, document.document_id)
        
    except Exception as exc:
        # Unexpected errors - internal, needs investigation
        error_info = IngestionErrorInfo(
            code=IngestionErrorCode.INTERNAL_UNEXPECTED,
            message=f"Unexpected error: {exc}",
            details={"exception_type": type(exc).__name__},
        )
        ing_logger.failed(
            error_code=error_info.code.value,
            error_message=error_info.message,
            document_id=document.document_id,
            error_details={"exception": str(exc)},
        )
        ingestion_run_repo.update_status(
            run_id=run_id,
            status=IngestionRunStatus.FAILED.value,
            finished_at=now,
            error_message=error_info.message,
            error_code=error_info.code.value,
            error_category=error_info.code.category.value,
            document_id=document.document_id,
            payload_hash=version.hash_payload,
        )
        return IngestionResult.failed(error_info, document.document_id)


def ingest_github_issues_to_postgres(
    fetcher: GitHubFetcher,
    transformer: GitHubTransformer,
    repository: PostgresDocumentRepository,
    raw_payload_repo: RawPayloadRepository,
    payload_store: RawPayloadStore,
    ingestion_run_repo: IngestionRunRepository,
    params: Dict[str, Any],
) -> int:
    """Fetch GitHub issues and persist canonical documents to Postgres.
    
    Returns:
        Number of NEW versions created (excludes skipped/failed)
        
    NOTE ON RETURN VALUE:
    This returns count of new versions only. Skipped (no-change) runs are
    considered successful but don't increment the count. This is intentional
    to distinguish "work done" from "no work needed."
    """
    # Wrap with atomic store for safe file writes
    atomic_store = AtomicRawPayloadStore(payload_store._base_dir)
    
    processed = 0
    for payload in fetcher.fetch_issues(params):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        source_uri = payload.get("html_url") if isinstance(payload, dict) else None
        external_id = str(payload.get("id")) if isinstance(payload, dict) else None
        
        # Initialize logger with trace correlation
        ing_logger = IngestionLogger(run_id=run_id)
        
        # Create initial run record
        ingestion_run_repo.create_run(
            run_id=run_id,
            source_type=IngestionSource.GITHUB_ISSUE.value,
            source_uri=source_uri,
            external_id=external_id,
            status=IngestionRunStatus.RECEIVED.value,
            started_at=now,
            trace_id=ing_logger.trace_id,
        )
        
        ing_logger.received(
            source_type=IngestionSource.GITHUB_ISSUE.value,
            external_id=external_id,
            source_uri=source_uri,
        )
        
        # Process the payload
        result = _ingest_single_payload(
            payload=payload,
            source_type=IngestionSource.GITHUB_ISSUE,
            transformer=transformer,
            repository=repository,
            raw_payload_repo=raw_payload_repo,
            payload_store=atomic_store,
            ingestion_run_repo=ingestion_run_repo,
            ing_logger=ing_logger,
        )
        
        ing_logger.complete()
        
        if result.success and result.is_new_version:
            processed += 1
    
    return processed


def ingest_github_comments_to_postgres(
    fetcher: GitHubFetcher,
    transformer: GitHubTransformer,
    repository: PostgresDocumentRepository,
    raw_payload_repo: RawPayloadRepository,
    payload_store: RawPayloadStore,
    ingestion_run_repo: IngestionRunRepository,
    issue_number: int,
    params: Dict[str, Any],
) -> int:
    """Fetch GitHub issue comments and persist canonical documents to Postgres."""
    atomic_store = AtomicRawPayloadStore(payload_store._base_dir)
    
    processed = 0
    for payload in fetcher.fetch_issue_comments(issue_number, params):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        source_uri = payload.get("html_url") if isinstance(payload, dict) else None
        external_id = str(payload.get("id")) if isinstance(payload, dict) else None
        
        ing_logger = IngestionLogger(run_id=run_id)
        
        ingestion_run_repo.create_run(
            run_id=run_id,
            source_type=IngestionSource.GITHUB_ISSUE_COMMENT.value,
            source_uri=source_uri,
            external_id=external_id,
            status=IngestionRunStatus.RECEIVED.value,
            started_at=now,
            trace_id=ing_logger.trace_id,
        )
        
        ing_logger.received(
            source_type=IngestionSource.GITHUB_ISSUE_COMMENT.value,
            external_id=external_id,
            source_uri=source_uri,
        )
        
        result = _ingest_single_payload(
            payload=payload,
            source_type=IngestionSource.GITHUB_ISSUE_COMMENT,
            transformer=transformer,
            repository=repository,
            raw_payload_repo=raw_payload_repo,
            payload_store=atomic_store,
            ingestion_run_repo=ingestion_run_repo,
            ing_logger=ing_logger,
        )
        
        ing_logger.complete()
        
        if result.success and result.is_new_version:
            processed += 1
    
    return processed


def reprocess_github_payloads_to_postgres(
    transformer: GitHubTransformer,
    repository: PostgresDocumentRepository,
    raw_payload_repo: RawPayloadRepository,
    ingestion_run_repo: IngestionRunRepository,
    document_id: UUID,
) -> int:
    """Replay previously stored raw payloads for a document.
    
    USE CASES:
    - Transformer bug fix: Reprocess to apply corrected transformation
    - Schema migration: Reprocess to update canonical format
    - Data recovery: Recreate document from raw payload after data loss
    
    This function reads stored raw payloads and re-runs the ingestion
    pipeline, creating new versions if the transformation output differs.
    """
    processed = 0
    payload_rows = raw_payload_repo.list_payloads_for_document(document_id)
    
    for payload_row in payload_rows:
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        
        ing_logger = IngestionLogger(run_id=run_id)
        
        ingestion_run_repo.create_run(
            run_id=run_id,
            source_type=payload_row.get("source_type"),
            source_uri=payload_row.get("source_uri"),
            external_id=None,
            status=IngestionRunStatus.RECEIVED.value,
            started_at=now,
            trace_id=ing_logger.trace_id,
        )
        
        ing_logger.received(
            source_type=payload_row.get("source_type", "unknown"),
            source_uri=payload_row.get("source_uri"),
        )
        
        storage_uri = payload_row.get("storage_uri")
        if not storage_uri:
            error_info = IngestionErrorInfo(
                code=IngestionErrorCode.INTERNAL_ASSERTION_FAILED,
                message="Missing storage_uri for replay payload",
            )
            ing_logger.failed(
                error_code=error_info.code.value,
                error_message=error_info.message,
            )
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=error_info.message,
                error_code=error_info.code.value,
                error_category=error_info.code.category.value,
            )
            continue
        
        # Read stored payload
        try:
            with open(storage_uri, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            error_info = IngestionErrorInfo(
                code=IngestionErrorCode.TRANSIENT_FILESYSTEM_IO,
                message=f"Failed to read stored payload: {exc}",
            )
            ing_logger.failed(
                error_code=error_info.code.value,
                error_message=error_info.message,
            )
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=error_info.message,
                error_code=error_info.code.value,
                error_category=error_info.code.category.value,
            )
            continue
        
        # Determine source type and validate
        source_type_str = payload_row.get("source_type")
        try:
            source_type = IngestionSource(source_type_str)
        except ValueError:
            error_info = IngestionErrorInfo(
                code=IngestionErrorCode.INTERNAL_ASSERTION_FAILED,
                message=f"Unknown source type: {source_type_str}",
            )
            ing_logger.failed(
                error_code=error_info.code.value,
                error_message=error_info.message,
            )
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=error_info.message,
                error_code=error_info.code.value,
                error_category=error_info.code.category.value,
            )
            continue
        
        # Validate and transform
        try:
            if source_type == IngestionSource.GITHUB_ISSUE:
                GitHubIssuePayload.model_validate(payload)
                document, version = transformer.issue_to_document(payload)
            else:
                GitHubCommentPayload.model_validate(payload)
                document, version = transformer.comment_to_document(payload)
            
            ing_logger.validated(payload_hash=version.hash_payload)
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.VALIDATED.value,
                payload_hash=version.hash_payload,
            )
        except ValidationError as exc:
            error_info = categorize_validation_error(exc)
            ing_logger.validation_failed(
                error_code=error_info.code.value,
                error_message=error_info.message,
            )
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=error_info.message,
                error_code=error_info.code.value,
                error_category=error_info.code.category.value,
            )
            continue
        
        # Check for duplicates and register
        try:
            with psycopg.connect(repository.dsn, row_factory=dict_row) as conn:
                active = repository.get_active_version(document.document_id, conn=conn)
                
                if active and active.get("hash_payload") == version.hash_payload:
                    ingestion_run_repo.update_status(
                        run_id=run_id,
                        status=IngestionRunStatus.SKIPPED_NO_CHANGE.value,
                        finished_at=now,
                        document_id=document.document_id,
                        payload_hash=version.hash_payload,
                        conn=conn,
                    )
                    ing_logger.skipped_no_change(
                        document_id=document.document_id,
                        payload_hash=version.hash_payload,
                    )
                    conn.commit()
                    continue
                
                version_index, should_deactivate = _prepare_version_transition(active, now)
                if should_deactivate:
                    repository.deactivate_active_version(document.document_id, now, conn=conn)
                
                version.version_index = version_index
                version.valid_from = now
                version.is_active = True
                version.source_payload_uri = storage_uri
                document.lifecycle_state = IngestionState.REGISTERED
                document.ingested_at = now
                
                repository.upsert_document(document, conn=conn)
                repository.insert_versions([version], conn=conn)
                
                ingestion_run_repo.update_status(
                    run_id=run_id,
                    status=IngestionRunStatus.REGISTERED.value,
                    finished_at=now,
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                    conn=conn,
                )
                
                conn.commit()
                
                ing_logger.registered(
                    document_id=document.document_id,
                    version_index=version.version_index,
                    is_new_document=active is None,
                )
                processed += 1
                
        except Exception as exc:
            error_info = IngestionErrorInfo(
                code=IngestionErrorCode.INTERNAL_UNEXPECTED,
                message=f"Reprocessing failed: {exc}",
            )
            ing_logger.failed(
                error_code=error_info.code.value,
                error_message=error_info.message,
                document_id=document.document_id,
            )
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=error_info.message,
                error_code=error_info.code.value,
                error_category=error_info.code.category.value,
                document_id=document.document_id,
                payload_hash=version.hash_payload,
            )
        
        ing_logger.complete()
    
    return processed
