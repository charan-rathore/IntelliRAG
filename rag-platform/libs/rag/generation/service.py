"""LLM generation service with citation-aware prompts."""

from __future__ import annotations

import logging
import time
from typing import Optional, Union

from libs.rag.context.models import AssembledContext

from .citations import parse_citations
from .config import GenerationConfig
from .models import GenerationResult, GenerationStats
from .ollama import LLMClient, MockLLMClient, OllamaClient
from .prompts import build_messages

logger = logging.getLogger(__name__)

REFUSAL_PHRASE = "I cannot answer based on the provided sources."


class GenerationService:
    """Generate citation-aware answers from assembled context."""

    def __init__(
        self,
        config: Optional[GenerationConfig] = None,
        llm_client: Optional[LLMClient] = None,
    ) -> None:
        self.config = config or GenerationConfig()
        self._llm_client = llm_client

    @property
    def llm_client(self) -> LLMClient:
        if self._llm_client is None:
            self._llm_client = OllamaClient(self.config)
        return self._llm_client

    def generate(
        self,
        context: AssembledContext,
        config_override: Optional[GenerationConfig] = None,
    ) -> GenerationResult:
        """Generate an answer with inline citations from assembled context."""
        start = time.time()
        cfg = config_override or self.config

        if not context.chunks:
            return self._refusal_result(
                context.query,
                cfg,
                reason="no_context_chunks",
                latency_ms=(time.time() - start) * 1000,
            )

        messages = build_messages(context, cfg)
        response = self.llm_client.generate(messages, cfg)
        answer = response.get("content", "").strip()

        refused = REFUSAL_PHRASE.lower() in answer.lower()
        citations = [] if refused else parse_citations(
            answer, context, citation_prefix=cfg.citation_prefix
        )

        stats = GenerationStats(
            prompt_tokens=response.get("prompt_tokens", 0),
            completion_tokens=response.get("completion_tokens", 0),
            total_tokens=response.get("total_tokens", 0),
            context_chunks=len(context.chunks),
            citations_found=len(citations),
            unique_sources_cited=len(set(c.source_index for c in citations)),
        )

        latency_ms = (time.time() - start) * 1000

        return GenerationResult(
            query=context.query,
            answer=answer,
            citations=citations,
            model=response.get("model", cfg.model),
            stats=stats,
            latency_ms=latency_ms,
            prompt_style=cfg.prompt_style,
            refused=refused,
        )

    def generate_from_rag_pipeline(
        self,
        query: str,
        assembled_context: AssembledContext,
    ) -> GenerationResult:
        """Convenience wrapper when context is already assembled."""
        return self.generate(assembled_context)

    def _refusal_result(
        self,
        query: str,
        cfg: GenerationConfig,
        reason: str,
        latency_ms: float,
    ) -> GenerationResult:
        return GenerationResult(
            query=query,
            answer=REFUSAL_PHRASE,
            citations=[],
            model=cfg.model,
            stats=GenerationStats(),
            latency_ms=latency_ms,
            prompt_style=cfg.prompt_style,
            refused=True,
            metadata={"refusal_reason": reason},
        )
