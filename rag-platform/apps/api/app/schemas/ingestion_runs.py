"""API schemas for ingestion run queries."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class IngestionRunResponse(BaseModel):
    run_id: UUID
    source_type: str
    source_uri: Optional[str] = None
    external_id: Optional[str] = None
    document_id: Optional[UUID] = None
    payload_hash: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
