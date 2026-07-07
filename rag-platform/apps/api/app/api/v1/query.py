"""RAG query API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from apps.api.app.schemas.query import CitationResponse, QueryRequest, QueryResponse
from apps.api.app.services.query.service import QueryService


router = APIRouter(prefix="/query", tags=["query"])


@router.post("", response_model=QueryResponse)
def query_rag(request: QueryRequest) -> QueryResponse:
    """Execute a full instrumented RAG query."""
    try:
        service = QueryService.get()
        result = service.query(
            question=request.question,
            retrieval_mode=request.retrieval_mode,
            top_k=request.top_k,
            include_eval_scores=request.include_eval_scores,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Query pipeline unavailable: {exc}") from exc

    citations = [
        CitationResponse(
            source_index=c.source_index,
            chunk_id=c.chunk_id,
            text_snippet=c.source_text[:200],
        )
        for c in result.generation.citations
    ]

    return QueryResponse(
        query=result.query,
        answer=result.answer,
        trace_id=result.trace_id,
        refused=result.refused,
        model=result.generation.model,
        citations=citations,
        layer_latencies_ms=result.layer_latencies,
        eval_scores=result.eval_scores if request.include_eval_scores else None,
        total_latency_ms=result.total_latency_ms,
    )


@router.get("/health")
def query_health() -> dict:
    """Check query pipeline readiness."""
    service = QueryService.get()
    try:
        service._ensure_pipeline()
        return {"status": "ready", "persist_dir": service.persist_dir}
    except Exception as exc:
        return {"status": "degraded", "error": str(exc)}
