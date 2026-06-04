"""Pydantic schemas for GitHub payload validation."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class GitHubUser(BaseModel):
    model_config = ConfigDict(extra="allow")

    login: str


class GitHubIssuePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    html_url: str
    title: Optional[str] = None
    body: Optional[str] = None
    created_at: str
    updated_at: str
    user: GitHubUser
    labels: List[Dict[str, Any]] = Field(default_factory=list)
    repository_url: Optional[str] = None
    number: Optional[int] = None
    state: Optional[str] = None


class GitHubCommentPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    html_url: str
    body: Optional[str] = None
    created_at: str
    updated_at: str
    user: GitHubUser
    issue_url: Optional[str] = None
