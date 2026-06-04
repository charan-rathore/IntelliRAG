"""Postgres persistence for ingestion run tracking with enhanced observability.

This module provides the repository for tracking ingestion runs with:
- Structured error codes and categories
- Trace correlation for debugging
- Retry tracking for reliability analysis
- Lifecycle event history (via triggers)
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Optional
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


class IngestionRunRepository:
    """Repository for ingestion run tracking and observability.
    
    Each ingestion attempt creates a "run" record that tracks:
    - Status progression (received → validated → registered)
    - Error details when failures occur
    - Trace correlation for debugging
    - Timing information for performance analysis
    """
    
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    @contextmanager
    def _conn(self):
        with psycopg.connect(self._dsn, row_factory=dict_row) as conn:
            yield conn

    def create_run(
        self,
        run_id: UUID,
        source_type: str,
        status: str,
        started_at: datetime,
        source_uri: Optional[str] = None,
        external_id: Optional[str] = None,
        document_id: Optional[UUID] = None,
        payload_hash: Optional[str] = None,
        trace_id: Optional[str] = None,
        conn: Optional[psycopg.Connection] = None,
    ) -> None:
        """Create a new ingestion run record.
        
        Args:
            run_id: Unique identifier for this run
            source_type: Type of source (github_issue, etc.)
            status: Initial status (typically 'received')
            started_at: When processing started
            source_uri: URL of the source document
            external_id: ID in the source system
            document_id: Internal document ID (if known)
            payload_hash: Hash of the payload (if computed)
            trace_id: Correlation ID for distributed tracing
            conn: Optional existing connection for transaction
        """
        query = """
        INSERT INTO ingestion_runs (
            run_id, source_type, source_uri, external_id, document_id,
            payload_hash, status, started_at, trace_id, retry_count
        ) VALUES (
            %(run_id)s, %(source_type)s, %(source_uri)s, %(external_id)s, %(document_id)s,
            %(payload_hash)s, %(status)s, %(started_at)s, %(trace_id)s, 0
        )
        """
        params = {
            "run_id": str(run_id),
            "source_type": source_type,
            "source_uri": source_uri,
            "external_id": external_id,
            "document_id": str(document_id) if document_id else None,
            "payload_hash": payload_hash,
            "status": status,
            "started_at": started_at,
            "trace_id": trace_id,
        }
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, params)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(query, params)

    def update_status(
        self,
        run_id: UUID,
        status: str,
        finished_at: Optional[datetime] = None,
        error_message: Optional[str] = None,
        error_code: Optional[str] = None,
        error_category: Optional[str] = None,
        document_id: Optional[UUID] = None,
        payload_hash: Optional[str] = None,
        is_retryable: Optional[bool] = None,
        conn: Optional[psycopg.Connection] = None,
    ) -> None:
        """Update the status of an ingestion run.
        
        Args:
            run_id: The run to update
            status: New status value
            finished_at: Completion timestamp (for terminal states)
            error_message: Human-readable error message
            error_code: Structured error code (e.g., 'validation_schema_mismatch')
            error_category: Error category (validation, transient, etc.)
            document_id: Internal document ID
            payload_hash: Hash of the payload
            is_retryable: Whether the error is retry-safe
            conn: Optional existing connection for transaction
            
        NOTE: The database trigger automatically records this status change
        in the ingestion_run_events table for audit purposes.
        """
        query = """
        UPDATE ingestion_runs
        SET status = %(status)s,
            finished_at = COALESCE(%(finished_at)s, finished_at),
            error_message = COALESCE(%(error_message)s, error_message),
            error_code = COALESCE(%(error_code)s, error_code),
            error_category = COALESCE(%(error_category)s, error_category),
            document_id = COALESCE(%(document_id)s, document_id),
            payload_hash = COALESCE(%(payload_hash)s, payload_hash),
            is_retryable = COALESCE(%(is_retryable)s, is_retryable)
        WHERE run_id = %(run_id)s
        """
        params = {
            "run_id": str(run_id),
            "status": status,
            "finished_at": finished_at,
            "error_message": error_message,
            "error_code": error_code,
            "error_category": error_category,
            "document_id": str(document_id) if document_id else None,
            "payload_hash": payload_hash,
            "is_retryable": is_retryable,
        }
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, params)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(query, params)

    def increment_retry_count(
        self,
        run_id: UUID,
        conn: Optional[psycopg.Connection] = None,
    ) -> int:
        """Increment and return the retry count for a run.
        
        Returns:
            The new retry count after increment
        """
        query = """
        UPDATE ingestion_runs
        SET retry_count = COALESCE(retry_count, 0) + 1
        WHERE run_id = %(run_id)s
        RETURNING retry_count
        """
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, {"run_id": str(run_id)})
                    row = cur.fetchone()
                    owned_conn.commit()
                    return row["retry_count"] if row else 0
        with conn.cursor() as cur:
            cur.execute(query, {"run_id": str(run_id)})
            row = cur.fetchone()
            return row["retry_count"] if row else 0

    def get_run(self, run_id: UUID) -> Optional[dict]:
        """Fetch a single ingestion run by ID."""
        query = """
        SELECT run_id, source_type, source_uri, external_id, document_id, payload_hash,
               status, error_message, error_code, error_category, 
               started_at, finished_at, trace_id, retry_count, is_retryable
        FROM ingestion_runs
        WHERE run_id = %(run_id)s
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, {"run_id": str(run_id)})
                return cur.fetchone()

    def list_runs(
        self,
        status: Optional[str] = None,
        source_type: Optional[str] = None,
        document_id: Optional[UUID] = None,
        external_id: Optional[str] = None,
        error_category: Optional[str] = None,
        trace_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """List ingestion runs with optional filters.
        
        Args:
            status: Filter by status
            source_type: Filter by source type
            document_id: Filter by document
            external_id: Filter by external ID
            error_category: Filter by error category (for failure analysis)
            trace_id: Filter by trace ID (for debugging)
            limit: Maximum results
            offset: Pagination offset
            
        Returns:
            List of run records, newest first
        """
        conditions = []
        params: dict = {"limit": limit, "offset": offset}
        
        if status:
            conditions.append("status = %(status)s")
            params["status"] = status
        if source_type:
            conditions.append("source_type = %(source_type)s")
            params["source_type"] = source_type
        if document_id:
            conditions.append("document_id = %(document_id)s")
            params["document_id"] = str(document_id)
        if external_id:
            conditions.append("external_id = %(external_id)s")
            params["external_id"] = external_id
        if error_category:
            conditions.append("error_category = %(error_category)s")
            params["error_category"] = error_category
        if trace_id:
            conditions.append("trace_id = %(trace_id)s")
            params["trace_id"] = trace_id

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        query = f"""
        SELECT run_id, source_type, source_uri, external_id, document_id, payload_hash,
               status, error_message, error_code, error_category,
               started_at, finished_at, trace_id, retry_count, is_retryable
        FROM ingestion_runs
        {where_clause}
        ORDER BY started_at DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                return cur.fetchall() or []

    def get_run_events(self, run_id: UUID) -> list[dict]:
        """Get the lifecycle event history for a run.
        
        Returns chronological list of status transitions, useful for
        debugging "what happened between state X and state Y?"
        """
        query = """
        SELECT event_id, run_id, status, previous_status, 
               event_timestamp, duration_since_previous_ms, metadata
        FROM ingestion_run_events
        WHERE run_id = %(run_id)s
        ORDER BY event_timestamp ASC
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, {"run_id": str(run_id)})
                return cur.fetchall() or []

    def count_by_status(
        self,
        since: Optional[datetime] = None,
        source_type: Optional[str] = None,
    ) -> dict[str, int]:
        """Count runs by status for dashboard metrics.
        
        Args:
            since: Only count runs started after this time
            source_type: Filter by source type
            
        Returns:
            Dict mapping status → count
        """
        conditions = []
        params: dict = {}
        
        if since:
            conditions.append("started_at >= %(since)s")
            params["since"] = since
        if source_type:
            conditions.append("source_type = %(source_type)s")
            params["source_type"] = source_type
        
        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)
        
        query = f"""
        SELECT status, COUNT(*) as count
        FROM ingestion_runs
        {where_clause}
        GROUP BY status
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                rows = cur.fetchall() or []
                return {row["status"]: row["count"] for row in rows}

    def count_by_error_category(
        self,
        since: Optional[datetime] = None,
    ) -> dict[str, int]:
        """Count failed runs by error category for alerting.
        
        Returns:
            Dict mapping error_category → count
        """
        conditions = ["status = 'failed'", "error_category IS NOT NULL"]
        params: dict = {}
        
        if since:
            conditions.append("started_at >= %(since)s")
            params["since"] = since
        
        where_clause = "WHERE " + " AND ".join(conditions)
        
        query = f"""
        SELECT error_category, COUNT(*) as count
        FROM ingestion_runs
        {where_clause}
        GROUP BY error_category
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                rows = cur.fetchall() or []
                return {row["error_category"]: row["count"] for row in rows}
