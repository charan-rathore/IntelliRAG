"""Ollama chat client for answer generation."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Protocol

from libs.rag.chunking.utils import estimate_token_count

from .config import GenerationConfig

logger = logging.getLogger(__name__)


class LLMClient(Protocol):
    """Protocol for swappable LLM backends."""

    def generate(
        self,
        messages: List[Dict[str, str]],
        config: GenerationConfig,
    ) -> Dict[str, Any]:
        """Generate a completion from chat messages."""
        ...


class OllamaClient:
    """HTTP client for Ollama /api/chat endpoint."""

    def __init__(self, config: Optional[GenerationConfig] = None) -> None:
        self.config = config or GenerationConfig()
        self._client = None

    def _get_client(self):
        if self._client is None:
            import httpx

            self._client = httpx.Client(
                base_url=self.config.base_url,
                timeout=self.config.timeout_seconds,
            )
        return self._client

    def is_available(self) -> bool:
        """Check if Ollama server is reachable."""
        try:
            client = self._get_client()
            response = client.get("/api/tags")
            return response.status_code == 200
        except Exception:
            return False

    def generate(
        self,
        messages: List[Dict[str, str]],
        config: Optional[GenerationConfig] = None,
    ) -> Dict[str, Any]:
        """Call Ollama chat API and return response with token stats."""
        cfg = config or self.config
        client = self._get_client()

        payload = {
            "model": cfg.model,
            "messages": messages,
            "stream": cfg.stream,
            "options": {
                "temperature": cfg.temperature,
                "num_ctx": cfg.num_ctx,
                "num_predict": cfg.max_tokens,
            },
        }

        response = client.post("/api/chat", json=payload)
        if response.status_code != 200:
            raise RuntimeError(
                f"Ollama generation failed: {response.status_code} {response.text}"
            )

        data = response.json()
        content = data.get("message", {}).get("content", "")

        prompt_text = " ".join(m["content"] for m in messages)
        prompt_tokens = estimate_token_count(prompt_text)
        completion_tokens = estimate_token_count(content)

        return {
            "content": content,
            "model": data.get("model", cfg.model),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "done": data.get("done", True),
        }


class MockLLMClient:
    """Deterministic LLM for tests and offline benchmarks."""

    def __init__(self, responses: Optional[Dict[str, str]] = None) -> None:
        self.responses = responses or {}
        self.last_messages: List[Dict[str, str]] = []

    def generate(
        self,
        messages: List[Dict[str, str]],
        config: GenerationConfig,
    ) -> Dict[str, Any]:
        self.last_messages = messages
        user_msg = next((m["content"] for m in messages if m["role"] == "user"), "")

        for key, response in self.responses.items():
            if key in user_msg:
                content = response
                break
        else:
            content = (
                "Resource fragmentation on cluster nodes causes pod scheduling failures [Source 1]. "
                "Individual nodes had fragmented CPU and memory allocations [Source 2]."
            )

        prompt_text = " ".join(m["content"] for m in messages)
        prompt_tokens = estimate_token_count(prompt_text)
        completion_tokens = estimate_token_count(content)

        return {
            "content": content,
            "model": "mock-llm",
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "done": True,
        }
