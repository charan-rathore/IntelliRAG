"""Celery tasks for GitHub ingestion."""

from __future__ import annotations

import os
from uuid import UUID
from typing import Any, Dict, Iterable

from apps.workers.app.core.celery_app import celery_app
from apps.workers.app.tasks.ingestion.github.pipeline import (
    ingest_github_comments_to_postgres,
    ingest_github_issues_to_postgres,
    reprocess_github_payloads_to_postgres,
)
from libs.connectors.sinks.filesystem.raw_payload_store import RawPayloadStore
from libs.connectors.sinks.postgres.document_repository import PostgresDocumentRepository
from libs.connectors.sinks.postgres.ingestion_run_repository import IngestionRunRepository
from libs.connectors.sinks.postgres.raw_payload_repository import RawPayloadRepository
from libs.connectors.sources.github.fetcher import GitHubFetcher
from libs.connectors.sources.github.transformer import GitHubTransformer


@celery_app.task(name="apps.workers.app.tasks.ingestion.github.tasks.ingest_github_issues")
def ingest_github_issues(request_payload: Dict[str, Any]) -> int:
    """Fetch issues and persist canonical documents to Postgres."""
    dsn = os.environ["POSTGRES_DSN"]
    token = os.environ["GITHUB_TOKEN"]
    base_url = os.getenv("GITHUB_API_BASE_URL", "https://api.github.com")
    raw_payload_dir = os.getenv("RAW_PAYLOAD_DIR", "/tmp/rag_platform/raw")

    fetcher = GitHubFetcher(base_url=base_url, token=token)
    transformer = GitHubTransformer(tenant_id=request_payload.get("tenant_id"))
    repository = PostgresDocumentRepository(dsn=dsn)
    raw_payload_repo = RawPayloadRepository(dsn=dsn)
    ingestion_run_repo = IngestionRunRepository(dsn=dsn)
    payload_store = RawPayloadStore(base_dir=raw_payload_dir)

    params = {
        "owner": request_payload["owner"],
        "repo": request_payload["repo"],
        "state": request_payload.get("state", "all"),
        "per_page": request_payload.get("per_page", 100),
        "since": request_payload.get("since"),
    }
    return ingest_github_issues_to_postgres(
        fetcher,
        transformer,
        repository,
        raw_payload_repo,
        payload_store,
        ingestion_run_repo,
        params,
    )


@celery_app.task(name="apps.workers.app.tasks.ingestion.github.tasks.ingest_github_issue_comments")
def ingest_github_issue_comments(request_payload: Dict[str, Any]) -> int:
    """Fetch issue comments and persist canonical documents to Postgres."""
    dsn = os.environ["POSTGRES_DSN"]
    token = os.environ["GITHUB_TOKEN"]
    base_url = os.getenv("GITHUB_API_BASE_URL", "https://api.github.com")
    raw_payload_dir = os.getenv("RAW_PAYLOAD_DIR", "/tmp/rag_platform/raw")

    fetcher = GitHubFetcher(base_url=base_url, token=token)
    transformer = GitHubTransformer(tenant_id=request_payload.get("tenant_id"))
    repository = PostgresDocumentRepository(dsn=dsn)
    raw_payload_repo = RawPayloadRepository(dsn=dsn)
    ingestion_run_repo = IngestionRunRepository(dsn=dsn)
    payload_store = RawPayloadStore(base_dir=raw_payload_dir)

    params = {
        "owner": request_payload["owner"],
        "repo": request_payload["repo"],
        "per_page": request_payload.get("per_page", 100),
    }
    issue_numbers: Iterable[int]
    if request_payload.get("issue_numbers"):
        issue_numbers = request_payload["issue_numbers"]
    elif request_payload.get("issue_number"):
        issue_numbers = [request_payload["issue_number"]]
    else:
        return 0

    processed = 0
    for issue_number in issue_numbers:
        processed += ingest_github_comments_to_postgres(
            fetcher,
            transformer,
            repository,
            raw_payload_repo,
            payload_store,
            ingestion_run_repo,
            issue_number,
            params,
        )
    return processed


@celery_app.task(name="apps.workers.app.tasks.ingestion.github.tasks.reprocess_github_document")
def reprocess_github_document(request_payload: Dict[str, Any]) -> int:
    """Replay stored raw payloads for a GitHub document by document_id."""
    dsn = os.environ["POSTGRES_DSN"]
    transformer = GitHubTransformer(tenant_id=request_payload.get("tenant_id"))
    repository = PostgresDocumentRepository(dsn=dsn)
    raw_payload_repo = RawPayloadRepository(dsn=dsn)
    ingestion_run_repo = IngestionRunRepository(dsn=dsn)

    document_id = UUID(request_payload["document_id"])
    return reprocess_github_payloads_to_postgres(
        transformer,
        repository,
        raw_payload_repo,
        ingestion_run_repo,
        document_id,
    )
