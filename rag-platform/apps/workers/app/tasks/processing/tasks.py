"""Celery tasks for post-ingestion processing."""

from __future__ import annotations

import logging
import os
from uuid import UUID

from apps.workers.app.core.celery_app import (
    RetryableTaskError,
    celery_app,
    get_retry_kwargs,
)
from libs.rag.processing.pipeline import ProcessingPipeline

logger = logging.getLogger(__name__)


def _get_dsn() -> str:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL environment variable is required")
    return dsn


@celery_app.task(
    bind=True,
    name="apps.workers.app.tasks.processing.process_document",
    max_retries=3,
    queue="processing",
)
def process_document_task(self, document_id: str) -> dict:
    """Process a registered document through chunking and indexing."""
    try:
        pipeline = ProcessingPipeline(dsn=_get_dsn())
        result = pipeline.process_document(UUID(document_id))
        if not result.success:
            raise RetryableTaskError(result.error_message or "Processing failed")
        return {
            "document_id": str(result.document_id),
            "version_id": str(result.version_id),
            "chunks_created": result.chunks_created,
            "chunks_indexed": result.chunks_indexed,
            "lifecycle_state": result.lifecycle_state,
        }
    except RetryableTaskError:
        raise
    except Exception as exc:
        logger.error(f"Processing failed for {document_id}: {exc}", exc_info=True)
        raise self.retry(**get_retry_kwargs(exc)) from exc
