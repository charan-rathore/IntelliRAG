"""Pass-through reranker for baseline configs without reranking."""

from __future__ import annotations

from typing import List

from libs.rag.retrieval.models import RetrievedChunk

from .models import RerankedChunk


class PassThroughReranker:
    """Return retrieval ordering unchanged (naive RAG baseline)."""

    _model_name = "pass_through"

    def rerank(
        self,
        query: str,
        candidates: List[RetrievedChunk],
        top_k: int,
    ) -> List[RerankedChunk]:
        return [
            RerankedChunk(
                chunk_id=c.chunk_id,
                text=c.text,
                score=c.score,
                rank=i + 1,
                retriever=c.retriever,
                metadata=c.metadata,
                original_rank=c.rank,
                original_score=c.score,
                rerank_score=c.score,
            )
            for i, c in enumerate(candidates[:top_k])
        ]
