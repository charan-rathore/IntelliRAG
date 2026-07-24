"""API schemas for RAG query requests and responses."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    retrieval_mode: str = Field(default="hybrid", pattern="^(dense|keyword|hybrid)$")
    top_k: int = Field(default=5, ge=1, le=20)
    # Interactive UI defaults to False for lower latency; CI/debug can opt in.
    include_eval_scores: bool = False


class CitationResponse(BaseModel):
    source_index: int
    chunk_id: str
    text_snippet: str
    document_id: Optional[str] = None
    title: Optional[str] = None
    url: Optional[str] = None


class QueryResponse(BaseModel):
    query: str
    answer: str
    trace_id: str
    refused: bool
    model: str
    citations: List[CitationResponse]
    layer_latencies_ms: Dict[str, float]
    eval_scores: Optional[Dict[str, float]] = None
    total_latency_ms: float
