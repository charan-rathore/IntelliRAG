"""LLM generation configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PromptStyle = Literal["citation_aware", "concise", "detailed"]


@dataclass
class GenerationConfig:
    """Configuration for Ollama-based answer generation."""

    model: str = "llama3.2"
    base_url: str = "http://localhost:11434"
    temperature: float = 0.0
    num_ctx: int = 4096
    max_tokens: int = 1024
    prompt_style: PromptStyle = "citation_aware"
    require_citations: bool = True
    refuse_without_sources: bool = True
    citation_prefix: str = "Source"
    timeout_seconds: float = 120.0
    stream: bool = False

    @classmethod
    def for_ollama(
        cls,
        model: str = "llama3.2",
        base_url: str = "http://localhost:11434",
    ) -> "GenerationConfig":
        """Create config for local Ollama inference."""
        return cls(model=model, base_url=base_url)
