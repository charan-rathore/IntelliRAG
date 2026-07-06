"""Cross-encoder reranker using sentence-transformers (local, free)."""

from __future__ import annotations

import logging
import time
from typing import List, Optional

from libs.rag.retrieval.models import RetrievedChunk

from .base import RerankerConfig
from .models import RerankedChunk

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"


class CrossEncoderReranker:
    """Rerank retrieval candidates with a local cross-encoder model.

    Production alternative: Cohere Rerank API (paid, higher quality at scale).
    Local gap: slower on CPU, lower throughput, but zero cost.
    """

    def __init__(self, config: Optional[RerankerConfig] = None) -> None:
        self.config = config or RerankerConfig()
        self._model = None
        self._model_name = self.config.model_name

    def _load_model(self):
        if self._model is None:
            try:
                from sentence_transformers import CrossEncoder
            except ImportError as exc:
                raise RuntimeError(
                    "sentence-transformers is required for cross-encoder reranking. "
                    "Install with: pip install 'rag-platform[eval]'"
                ) from exc
            logger.info(f"Loading cross-encoder model: {self._model_name}")
            self._model = CrossEncoder(
                self._model_name,
                max_length=self.config.max_length,
            )

    def rerank(
        self,
        query: str,
        candidates: List[RetrievedChunk],
        top_k: int,
    ) -> List[RerankedChunk]:
        """Score query-chunk pairs and return top_k by cross-encoder score."""
        if not candidates:
            return []

        self._load_model()
        pairs = [(query, c.text) for c in candidates]
        scores = self._model.predict(
            pairs,
            batch_size=self.config.batch_size,
            show_progress_bar=False,
        )

        if self.config.normalize_scores and len(scores) > 1:
            min_s = float(min(scores))
            max_s = float(max(scores))
            if max_s > min_s:
                scores = [(float(s) - min_s) / (max_s - min_s) for s in scores]
            else:
                scores = [1.0] * len(scores)

        ranked = sorted(
            zip(candidates, scores),
            key=lambda x: x[1],
            reverse=True,
        )[:top_k]

        return [
            RerankedChunk(
                chunk_id=c.chunk_id,
                text=c.text,
                score=float(score),
                rank=i + 1,
                retriever=c.retriever,
                metadata=c.metadata,
                original_rank=c.rank,
                original_score=c.score,
                rerank_score=float(score),
            )
            for i, (c, score) in enumerate(ranked)
        ]

    def close(self) -> None:
        self._model = None


class LexicalReranker:
    """Lightweight reranker using token overlap (for tests and fast baselines).

    Simulates reranking lift without loading a neural model.
    """

    def rerank(
        self,
        query: str,
        candidates: List[RetrievedChunk],
        top_k: int,
    ) -> List[RerankedChunk]:
        from libs.rag.retrieval.keyword import tokenize

        query_tokens = set(tokenize(query))
        if not query_tokens:
            return self._passthrough(candidates, top_k)

        scored = []
        for c in candidates:
            chunk_tokens = set(tokenize(c.text))
            overlap = len(query_tokens & chunk_tokens)
            union = len(query_tokens | chunk_tokens) or 1
            jaccard = overlap / union
            scored.append((c, jaccard))

        scored.sort(key=lambda x: x[1], reverse=True)

        return [
            RerankedChunk(
                chunk_id=c.chunk_id,
                text=c.text,
                score=score,
                rank=i + 1,
                retriever=c.retriever,
                metadata=c.metadata,
                original_rank=c.rank,
                original_score=c.score,
                rerank_score=score,
            )
            for i, (c, score) in enumerate(scored[:top_k])
        ]

    def _passthrough(
        self,
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
