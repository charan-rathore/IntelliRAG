"""Reranker protocol and configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Protocol, runtime_checkable

from libs.rag.retrieval.models import RetrievedChunk


@dataclass
class RerankerConfig:
    """Configuration for reranking models."""

    model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    batch_size: int = 16
    max_length: int = 512
    normalize_scores: bool = True


@runtime_checkable
class Reranker(Protocol):
    """Protocol for reranking implementations."""

    def rerank(
        self,
        query: str,
        candidates: List[RetrievedChunk],
        top_k: int,
    ) -> List[RerankedChunk]:
        """Rerank candidates and return top_k results."""
        ...
