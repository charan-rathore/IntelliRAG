"""OpenRouter chat client for answer generation.

Shares its configuration with the web platform: the same OPENROUTER_API_KEY
environment variable and the same default generation model
(google/gemini-3.7-flash, the web app's GENERATION_MODEL_OPENROUTER).
Ollama remains the default provider; OpenRouter is used only when selected.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from .config import GenerationConfig

OPENROUTER_ROOT = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = "google/gemini-3.7-flash"
API_KEY_ENV = "OPENROUTER_API_KEY"


class OpenRouterClient:
    """HTTP client for the OpenRouter (OpenAI-compatible) chat endpoint."""

    def __init__(self, config: Optional[GenerationConfig] = None) -> None:
        self.config = config or GenerationConfig.for_openrouter()
        self._client = None

    def _get_client(self):
        if self._client is None:
            import httpx

            self._client = httpx.Client(
                base_url=self.config.base_url,
                timeout=self.config.timeout_seconds,
            )
        return self._client

    @staticmethod
    def api_key() -> Optional[str]:
        key = os.environ.get(API_KEY_ENV, "").strip()
        return key or None

    def is_available(self) -> bool:
        """OpenRouter is usable whenever an API key is configured."""
        return self.api_key() is not None

    def generate(
        self,
        messages: List[Dict[str, str]],
        config: Optional[GenerationConfig] = None,
    ) -> Dict[str, Any]:
        """Call OpenRouter chat completions and return response with token stats."""
        cfg = config or self.config
        key = self.api_key()
        if not key:
            raise RuntimeError(
                f"{API_KEY_ENV} is not set; OpenRouter generation is unavailable. "
                "Unset the provider or configure the key to use it."
            )
        client = self._get_client()
        payload = {
            "model": cfg.model,
            "messages": messages,
            "stream": False,
            "temperature": cfg.temperature,
            "max_tokens": cfg.max_tokens,
        }
        response = client.post(
            "/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {key}"},
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"OpenRouter generation failed: {response.status_code} {response.text}"
            )

        data = response.json()
        choices = data.get("choices") or []
        content = ""
        if choices:
            content = choices[0].get("message", {}).get("content", "")
        usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))

        return {
            "content": content,
            "model": data.get("model", cfg.model),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": int(usage.get("total_tokens", prompt_tokens + completion_tokens)),
            "done": True,
        }
