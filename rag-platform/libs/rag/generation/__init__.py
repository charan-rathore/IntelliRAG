"""LLM generation layer with citation-aware Ollama prompts."""

from .config import GenerationConfig
from .models import GenerationResult, GenerationStats, ParsedCitation
from .ollama import LLMClient, MockLLMClient, OllamaClient
from .service import GenerationService

__all__ = [
    "GenerationConfig",
    "GenerationResult",
    "GenerationStats",
    "ParsedCitation",
    "GenerationService",
    "LLMClient",
    "OllamaClient",
    "MockLLMClient",
]
