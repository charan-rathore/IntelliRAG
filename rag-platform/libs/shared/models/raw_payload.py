"""Raw payload metadata schema."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class RawPayloadMetadata(BaseModel):
    payload_id: UUID
    document_id: UUID
    source_type: str
    source_uri: Optional[str] = None
    storage_uri: str
    hash_payload: str
    received_at: datetime
