"""Structured logging with trace correlation for production observability.

This module provides JSON-structured logging with:
- Trace correlation (trace_id propagated through entire request)
- Event-based logging for machine parsing
- Duration tracking for performance analysis
- Context management for nested operations

WHY STRUCTURED LOGGING MATTERS:
In production, you'll have thousands of concurrent ingestions. Without trace
correlation, debugging "why did document X fail?" requires grep archaeology
through millions of log lines. With trace_id, you filter to exactly one request.

USAGE:
    from libs.shared.logging.structured import get_logger, IngestionLogger

    logger = get_logger(__name__)
    
    # Simple event logging
    log_event(logger, "ingestion_started", "Starting ingestion", {"doc_id": "123"})
    
    # With trace correlation (recommended for production)
    ing_logger = IngestionLogger(run_id=run_id, trace_id=trace_id)
    ing_logger.received(source_type="github_issue", external_id="456")
    ing_logger.validated(payload_hash="abc123")
    ing_logger.failed(error_code="validation_schema_mismatch", error="Missing field")
"""

from __future__ import annotations

import contextvars
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID, uuid4


# Context variable for trace correlation across async boundaries
_trace_context: contextvars.ContextVar[Dict[str, Any]] = contextvars.ContextVar(
    "trace_context", default={}
)


class JsonLogFormatter(logging.Formatter):
    """JSON formatter with automatic timestamp and trace correlation.
    
    Output format:
    {
        "timestamp": "2024-01-15T10:30:00.123456Z",
        "level": "INFO",
        "logger": "ingestion.github",
        "message": "Document registered",
        "event": "ingestion_registered",
        "trace_id": "abc-123",
        "run_id": "def-456",
        "document_id": "ghi-789",
        "duration_ms": 150
    }
    """
    def format(self, record: logging.LogRecord) -> str:
        # Base payload with timestamp
        payload: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        
        # Add trace context if available
        trace_ctx = _trace_context.get()
        if trace_ctx:
            payload.update(trace_ctx)
        
        # Add event name if specified
        if hasattr(record, "event"):
            payload["event"] = record.event
        
        # Add custom fields
        if hasattr(record, "fields") and isinstance(record.fields, dict):
            payload.update(record.fields)
        
        # Add exception info if present
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        
        return json.dumps(payload, default=str)


def get_logger(name: str) -> logging.Logger:
    """Get a logger configured for JSON structured output.
    
    Args:
        name: Logger name, typically __name__ of the calling module
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonLogFormatter())
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def set_trace_context(
    trace_id: Optional[str] = None,
    run_id: Optional[str] = None,
    **extra: Any,
) -> None:
    """Set trace context for the current execution context.
    
    This context is automatically included in all subsequent log messages
    within the same async context (or thread).
    
    Args:
        trace_id: Unique ID for the entire request chain
        run_id: Unique ID for this specific ingestion run
        **extra: Additional context fields
    """
    ctx = {}
    if trace_id:
        ctx["trace_id"] = trace_id
    if run_id:
        ctx["run_id"] = run_id
    ctx.update(extra)
    _trace_context.set(ctx)


def clear_trace_context() -> None:
    """Clear the trace context (call at end of request processing)."""
    _trace_context.set({})


def generate_trace_id() -> str:
    """Generate a new trace ID for request correlation."""
    return str(uuid4())


def log_event(
    logger: logging.Logger,
    event: str,
    message: str,
    fields: Optional[Dict[str, Any]] = None,
    level: int = logging.INFO,
) -> None:
    """Log a structured event with optional fields.
    
    Args:
        logger: Logger instance
        event: Event name (machine-readable, e.g., "ingestion_received")
        message: Human-readable message
        fields: Additional structured fields
        level: Log level (default INFO)
    """
    logger.log(level, message, extra={"event": event, "fields": fields or {}})


class IngestionLogger:
    """Specialized logger for ingestion pipeline with lifecycle events.
    
    Provides type-safe logging methods for each ingestion lifecycle stage.
    Automatically includes run_id and trace_id in all log messages.
    
    USAGE:
        logger = IngestionLogger(run_id=run_id)
        logger.received(source_type="github_issue", external_id="123")
        
        with logger.timed("transformation"):
            document, version = transformer.issue_to_document(payload)
        
        logger.registered(document_id=doc.document_id, version_index=1)
    
    The timed() context manager automatically logs duration_ms.
    """
    
    def __init__(
        self,
        run_id: UUID | str,
        trace_id: Optional[str] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self._run_id = str(run_id)
        self._trace_id = trace_id or generate_trace_id()
        self._logger = logger or get_logger("ingestion")
        self._start_time = time.monotonic()
        
        # Set trace context for this run
        set_trace_context(
            trace_id=self._trace_id,
            run_id=self._run_id,
        )
    
    @property
    def trace_id(self) -> str:
        return self._trace_id
    
    @property
    def run_id(self) -> str:
        return self._run_id
    
    def _log(
        self,
        event: str,
        message: str,
        level: int = logging.INFO,
        **fields: Any,
    ) -> None:
        """Internal logging method with automatic context."""
        fields["run_id"] = self._run_id
        fields["trace_id"] = self._trace_id
        fields["elapsed_ms"] = int((time.monotonic() - self._start_time) * 1000)
        log_event(self._logger, event, message, fields, level)
    
    def received(
        self,
        source_type: str,
        external_id: Optional[str] = None,
        source_uri: Optional[str] = None,
    ) -> None:
        """Log ingestion received event."""
        self._log(
            "ingestion_received",
            f"Received {source_type} payload",
            source_type=source_type,
            external_id=external_id,
            source_uri=source_uri,
        )
    
    def validated(self, payload_hash: str) -> None:
        """Log successful validation."""
        self._log(
            "ingestion_validated",
            "Payload validated successfully",
            payload_hash=payload_hash,
        )
    
    def validation_failed(
        self,
        error_code: str,
        error_message: str,
        error_details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log validation failure."""
        self._log(
            "ingestion_validation_failed",
            f"Validation failed: {error_message}",
            level=logging.WARNING,
            error_code=error_code,
            error_message=error_message,
            error_details=error_details,
        )
    
    def dedupe_checked(
        self,
        document_id: UUID | str,
        payload_hash: str,
        is_duplicate: bool,
    ) -> None:
        """Log deduplication check result."""
        self._log(
            "ingestion_dedupe_checked",
            "Deduplication check complete",
            document_id=str(document_id),
            payload_hash=payload_hash,
            is_duplicate=is_duplicate,
        )
    
    def skipped_no_change(
        self,
        document_id: UUID | str,
        payload_hash: str,
    ) -> None:
        """Log idempotent skip (no changes detected)."""
        self._log(
            "ingestion_skipped_no_change",
            "No changes detected, skipping",
            document_id=str(document_id),
            payload_hash=payload_hash,
        )
    
    def raw_stored(
        self,
        document_id: UUID | str,
        storage_uri: str,
        payload_hash: str,
    ) -> None:
        """Log raw payload storage."""
        self._log(
            "ingestion_raw_stored",
            "Raw payload stored",
            document_id=str(document_id),
            storage_uri=storage_uri,
            payload_hash=payload_hash,
        )
    
    def registered(
        self,
        document_id: UUID | str,
        version_index: int,
        is_new_document: bool = False,
    ) -> None:
        """Log successful document registration."""
        action = "created" if is_new_document else "updated"
        self._log(
            "ingestion_registered",
            f"Document {action} successfully",
            document_id=str(document_id),
            version_index=version_index,
            is_new_document=is_new_document,
        )
    
    def failed(
        self,
        error_code: str,
        error_message: str,
        document_id: Optional[UUID | str] = None,
        error_details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log ingestion failure."""
        self._log(
            "ingestion_failed",
            f"Ingestion failed: {error_message}",
            level=logging.ERROR,
            error_code=error_code,
            error_message=error_message,
            document_id=str(document_id) if document_id else None,
            error_details=error_details,
        )
    
    def timed(self, operation: str) -> "_TimedOperation":
        """Context manager for timing operations.
        
        Usage:
            with logger.timed("transformation"):
                doc, version = transformer.issue_to_document(payload)
        
        Logs:
            {"event": "operation_completed", "operation": "transformation", "duration_ms": 45}
        """
        return _TimedOperation(self, operation)
    
    def complete(self) -> None:
        """Log run completion and clear trace context."""
        total_ms = int((time.monotonic() - self._start_time) * 1000)
        self._log(
            "ingestion_run_completed",
            f"Ingestion run completed in {total_ms}ms",
            total_duration_ms=total_ms,
        )
        clear_trace_context()


class _TimedOperation:
    """Context manager for timing operations within ingestion."""
    
    def __init__(self, logger: IngestionLogger, operation: str) -> None:
        self._logger = logger
        self._operation = operation
        self._start: float = 0
    
    def __enter__(self) -> "_TimedOperation":
        self._start = time.monotonic()
        return self
    
    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        duration_ms = int((time.monotonic() - self._start) * 1000)
        if exc_type is None:
            self._logger._log(
                "operation_completed",
                f"Operation '{self._operation}' completed",
                operation=self._operation,
                duration_ms=duration_ms,
            )
        else:
            self._logger._log(
                "operation_failed",
                f"Operation '{self._operation}' failed",
                level=logging.ERROR,
                operation=self._operation,
                duration_ms=duration_ms,
                error_type=exc_type.__name__ if exc_type else None,
            )
