"""Context assembly result models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ContextChunk:
    """A chunk selected for inclusion in the assembled context."""

    chunk_id: str
    text: str
    score: float
    rank: int
    token_count: int
    citation_label: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    was_deduplicated: bool = False
    was_compressed: bool = False
    original_token_count: int = 0


@dataclass
class AssemblyStats:
    """Statistics from the assembly process."""

    chunks_in: int = 0
    chunks_after_dedup: int = 0
    chunks_selected: int = 0
    chunks_dropped_budget: int = 0
    duplicates_removed: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    budget_limit: int = 0
    budget_used: int = 0
    budget_utilization: float = 0.0
    compression_applied: bool = False
    dedup_applied: bool = False
    mmr_applied: bool = False


@dataclass
class AssembledContext:
    """Final assembled context ready for LLM prompt injection."""

    query: str
    chunks: List[ContextChunk]
    context_text: str
    citations: Dict[str, str]
    stats: AssemblyStats
    strategy: str
    latency_ms: float = 0.0

    @property
    def total_tokens(self) -> int:
        return sum(c.token_count for c in self.chunks)

    @property
    def citation_list(self) -> List[str]:
        return [c.citation_label for c in self.chunks]
