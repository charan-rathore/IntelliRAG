"""Ingestion API endpoints (V1)."""

from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from apps.api.app.middleware.webhook import verify_webhook_signature
from apps.api.app.schemas.ingestion import GitHubIngestionRequest, GitHubCommentsIngestionRequest
from apps.api.app.schemas.ingestion_runs import IngestionRunResponse
from apps.api.app.services.ingestion.service import IngestionService
from libs.connectors.sinks.postgres.ingestion_run_repository import IngestionRunRepository


router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.post("/github/issues")
def ingest_github_issues(
    request: GitHubIngestionRequest,
    _: None = Depends(verify_webhook_signature),
) -> dict:
	"""Enqueue GitHub issue ingestion."""
	service = IngestionService()
	service.enqueue_github_ingestion(request.model_dump())
	return {"status": "queued"}


@router.post("/github/comments")
def ingest_github_comments(
    request: GitHubCommentsIngestionRequest,
    _: None = Depends(verify_webhook_signature),
) -> dict:
	"""Enqueue GitHub issue comment ingestion."""
	service = IngestionService()
	service.enqueue_github_comments_ingestion(request.model_dump())
	return {"status": "queued"}


@router.get("/runs/{run_id}", response_model=IngestionRunResponse)
def get_ingestion_run(run_id: UUID) -> IngestionRunResponse:
	"""Fetch an ingestion run by run_id."""
	dsn = os.environ["POSTGRES_DSN"]
	repo = IngestionRunRepository(dsn=dsn)
	row = repo.get_run(run_id)
	if not row:
		raise HTTPException(status_code=404, detail="Ingestion run not found.")
	return IngestionRunResponse(**row)


@router.get("/runs", response_model=list[IngestionRunResponse])
def list_ingestion_runs(
    status: str | None = None,
    source_type: str | None = None,
    document_id: UUID | None = None,
    external_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[IngestionRunResponse]:
	"""List ingestion runs with optional filters."""
	dsn = os.environ["POSTGRES_DSN"]
	repo = IngestionRunRepository(dsn=dsn)
	rows = repo.list_runs(
		status=status,
		source_type=source_type,
		document_id=document_id,
		external_id=external_id,
		limit=limit,
		offset=offset,
	)
	return [IngestionRunResponse(**row) for row in rows]
