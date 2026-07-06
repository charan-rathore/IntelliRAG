"""Context assembly service orchestrating the full pipeline."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Union

from libs.rag.chunking.utils import estimate_token_count
from libs.rag.reranking.models import RerankedChunk, RerankResult
from libs.rag.retrieval.models import RetrievedChunk

from .budget import pack_by_budget
from .compression import compress_extractive
from .config import ContextAssemblyConfig
from .deduplication import deduplicate_by_similarity, deduplicate_exact
from .models import AssembledContext, AssemblyStats, ContextChunk
from .selection import maximal_marginal_relevance, select_top_k

logger = logging.getLogger(__name__)

ChunkInput = Union[RetrievedChunk, RerankedChunk]


class ContextAssemblyService:
    """Assemble reranked/retrieved chunks into an LLM-ready context."""

    def __init__(self, config: Optional[ContextAssemblyConfig] = None) -> None:
        self.config = config or ContextAssemblyConfig()

    def assemble(
        self,
        query: str,
        chunks: List[ChunkInput],
        config_override: Optional[ContextAssemblyConfig] = None,
    ) -> AssembledContext:
        """Run the full context assembly pipeline."""
        start = time.time()
        cfg = config_override or self.config

        raw = self._normalize_chunks(chunks)
        stats = AssemblyStats(
            chunks_in=len(raw),
            tokens_in=sum(estimate_token_count(t) for _, t, _, _ in raw),
            budget_limit=cfg.max_tokens,
        )

        working = raw
        strategy = cfg.strategy

        if strategy == "top_k":
            working = select_top_k(working, cfg.max_chunks)

        elif strategy == "dedup_only":
            working, removed = deduplicate_by_similarity(
                working, threshold=cfg.dedup_threshold
            )
            stats.duplicates_removed = removed
            stats.dedup_applied = True
            working = select_top_k(working, cfg.max_chunks)

        elif strategy == "mmr":
            working, removed = deduplicate_by_similarity(
                working, threshold=cfg.dedup_threshold
            )
            stats.duplicates_removed = removed
            stats.dedup_applied = True
            working = maximal_marginal_relevance(
                working, query, cfg.max_chunks, lambda_param=cfg.mmr_lambda
            )
            stats.mmr_applied = True

        elif strategy == "budget":
            working = select_top_k(working, cfg.max_chunks * 2)
            working, dropped = pack_by_budget(
                working,
                max_tokens=cfg.max_tokens,
                min_chunk_tokens=cfg.min_chunk_tokens,
            )
            stats.chunks_dropped_budget = dropped

        elif strategy in ("full", "full_compressed"):
            working, removed = deduplicate_by_similarity(
                working, threshold=cfg.dedup_threshold
            )
            stats.duplicates_removed = removed
            stats.dedup_applied = True
            working = maximal_marginal_relevance(
                working, query, cfg.max_chunks * 2, lambda_param=cfg.mmr_lambda
            )
            stats.mmr_applied = True
            working, dropped = pack_by_budget(
                working,
                max_tokens=cfg.max_tokens,
                min_chunk_tokens=cfg.min_chunk_tokens,
            )
            stats.chunks_dropped_budget = dropped

        stats.chunks_after_dedup = len(working)

        context_chunks: List[ContextChunk] = []
        citations: Dict[str, str] = {}

        for i, (chunk_id, text, score, metadata) in enumerate(working):
            original_tokens = estimate_token_count(text)
            was_compressed = False

            if (
                strategy == "full_compressed"
                or cfg.enable_compression
            ):
                text, was_compressed = compress_extractive(
                    text,
                    query=query,
                    max_tokens=cfg.per_chunk_max_tokens,
                )

            token_count = estimate_token_count(text)
            citation_label = f"[{cfg.citation_prefix} {i + 1}]"
            citations[citation_label] = chunk_id

            context_chunks.append(
                ContextChunk(
                    chunk_id=chunk_id,
                    text=text,
                    score=score,
                    rank=i + 1,
                    token_count=token_count,
                    citation_label=citation_label,
                    metadata=metadata,
                    was_compressed=was_compressed,
                    original_token_count=original_tokens,
                )
            )

        stats.chunks_selected = len(context_chunks)
        stats.tokens_out = sum(c.token_count for c in context_chunks)
        stats.budget_used = stats.tokens_out
        stats.budget_utilization = (
            stats.tokens_out / cfg.max_tokens if cfg.max_tokens > 0 else 0.0
        )
        stats.compression_applied = any(c.was_compressed for c in context_chunks)

        context_text = self._format_context(context_chunks, cfg)

        latency_ms = (time.time() - start) * 1000

        return AssembledContext(
            query=query,
            chunks=context_chunks,
            context_text=context_text,
            citations=citations,
            stats=stats,
            strategy=strategy,
            latency_ms=latency_ms,
        )

    def assemble_from_rerank(
        self,
        rerank_result: RerankResult,
        config_override: Optional[ContextAssemblyConfig] = None,
    ) -> AssembledContext:
        """Convenience method to assemble from a RerankResult."""
        return self.assemble(
            query=rerank_result.query,
            chunks=rerank_result.chunks,
            config_override=config_override,
        )

    def _normalize_chunks(
        self,
        chunks: List[ChunkInput],
    ) -> List[tuple[str, str, float, dict]]:
        result = []
        for c in chunks:
            score = getattr(c, "rerank_score", None) or c.score
            result.append((c.chunk_id, c.text, score, c.metadata or {}))
        return result

    def _format_context(
        self,
        chunks: List[ContextChunk],
        cfg: ContextAssemblyConfig,
    ) -> str:
        parts = []
        for chunk in chunks:
            parts.append(f"{chunk.citation_label}\n{chunk.text}")
        return cfg.context_separator.join(parts)
