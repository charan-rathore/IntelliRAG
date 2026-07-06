"""Context assembly configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AssemblyStrategy = Literal[
    "top_k",
    "dedup_only",
    "mmr",
    "budget",
    "full",
    "full_compressed",
]


@dataclass
class ContextAssemblyConfig:
    """Configuration for context assembly pipeline."""

    strategy: AssemblyStrategy = "full"
    max_tokens: int = 2048
    max_chunks: int = 10
    dedup_threshold: float = 0.85
    mmr_lambda: float = 0.7
    enable_dedup: bool = True
    enable_mmr: bool = True
    enable_compression: bool = False
    per_chunk_max_tokens: int = 512
    min_chunk_tokens: int = 20
    citation_prefix: str = "Source"
    context_separator: str = "\n\n---\n\n"
