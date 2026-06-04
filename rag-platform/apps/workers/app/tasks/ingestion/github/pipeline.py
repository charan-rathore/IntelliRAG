"""GitHub ingestion pipeline: issue/comment -> raw payload -> canonical document -> Postgres."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from pydantic import ValidationError

from libs.connectors.sinks.filesystem.raw_payload_store import RawPayloadStore
from libs.connectors.sinks.postgres.document_repository import PostgresDocumentRepository
from libs.connectors.sinks.postgres.ingestion_run_repository import IngestionRunRepository
from libs.connectors.sinks.postgres.raw_payload_repository import RawPayloadRepository
from libs.connectors.sources.github.fetcher import GitHubFetcher
from libs.connectors.sources.github.schemas import GitHubCommentPayload, GitHubIssuePayload
from libs.connectors.sources.github.transformer import GitHubTransformer
from libs.shared.logging.structured import get_logger, log_event
from libs.shared.models.lifecycle import IngestionRunStatus, IngestionSource, IngestionState


logger = get_logger(__name__)


def _prepare_version_transition(active: dict | None, now: datetime) -> tuple[int, bool]:
    if active:
        version_index = int(active.get("version_index", 0)) + 1
        return version_index, True
    return 1, False


def ingest_github_issues_to_postgres(
    fetcher: GitHubFetcher,
    transformer: GitHubTransformer,
    repository: PostgresDocumentRepository,
    raw_payload_repo: RawPayloadRepository,
    payload_store: RawPayloadStore,
    ingestion_run_repo: IngestionRunRepository,
    params: Dict[str, Any],
) -> int:
    """Fetch GitHub issues and persist canonical documents to Postgres."""
    processed = 0
    for payload in fetcher.fetch_issues(params):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        source_uri = payload.get("html_url") if isinstance(payload, dict) else None
        external_id = str(payload.get("id")) if isinstance(payload, dict) else None
        ingestion_run_repo.create_run(
            run_id=run_id,
            source_type=IngestionSource.GITHUB_ISSUE.value,
            source_uri=source_uri,
            external_id=external_id,
            status=IngestionRunStatus.RECEIVED.value,
            started_at=now,
        )
        log_event(
            logger,
            "ingestion_received",
            "Received GitHub issue payload.",
            {
                "run_id": str(run_id),
                "source_type": IngestionSource.GITHUB_ISSUE.value,
                "source_uri": source_uri,
                "external_id": external_id,
            },
        )
        try:
            GitHubIssuePayload.model_validate(payload)
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.VALIDATED.value,
            )
        except ValidationError as exc:
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=str(exc),
            )
            log_event(
                logger,
                "ingestion_validation_failed",
                "GitHub issue payload validation failed.",
                {"run_id": str(run_id), "error": str(exc)},
            )
            continue

        document, version = transformer.issue_to_document(payload)
        ingestion_run_repo.update_status(
            run_id=run_id,
            status=IngestionRunStatus.DEDUPE_CHECKED.value,
            payload_hash=version.hash_payload,
        )

        try:
            with psycopg.connect(repository.dsn, row_factory=dict_row) as conn:
                active = repository.get_active_version(document.document_id, conn=conn)
                if active and active.get("hash_payload") == version.hash_payload:
                    ingestion_run_repo.update_status(
                        run_id=run_id,
                        status=IngestionRunStatus.SKIPPED_NO_CHANGE.value,
                        finished_at=now,
                        document_id=document.document_id,
                        payload_hash=version.hash_payload,
                        conn=conn,
                    )
                    log_event(
                        logger,
                        "ingestion_no_change",
                        "No changes detected for GitHub issue payload.",
                        {
                            "run_id": str(run_id),
                            "document_id": str(document.document_id),
                            "payload_hash": version.hash_payload,
                        },
                    )
                    conn.commit()
                    continue

                version_index, should_deactivate = _prepare_version_transition(active, now)
                if should_deactivate:
                    repository.deactivate_active_version(document.document_id, now, conn=conn)
                version.version_index = version_index
                version.valid_from = now
                version.is_active = True

                payload_id, storage_uri = payload_store.write_json(document.document_id, payload)
                version.source_payload_uri = storage_uri
                document.lifecycle_state = IngestionState.REGISTERED
                document.ingested_at = now

                ingestion_run_repo.update_status(
                    run_id=run_id,
                    status=IngestionRunStatus.RAW_STORED.value,
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                    conn=conn,
                )
                log_event(
                    logger,
                    "ingestion_raw_stored",
                    "Stored raw GitHub issue payload.",
                    {
                        "run_id": str(run_id),
                        "document_id": str(document.document_id),
                        "payload_hash": version.hash_payload,
                    },
                )

                repository.upsert_document(document, conn=conn)
                repository.insert_versions([version], conn=conn)
                raw_payload_repo.insert_payload(
                    payload_id=payload_id,
                    document_id=document.document_id,
                    source_type=IngestionSource.GITHUB_ISSUE.value,
                    source_uri=document.metadata.source_uri,
                    storage_uri=storage_uri,
                    hash_payload=version.hash_payload,
                    received_at=document.ingested_at,
                    conn=conn,
                )
                ingestion_run_repo.update_status(
                    run_id=run_id,
                    status=IngestionRunStatus.REGISTERED.value,
                    finished_at=now,
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                    conn=conn,
                )
                log_event(
                    logger,
                    "ingestion_registered",
                    "Registered GitHub issue document.",
                    {
                        "run_id": str(run_id),
                        "document_id": str(document.document_id),
                        "version_index": version.version_index,
                    },
                )
                conn.commit()
                processed += 1
        except Exception as exc:  # pylint: disable=broad-except
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=str(exc),
                document_id=document.document_id,
                payload_hash=version.hash_payload,
            )
            log_event(
                logger,
                "ingestion_failed",
                "GitHub issue ingestion failed.",
                {
                    "run_id": str(run_id),
                    "document_id": str(document.document_id),
                    "error": str(exc),
                },
            )
    return processed


def ingest_github_comments_to_postgres(
    fetcher: GitHubFetcher,
    transformer: GitHubTransformer,
    repository: PostgresDocumentRepository,
    raw_payload_repo: RawPayloadRepository,
    payload_store: RawPayloadStore,
    ingestion_run_repo: IngestionRunRepository,
    issue_number: int,
    params: Dict[str, Any],
) -> int:
    """Fetch GitHub issue comments and persist canonical documents to Postgres."""
    processed = 0
    for payload in fetcher.fetch_issue_comments(issue_number, params):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        source_uri = payload.get("html_url") if isinstance(payload, dict) else None
        external_id = str(payload.get("id")) if isinstance(payload, dict) else None
        ingestion_run_repo.create_run(
            run_id=run_id,
            source_type=IngestionSource.GITHUB_ISSUE_COMMENT.value,
            source_uri=source_uri,
            external_id=external_id,
            status=IngestionRunStatus.RECEIVED.value,
            started_at=now,
        )
        log_event(
            logger,
            "ingestion_received",
            "Received GitHub comment payload.",
            {
                "run_id": str(run_id),
                "source_type": IngestionSource.GITHUB_ISSUE_COMMENT.value,
                "source_uri": source_uri,
                "external_id": external_id,
            },
        )
        try:
            GitHubCommentPayload.model_validate(payload)
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.VALIDATED.value,
            )
        except ValidationError as exc:
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=str(exc),
            )
            log_event(
                logger,
                "ingestion_validation_failed",
                "GitHub comment payload validation failed.",
                {"run_id": str(run_id), "error": str(exc)},
            )
            continue

        document, version = transformer.comment_to_document(payload)
        ingestion_run_repo.update_status(
            run_id=run_id,
            status=IngestionRunStatus.DEDUPE_CHECKED.value,
            payload_hash=version.hash_payload,
        )

        try:
            with psycopg.connect(repository.dsn, row_factory=dict_row) as conn:
                active = repository.get_active_version(document.document_id, conn=conn)
                if active and active.get("hash_payload") == version.hash_payload:
                    ingestion_run_repo.update_status(
                        run_id=run_id,
                        status=IngestionRunStatus.SKIPPED_NO_CHANGE.value,
                        finished_at=now,
                        document_id=document.document_id,
                        payload_hash=version.hash_payload,
                        conn=conn,
                    )
                    log_event(
                        logger,
                        "ingestion_no_change",
                        "No changes detected for GitHub comment payload.",
                        {
                            "run_id": str(run_id),
                            "document_id": str(document.document_id),
                            "payload_hash": version.hash_payload,
                        },
                    )
                    conn.commit()
                    continue

                version_index, should_deactivate = _prepare_version_transition(active, now)
                if should_deactivate:
                    repository.deactivate_active_version(document.document_id, now, conn=conn)
                version.version_index = version_index
                version.valid_from = now
                version.is_active = True

                payload_id, storage_uri = payload_store.write_json(document.document_id, payload)
                version.source_payload_uri = storage_uri
                document.lifecycle_state = IngestionState.REGISTERED
                document.ingested_at = now

                ingestion_run_repo.update_status(
                    run_id=run_id,
                    status=IngestionRunStatus.RAW_STORED.value,
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                    conn=conn,
                )
                log_event(
                    logger,
                    "ingestion_raw_stored",
                    "Stored raw GitHub comment payload.",
                    {
                        "run_id": str(run_id),
                        "document_id": str(document.document_id),
                        "payload_hash": version.hash_payload,
                    },
                )

                repository.upsert_document(document, conn=conn)
                repository.insert_versions([version], conn=conn)
                raw_payload_repo.insert_payload(
                    payload_id=payload_id,
                    document_id=document.document_id,
                    source_type=IngestionSource.GITHUB_ISSUE_COMMENT.value,
                    source_uri=document.metadata.source_uri,
                    storage_uri=storage_uri,
                    hash_payload=version.hash_payload,
                    received_at=document.ingested_at,
                    conn=conn,
                )
                ingestion_run_repo.update_status(
                    run_id=run_id,
                    status=IngestionRunStatus.REGISTERED.value,
                    finished_at=now,
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                    conn=conn,
                )
                log_event(
                    logger,
                    "ingestion_registered",
                    "Registered GitHub comment document.",
                    {
                        "run_id": str(run_id),
                        "document_id": str(document.document_id),
                        "version_index": version.version_index,
                    },
                )
                conn.commit()
                processed += 1
        except Exception as exc:  # pylint: disable=broad-except
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=str(exc),
                document_id=document.document_id,
                payload_hash=version.hash_payload,
            )
            log_event(
                logger,
                "ingestion_failed",
                "GitHub comment ingestion failed.",
                {
                    "run_id": str(run_id),
                    "document_id": str(document.document_id),
                    "error": str(exc),
                },
            )
    return processed


def reprocess_github_payloads_to_postgres(
    transformer: GitHubTransformer,
    repository: PostgresDocumentRepository,
    raw_payload_repo: RawPayloadRepository,
    ingestion_run_repo: IngestionRunRepository,
    document_id: UUID,
) -> int:
    """Replay previously stored raw payloads for a document."""
    processed = 0
    payload_rows = raw_payload_repo.list_payloads_for_document(document_id)
    for payload_row in payload_rows:
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        ingestion_run_repo.create_run(
            run_id=run_id,
            source_type=payload_row.get("source_type"),
            source_uri=payload_row.get("source_uri"),
            external_id=None,
            status=IngestionRunStatus.RECEIVED.value,
            started_at=now,
        )
        storage_uri = payload_row.get("storage_uri")
        if not storage_uri:
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message="Missing storage_uri for replay payload.",
            )
            continue
        try:
            with open(storage_uri, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except OSError as exc:
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=str(exc),
            )
            continue

        source_type = payload_row.get("source_type")
        try:
            if source_type == IngestionSource.GITHUB_ISSUE.value:
                GitHubIssuePayload.model_validate(payload)
                document, version = transformer.issue_to_document(payload)
            else:
                GitHubCommentPayload.model_validate(payload)
                document, version = transformer.comment_to_document(payload)
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.VALIDATED.value,
                payload_hash=version.hash_payload,
            )
        except ValidationError as exc:
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=str(exc),
            )
            continue

        try:
            with psycopg.connect(repository.dsn, row_factory=dict_row) as conn:
                active = repository.get_active_version(document.document_id, conn=conn)
                if active and active.get("hash_payload") == version.hash_payload:
                    ingestion_run_repo.update_status(
                        run_id=run_id,
                        status=IngestionRunStatus.SKIPPED_NO_CHANGE.value,
                        finished_at=now,
                        document_id=document.document_id,
                        payload_hash=version.hash_payload,
                        conn=conn,
                    )
                    conn.commit()
                    continue
                version_index, should_deactivate = _prepare_version_transition(active, now)
                if should_deactivate:
                    repository.deactivate_active_version(document.document_id, now, conn=conn)
                version.version_index = version_index
                version.valid_from = now
                version.is_active = True
                version.source_payload_uri = storage_uri
                document.lifecycle_state = IngestionState.REGISTERED
                document.ingested_at = now
                repository.upsert_document(document, conn=conn)
                repository.insert_versions([version], conn=conn)
                ingestion_run_repo.update_status(
                    run_id=run_id,
                    status=IngestionRunStatus.REGISTERED.value,
                    finished_at=now,
                    document_id=document.document_id,
                    payload_hash=version.hash_payload,
                    conn=conn,
                )
                conn.commit()
                processed += 1
        except Exception as exc:  # pylint: disable=broad-except
            ingestion_run_repo.update_status(
                run_id=run_id,
                status=IngestionRunStatus.FAILED.value,
                finished_at=now,
                error_message=str(exc),
                document_id=document.document_id,
                payload_hash=version.hash_payload,
            )
    return processed
