"""Ingestion service boundary (API orchestration only)."""

from typing import Any, Dict

from apps.api.app.adapters.ingestion.celery_client import enqueue_task


class IngestionService:
    """Coordinates ingestion requests and hands off to async workers."""

    def enqueue_github_ingestion(self, payload: Dict[str, Any]) -> None:
        """Validate request, create ingestion record, enqueue worker task."""
        enqueue_task(
            "apps.workers.app.tasks.ingestion.github.tasks.ingest_github_issues",
            payload,
        )

    def enqueue_github_comments_ingestion(self, payload: Dict[str, Any]) -> None:
        """Enqueue GitHub issue comments ingestion."""
        enqueue_task(
            "apps.workers.app.tasks.ingestion.github.tasks.ingest_github_issue_comments",
            payload,
        )

    def enqueue_markdown_ingestion(self, payload: Dict[str, Any]) -> None:
        """Validate request, create ingestion record, enqueue worker task."""
        enqueue_task(
            "apps.workers.app.tasks.ingestion.markdown.tasks.ingest_markdown_documents",
            payload,
        )
