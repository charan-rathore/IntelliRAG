"""Ollama chat client for answer generation."""

from __future__ import annotations

import logging
import re
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

    def warmup(self) -> None:
        """Prime the model weights so the first real query is not a cold start."""
        try:
            client = self._get_client()
            client.post(
                "/api/chat",
                json={
                    "model": self.config.model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "stream": False,
                    "keep_alive": "30m",
                    "options": {"num_predict": 1, "temperature": 0},
                },
            )
        except Exception as exc:
            logger.warning("Ollama warmup skipped: %s", exc)

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
            "stream": False,
            "keep_alive": "30m",
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

    def stream(
        self,
        messages: List[Dict[str, str]],
        config: Optional[GenerationConfig] = None,
    ):
        """Yield content tokens from Ollama streaming chat."""
        import json

        cfg = config or self.config
        client = self._get_client()
        payload = {
            "model": cfg.model,
            "messages": messages,
            "stream": True,
            "keep_alive": "30m",
            "options": {
                "temperature": cfg.temperature,
                "num_ctx": cfg.num_ctx,
                "num_predict": cfg.max_tokens,
            },
        }

        with client.stream("POST", "/api/chat", json=payload) as response:
            if response.status_code != 200:
                raise RuntimeError(
                    f"Ollama stream failed: {response.status_code} {response.read().decode()}"
                )
            for line in response.iter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                piece = (data.get("message") or {}).get("content") or ""
                if piece:
                    yield piece
                if data.get("done"):
                    break


class MockLLMClient:
    """Deterministic LLM for tests and offline benchmarks."""

    DEFAULT_RESPONSES = {
        "kubernetes pod scheduling": (
            "The issue was traced to resource fragmentation on the cluster nodes [Source 1]. "
            "Individual nodes had fragmented CPU and memory allocations that prevented scheduling [Source 1]."
        ),
        "scheduling failures resolved": (
            "We implemented resource quotas, pod priority classes, and node affinity rules [Source 1]."
        ),
        "asyncio event loop": (
            "Always use asyncio.run() for top-level entry points in Python 3.7+ [Source 1]. "
            "Avoid creating multiple event loops in the same thread [Source 1]."
        ),
        "aiohttp connection": (
            "Use aiohttp ClientSession as a context manager to reuse TCP connections [Source 1]. "
            "Set appropriate timeouts to prevent hung coroutines [Source 1]."
        ),
        "concurrent asyncio": (
            "Wrap coroutines in try/except and use asyncio.gather with return_exceptions=True "
            "for concurrent tasks that should not fail together [Source 1]."
        ),
    }

    def __init__(self, responses: Optional[Dict[str, str]] = None) -> None:
        merged = dict(self.DEFAULT_RESPONSES)
        if responses:
            merged.update(responses)
        self.responses = merged
        self.last_messages: List[Dict[str, str]] = []

    def _extract_sources(self, user_msg: str) -> List[tuple[int, str]]:
        sources: List[tuple[int, str]] = []
        current_idx = None
        current_lines: List[str] = []
        for line in user_msg.splitlines():
            if line.startswith("[Source ") and line.rstrip().endswith("]"):
                if current_idx is not None and current_lines:
                    sources.append((current_idx, "\n".join(current_lines).strip()))
                try:
                    current_idx = int(line.split("[Source ")[1].split("]")[0])
                except (IndexError, ValueError):
                    current_idx = len(sources) + 1
                current_lines = []
            elif current_idx is not None and not line.startswith("Question:"):
                current_lines.append(line)
        if current_idx is not None and current_lines:
            sources.append((current_idx, "\n".join(current_lines).strip()))
        return sources

    def _score_overlap(self, query: str, text: str) -> float:
        from libs.rag.retrieval.keyword import tokenize

        q_tokens = set(tokenize(query.lower()))
        t_tokens = set(tokenize(text.lower()))
        if not q_tokens or not t_tokens:
            return 0.0
        return len(q_tokens & t_tokens) / len(q_tokens)

    # Minimum query↔source token overlap before the mock will invent an answer.
    # Below this, refuse — mirrors the real citation-aware prompt contract.
    MIN_ANSWER_OVERLAP = 0.28

    @staticmethod
    def _clean_sentence(text: str) -> str:
        """Strip markdown headings / noise so mock answers read like prose."""
        cleaned = re.sub(r"^#+\s*", "", text.strip())
        cleaned = re.sub(r"\s*#+\s*", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def _build_context_answer(self, user_msg: str) -> str:
        from libs.rag.generation.service import REFUSAL_PHRASE

        question = ""
        for line in user_msg.splitlines():
            if line.startswith("Question:"):
                question = line.replace("Question:", "").strip()
                break

        sources = self._extract_sources(user_msg)
        if not sources or not question:
            return REFUSAL_PHRASE

        ranked = sorted(
            sources,
            key=lambda item: self._score_overlap(question, item[1]),
            reverse=True,
        )
        top_idx, top_text = ranked[0]
        if self._score_overlap(question, top_text) < self.MIN_ANSWER_OVERLAP:
            return REFUSAL_PHRASE

        sentences = [
            self._clean_sentence(s)
            for s in re.split(r"(?<=[.!?])\s+", top_text.replace("\n", " "))
            if len(self._clean_sentence(s)) >= 20
        ]
        if not sentences:
            return REFUSAL_PHRASE

        best_sentence = max(sentences, key=lambda s: self._score_overlap(question, s))
        if self._score_overlap(question, best_sentence) < self.MIN_ANSWER_OVERLAP:
            return REFUSAL_PHRASE
        return f"{best_sentence.rstrip('.')}. [Source {top_idx}]"

    def generate(
        self,
        messages: List[Dict[str, str]],
        config: GenerationConfig,
    ) -> Dict[str, Any]:
        self.last_messages = messages
        user_msg = next((m["content"] for m in messages if m["role"] == "user"), "")
        question_line = user_msg
        for line in user_msg.splitlines():
            if line.startswith("Question:"):
                question_line = line
                break

        for key, response in self.responses.items():
            if key.lower() in question_line.lower():
                content = response
                break
        else:
            content = self._build_context_answer(user_msg)

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

    def stream(
        self,
        messages: List[Dict[str, str]],
        config: Optional[GenerationConfig] = None,
    ):
        """Yield mock answer in small chunks for streaming UI tests."""
        result = self.generate(messages, config or GenerationConfig())
        content = result["content"]
        # Chunk by words so the UI can exercise token events.
        words = re.findall(r"\S+\s*", content)
        for word in words:
            yield word
