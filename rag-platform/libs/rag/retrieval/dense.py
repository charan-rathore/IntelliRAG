"""Dense vector retrieval using the indexing layer."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from libs.rag.indexing.service import IndexingService

from .models import RetrievedChunk, RetrievalResult

logger = logging.getLogger(__name__)


class DenseRetriever:
    """Semantic retrieval via vector similarity search."""

    def __init__(self, indexing_service: IndexingService) -> None:
        self.indexing_service = indexing_service

    def retrieve(
        self,
        query: str,
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> RetrievalResult:
        """Retrieve top-k chunks by embedding similarity."""
        start = time.time()
        results = self.indexing_service.search(
            query=query,
            top_k=top_k,
            filter_metadata=filter_metadata,
        )
        latency_ms = (time.time() - start) * 1000

        chunks = [
            RetrievedChunk(
                chunk_id=r.chunk_id,
                text=r.text or "",
                score=r.score,
                rank=i + 1,
                retriever="dense",
                metadata=r.metadata,
            )
            for i, r in enumerate(results)
        ]

        return RetrievalResult(
            query=query,
            chunks=chunks,
            retriever="dense",
            latency_ms=latency_ms,
            total_candidates=len(chunks),
        )
