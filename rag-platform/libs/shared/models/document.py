"""Canonical document schemas for ingestion."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid5

from pydantic import BaseModel, Field

from libs.shared.models.lifecycle import IngestionSource, IngestionState


NAMESPACE_DOCUMENT = UUID("8b62f0a4-2d2f-4b87-9a7f-92f4edb8a8c3")


def make_document_id(
    source_type: IngestionSource,
    external_id: str,
    tenant_id: Optional[str] = None,
) -> UUID:
    """Create a stable document ID from natural keys."""
    key = f"{source_type}:{external_id}:{tenant_id or 'default'}"
    return uuid5(NAMESPACE_DOCUMENT, key)


class DocumentMetadata(BaseModel):
    source_type: IngestionSource
    source_uri: Optional[str] = None
    tenant_id: Optional[str] = None
    owners: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    labels: Optional[List[str]] = None
    environment: Optional[str] = None
    service: Optional[str] = None
    component: Optional[str] = None
    access_policy: Optional[Dict[str, Any]] = None
    extra: Dict[str, Any] = Field(default_factory=dict)


class CanonicalDocument(BaseModel):
    document_id: UUID
    external_id: str
    title: Optional[str] = None
    metadata: DocumentMetadata
    hash_content: str
    created_at: datetime
    updated_at: datetime
    ingested_at: datetime
    lifecycle_state: IngestionState


class DocumentVersion(BaseModel):
    document_id: UUID
    version_id: UUID
    version_index: int
    body_raw_uri: Optional[str] = None
    body_text: Optional[str] = None
    source_payload_uri: Optional[str] = None
    hash_payload: str
    valid_from: datetime
    valid_to: Optional[datetime] = None
    is_active: bool = True
