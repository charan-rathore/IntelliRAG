"""Reranking result models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from libs.rag.retrieval.models import RetrievedChunk


@dataclass
class RerankedChunk(RetrievedChunk):
    """A chunk after reranking with original retrieval rank preserved."""

    original_rank: int = 0
    original_score: float = 0.0
    rerank_score: float = 0.0


@dataclass
class RerankResult:
    """Result of reranking a candidate set."""

    query: str
    chunks: List[RerankedChunk]
    reranker: str
    candidates_in: int = 0
    candidates_out: int = 0
    retrieval_latency_ms: float = 0.0
    rerank_latency_ms: float = 0.0
    total_latency_ms: float = 0.0

    @property
    def top_chunk(self) -> Optional[RerankedChunk]:
        return self.chunks[0] if self.chunks else None
