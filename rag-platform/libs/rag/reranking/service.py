"""Reranking service and retrieve-then-rerank pipeline."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Literal, Optional

from libs.rag.retrieval.models import RetrievalResult
from libs.rag.retrieval.service import RetrievalService, RetrieverMode

from .base import Reranker
from .models import RerankResult

logger = logging.getLogger(__name__)


class RerankingService:
    """Apply reranking on top of retrieval candidates."""

    def __init__(
        self,
        retrieval_service: RetrievalService,
        reranker: Reranker,
        retrieve_top_n: int = 50,
    ) -> None:
        self.retrieval_service = retrieval_service
        self.reranker = reranker
        self.retrieve_top_n = retrieve_top_n

    def retrieve_and_rerank(
        self,
        query: str,
        retrieval_mode: RetrieverMode = "hybrid",
        top_k: int = 5,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> RerankResult:
        """Two-stage retrieval: broad recall then precise reranking."""
        total_start = time.time()

        retrieval_result = self.retrieval_service.retrieve(
            query=query,
            mode=retrieval_mode,
            top_k=self.retrieve_top_n,
            filter_metadata=filter_metadata,
        )

        rerank_start = time.time()
        reranked = self.reranker.rerank(
            query=query,
            candidates=retrieval_result.chunks,
            top_k=top_k,
        )
        rerank_latency_ms = (time.time() - rerank_start) * 1000
        total_latency_ms = (time.time() - total_start) * 1000

        reranker_name = getattr(self.reranker, "_model_name", type(self.reranker).__name__)

        return RerankResult(
            query=query,
            chunks=reranked,
            reranker=reranker_name,
            candidates_in=len(retrieval_result.chunks),
            candidates_out=len(reranked),
            retrieval_latency_ms=retrieval_result.latency_ms,
            rerank_latency_ms=rerank_latency_ms,
            total_latency_ms=total_latency_ms,
        )

    def rerank_only(
        self,
        query: str,
        retrieval_result: RetrievalResult,
        top_k: int = 5,
    ) -> RerankResult:
        """Rerank an existing retrieval result (for ablation benchmarks)."""
        rerank_start = time.time()
        reranked = self.reranker.rerank(
            query=query,
            candidates=retrieval_result.chunks,
            top_k=top_k,
        )
        rerank_latency_ms = (time.time() - rerank_start) * 1000

        reranker_name = getattr(self.reranker, "_model_name", type(self.reranker).__name__)

        return RerankResult(
            query=query,
            chunks=reranked,
            reranker=reranker_name,
            candidates_in=len(retrieval_result.chunks),
            candidates_out=len(reranked),
            retrieval_latency_ms=retrieval_result.latency_ms,
            rerank_latency_ms=rerank_latency_ms,
            total_latency_ms=retrieval_result.latency_ms + rerank_latency_ms,
        )
