"""API schemas for ingestion run queries with enhanced observability fields."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class IngestionRunResponse(BaseModel):
    """Response schema for ingestion run queries.
    
    Includes enhanced observability fields:
    - error_code/error_category: Structured error classification
    - trace_id: Correlation ID for distributed tracing
    - retry_count: Number of retry attempts
    - is_retryable: Whether the error is retry-safe
    """
    model_config = ConfigDict(from_attributes=True)
    
    run_id: UUID
    source_type: str
    source_uri: Optional[str] = None
    external_id: Optional[str] = None
    document_id: Optional[UUID] = None
    payload_hash: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    error_category: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    trace_id: Optional[str] = None
    retry_count: int = 0
    is_retryable: Optional[bool] = None


class IngestionRunEventResponse(BaseModel):
    """Response schema for ingestion run lifecycle events."""
    model_config = ConfigDict(from_attributes=True)
    
    event_id: UUID
    run_id: UUID
    status: str
    previous_status: Optional[str] = None
    event_timestamp: datetime
    duration_since_previous_ms: Optional[int] = None
    metadata: Optional[dict] = None


class IngestionStatsResponse(BaseModel):
    """Response schema for ingestion statistics."""
    total_runs: int
    by_status: dict[str, int]
    by_error_category: dict[str, int]
