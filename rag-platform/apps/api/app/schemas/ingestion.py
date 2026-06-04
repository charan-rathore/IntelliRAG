"""API schemas for ingestion requests."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class GitHubIngestionRequest(BaseModel):
    owner: str
    repo: str
    tenant_id: Optional[str] = None
    state: str = "all"
    per_page: int = Field(default=100, ge=1, le=100)
    since: Optional[datetime] = None


class GitHubCommentsIngestionRequest(BaseModel):
    owner: str
    repo: str
    issue_number: Optional[int] = None
    issue_numbers: Optional[list[int]] = None
    tenant_id: Optional[str] = None
    per_page: int = Field(default=100, ge=1, le=100)
