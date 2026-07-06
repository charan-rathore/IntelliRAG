"""Generation result models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ParsedCitation:
    """A citation extracted from generated text."""

    label: str
    source_index: int
    chunk_id: str
    source_text: str
    position: int = 0


@dataclass
class GenerationStats:
    """Statistics from the generation process."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    context_chunks: int = 0
    citations_found: int = 0
    unique_sources_cited: int = 0


@dataclass
class GenerationResult:
    """Complete result from LLM answer generation."""

    query: str
    answer: str
    citations: List[ParsedCitation]
    model: str
    stats: GenerationStats
    latency_ms: float = 0.0
    prompt_style: str = "citation_aware"
    refused: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def cited_chunk_ids(self) -> List[str]:
        return list(dict.fromkeys(c.chunk_id for c in self.citations))

    @property
    def has_citations(self) -> bool:
        return len(self.citations) > 0

    @property
    def citation_labels(self) -> List[str]:
        return [c.label for c in self.citations]
