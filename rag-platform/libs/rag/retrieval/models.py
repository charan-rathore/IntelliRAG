"""Retrieval result models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class RetrievedChunk:
    """A chunk returned by a retriever."""

    chunk_id: str
    text: str
    score: float
    rank: int
    retriever: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievalResult:
    """Result of a retrieval query."""

    query: str
    chunks: List[RetrievedChunk]
    retriever: str
    latency_ms: float = 0.0
    total_candidates: int = 0

    @property
    def top_chunk(self) -> Optional[RetrievedChunk]:
        return self.chunks[0] if self.chunks else None
