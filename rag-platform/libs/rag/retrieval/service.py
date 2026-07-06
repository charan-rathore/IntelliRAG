"""Retrieval service facade."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional, Tuple

from libs.rag.indexing.service import IndexingService

from .dense import DenseRetriever
from .hybrid import HybridRetriever
from .keyword import KeywordRetriever
from .models import RetrievalResult

logger = logging.getLogger(__name__)

RetrieverMode = Literal["dense", "keyword", "hybrid"]


class RetrievalService:
    """Unified retrieval interface for the RAG platform."""

    def __init__(
        self,
        indexing_service: IndexingService,
        chunk_corpus: Optional[List[Tuple[str, str]]] = None,
    ) -> None:
        self.indexing_service = indexing_service
        self.dense = DenseRetriever(indexing_service)
        self.keyword = KeywordRetriever(chunk_corpus or [])
        self.hybrid = HybridRetriever(self.dense, self.keyword)

    def refresh_keyword_index(self, chunks: List[Tuple[str, str]]) -> None:
        """Rebuild the keyword index with updated chunks."""
        self.keyword.refresh(chunks)

    def retrieve(
        self,
        query: str,
        mode: RetrieverMode = "hybrid",
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> RetrievalResult:
        """Retrieve chunks using the specified mode."""
        if mode == "dense":
            return self.dense.retrieve(query, top_k=top_k, filter_metadata=filter_metadata)
        if mode == "keyword":
            return self.keyword.retrieve(query, top_k=top_k)
        return self.hybrid.retrieve(query, top_k=top_k, filter_metadata=filter_metadata)
