"""RAG query API endpoints."""

from __future__ import annotations

import json
from typing import Iterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from apps.api.app.schemas.query import CitationResponse, QueryRequest, QueryResponse
from apps.api.app.services.query.service import QueryService
from apps.api.app.services.query.sources import DOC_TITLES, list_sources, resolve_doc_id


router = APIRouter(prefix="/query", tags=["query"])


def _citation_payload(citation) -> CitationResponse:
    meta = {}
    doc_id = resolve_doc_id(meta, getattr(citation, "chunk_id", "") or "")
    if not doc_id and getattr(citation, "source_text", ""):
        text = citation.source_text.lower()
        if "kubernetes" in text or "pod scheduling" in text:
            doc_id = "k8s-incident"
        elif "asyncio" in text or "aiohttp" in text:
            doc_id = "python-async"
    title = DOC_TITLES.get(doc_id) if doc_id else None
    url = f"/sources/{doc_id}" if doc_id else None
    return CitationResponse(
        source_index=citation.source_index,
        chunk_id=citation.chunk_id,
        text_snippet=citation.source_text[:280],
        document_id=doc_id or None,
        title=title,
        url=url,
    )


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

    citations = [_citation_payload(c) for c in result.generation.citations]

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


@router.post("/stream")
def query_rag_stream(request: QueryRequest) -> StreamingResponse:
    """SSE stream: stage updates + live tokens + final response payload."""
    service = QueryService.get()

    def event_gen() -> Iterator[str]:
        try:
            for event in service.stream_query(
                question=request.question,
                retrieval_mode=request.retrieval_mode,
                top_k=request.top_k,
                include_eval_scores=request.include_eval_scores,
            ):
                etype = event.get("type", "message")
                payload = {k: v for k, v in event.items() if k != "type"}
                yield f"event: {etype}\ndata: {json.dumps(payload)}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/health")
def query_health() -> dict:
    """Check query pipeline readiness and active backends."""
    service = QueryService.get()
    return service.health()


@router.get("/sources")
def query_sources() -> dict:
    """List indexed documents available for grounded answers."""
    return {"sources": list_sources()}
