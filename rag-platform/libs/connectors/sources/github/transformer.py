"""Transforms GitHub payloads into canonical documents."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from libs.shared.models.document import (
    CanonicalDocument,
    DocumentMetadata,
    DocumentVersion,
    make_document_id,
)
from libs.shared.models.lifecycle import IngestionSource, IngestionState


class GitHubTransformer:
    def __init__(self, tenant_id: Optional[str] = None) -> None:
        self._tenant_id = tenant_id

    def issue_to_document(self, payload: Dict[str, Any]) -> tuple[CanonicalDocument, DocumentVersion]:
        """Transform a GitHub issue payload into canonical document + version."""
        external_id = str(payload.get("id"))
        source_uri = payload.get("html_url")
        title = payload.get("title")
        body = payload.get("body") or ""

        created_at = _parse_ts(payload.get("created_at"))
        updated_at = _parse_ts(payload.get("updated_at"))
        now = datetime.now(timezone.utc)

        document_id = make_document_id(IngestionSource.GITHUB_ISSUE, external_id, self._tenant_id)
        hash_content = _hash_text(body)

        metadata = DocumentMetadata(
            source_type=IngestionSource.GITHUB_ISSUE,
            source_uri=source_uri,
            tenant_id=self._tenant_id,
            labels=[label.get("name") for label in payload.get("labels", [])],
            owners=[payload.get("user", {}).get("login")],
            extra={
                "repo": payload.get("repository_url"),
                "issue_number": payload.get("number"),
                "state": payload.get("state"),
                "is_pull_request": "pull_request" in payload,
            },
        )

        document = CanonicalDocument(
            document_id=document_id,
            external_id=external_id,
            title=title,
            metadata=metadata,
            hash_content=hash_content,
            created_at=created_at,
            updated_at=updated_at,
            ingested_at=now,
            lifecycle_state=IngestionState.RECEIVED,
        )

        version = DocumentVersion(
            document_id=document_id,
            version_id=uuid4(),
            version_index=1,
            body_text=body,
            source_payload_uri=None,
            hash_payload=_hash_payload(payload),
            valid_from=now,
            is_active=True,
        )
        return document, version

    def comment_to_document(self, payload: Dict[str, Any]) -> tuple[CanonicalDocument, DocumentVersion]:
        """Transform a GitHub issue comment into canonical document + version."""
        external_id = str(payload.get("id"))
        source_uri = payload.get("html_url")
        body = payload.get("body") or ""

        created_at = _parse_ts(payload.get("created_at"))
        updated_at = _parse_ts(payload.get("updated_at"))
        now = datetime.now(timezone.utc)

        document_id = make_document_id(
            IngestionSource.GITHUB_ISSUE_COMMENT,
            external_id,
            self._tenant_id,
        )
        hash_content = _hash_text(body)

        metadata = DocumentMetadata(
            source_type=IngestionSource.GITHUB_ISSUE_COMMENT,
            source_uri=source_uri,
            tenant_id=self._tenant_id,
            owners=[payload.get("user", {}).get("login")],
            extra={
                "issue_url": payload.get("issue_url"),
            },
        )

        document = CanonicalDocument(
            document_id=document_id,
            external_id=external_id,
            title=None,
            metadata=metadata,
            hash_content=hash_content,
            created_at=created_at,
            updated_at=updated_at,
            ingested_at=now,
            lifecycle_state=IngestionState.RECEIVED,
        )

        version = DocumentVersion(
            document_id=document_id,
            version_id=uuid4(),
            version_index=1,
            body_text=body,
            source_payload_uri=None,
            hash_payload=_hash_payload(payload),
            valid_from=now,
            is_active=True,
        )
        return document, version


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _hash_payload(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _parse_ts(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
