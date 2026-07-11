"""Hybrid retrieval combining dense and keyword search."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from .dense import DenseRetriever
from .keyword import KeywordRetriever
from .models import RetrievedChunk, RetrievalResult

logger = logging.getLogger(__name__)


class HybridRetriever:
    """Fuse dense and keyword results using Reciprocal Rank Fusion (RRF)."""

    def __init__(
        self,
        dense_retriever: DenseRetriever,
        keyword_retriever: KeywordRetriever,
        rrf_k: int = 60,
        dense_weight: float = 1.0,
        keyword_weight: float = 1.0,
    ) -> None:
        self.dense_retriever = dense_retriever
        self.keyword_retriever = keyword_retriever
        self.rrf_k = rrf_k
        self.dense_weight = dense_weight
        self.keyword_weight = keyword_weight

    def retrieve(
        self,
        query: str,
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> RetrievalResult:
        """Retrieve and fuse results from dense and keyword retrievers."""
        start = time.time()

        dense_result = self.dense_retriever.retrieve(
            query=query,
            top_k=top_k * 2,
            filter_metadata=filter_metadata,
        )
        keyword_result = self.keyword_retriever.retrieve(
            query=query,
            top_k=top_k * 2,
            filter_metadata=filter_metadata,
        )

        fused = self._reciprocal_rank_fusion(
            dense_result.chunks,
            keyword_result.chunks,
            top_k=top_k,
        )
        latency_ms = (time.time() - start) * 1000

        return RetrievalResult(
            query=query,
            chunks=fused,
            retriever="hybrid",
            latency_ms=latency_ms,
            total_candidates=len(fused),
        )

    def _reciprocal_rank_fusion(
        self,
        dense_chunks: List[RetrievedChunk],
        keyword_chunks: List[RetrievedChunk],
        top_k: int,
    ) -> List[RetrievedChunk]:
        scores: Dict[str, float] = {}
        texts: Dict[str, str] = {}
        metadata: Dict[str, Dict[str, Any]] = {}

        for rank, chunk in enumerate(dense_chunks, start=1):
            scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0.0) + (
                self.dense_weight / (self.rrf_k + rank)
            )
            texts[chunk.chunk_id] = chunk.text
            metadata[chunk.chunk_id] = chunk.metadata

        for rank, chunk in enumerate(keyword_chunks, start=1):
            scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0.0) + (
                self.keyword_weight / (self.rrf_k + rank)
            )
            texts.setdefault(chunk.chunk_id, chunk.text)
            metadata.setdefault(chunk.chunk_id, chunk.metadata)

        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

        return [
            RetrievedChunk(
                chunk_id=chunk_id,
                text=texts.get(chunk_id, ""),
                score=score,
                rank=i + 1,
                retriever="hybrid",
                metadata=metadata.get(chunk_id, {}),
            )
            for i, (chunk_id, score) in enumerate(ranked)
        ]
