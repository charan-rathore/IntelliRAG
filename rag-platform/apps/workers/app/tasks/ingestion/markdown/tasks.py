"""Celery tasks for Markdown ingestion."""

from typing import Any, Dict


def ingest_markdown_documents(request_payload: Dict[str, Any]) -> None:
    """Fetch or read markdown docs and normalize to canonical docs."""
    raise NotImplementedError
