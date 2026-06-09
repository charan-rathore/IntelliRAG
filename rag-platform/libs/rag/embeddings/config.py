"""Configuration for embedding models.

This module defines configuration for embedding models used in the RAG pipeline.
The primary recommendation is nomic-embed-text-v1.5 for its balance of:
- 8,192 token context (handles 512-token chunks with overlap)
- 274 MB model size (fits disk constraints)
- Matryoshka dimensionality (768 -> 256/128 flexible)
- Native Ollama support
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class EmbeddingProvider(Enum):
    """Supported embedding providers."""
    OLLAMA = "ollama"
    SENTENCE_TRANSFORMERS = "sentence_transformers"


class EmbeddingModel(Enum):
    """Pre-configured embedding models with known characteristics."""
    
    # Recommended: Best balance of quality, size, and context window
    NOMIC_EMBED_TEXT = "nomic-embed-text"
    
    # Alternatives
    MXBAI_EMBED_LARGE = "mxbai-embed-large"  # Higher MTEB but 512 token limit
    BGE_M3 = "bge-m3"  # Multilingual, 1.2GB
    ALL_MINILM_L6_V2 = "all-MiniLM-L6-v2"  # Legacy, 256 token limit
    
    @property
    def dimensions(self) -> int:
        """Default embedding dimensions for each model."""
        dims = {
            "nomic-embed-text": 768,
            "mxbai-embed-large": 1024,
            "bge-m3": 1024,
            "all-MiniLM-L6-v2": 384,
        }
        return dims.get(self.value, 768)
    
    @property
    def max_tokens(self) -> int:
        """Maximum context window for each model."""
        tokens = {
            "nomic-embed-text": 8192,
            "mxbai-embed-large": 512,
            "bge-m3": 8192,
            "all-MiniLM-L6-v2": 256,
        }
        return tokens.get(self.value, 512)
    
    @property
    def provider(self) -> EmbeddingProvider:
        """Default provider for each model."""
        if self.value in ["nomic-embed-text", "mxbai-embed-large", "bge-m3"]:
            return EmbeddingProvider.OLLAMA
        return EmbeddingProvider.SENTENCE_TRANSFORMERS


@dataclass
class EmbeddingConfig:
    """Configuration for embedding generation.
    
    Recommended configuration for nomic-embed-text-v1.5:
        config = EmbeddingConfig(
            model_name="nomic-embed-text",
            dimensions=768,
            max_tokens=8192,
            query_prefix="search_query: ",
        )
    
    Attributes:
        model_name: Ollama model name or sentence-transformers model.
        provider: Embedding provider (ollama or sentence_transformers).
        dimensions: Output embedding dimensions (768 for full Matryoshka).
        max_tokens: Model's context window (8192 for nomic).
        batch_size: Number of texts to embed in parallel.
        normalize: Whether to L2 normalize embeddings for cosine similarity.
        query_prefix: Optional prefix for query embeddings (improves retrieval 1-2%).
        document_prefix: Optional prefix for document embeddings.
        base_url: Ollama server URL (for Ollama provider).
        show_progress: Show progress bar during batch embedding.
    """
    model_name: str = "nomic-embed-text"
    provider: EmbeddingProvider = EmbeddingProvider.OLLAMA
    dimensions: int = 768
    max_tokens: int = 8192
    batch_size: int = 32
    normalize: bool = True
    query_prefix: Optional[str] = "search_query: "
    document_prefix: Optional[str] = None
    base_url: str = "http://localhost:11434"
    show_progress: bool = True
    
    @classmethod
    def for_nomic(
        cls,
        dimensions: int = 768,
        base_url: str = "http://localhost:11434",
        use_query_prefix: bool = True,
    ) -> "EmbeddingConfig":
        """Create optimized configuration for nomic-embed-text.
        
        Args:
            dimensions: Embedding dimensions (768, 256, or 128 for Matryoshka).
            base_url: Ollama server URL.
            use_query_prefix: Whether to use "search_query: " prefix for queries.
        
        Returns:
            Configured EmbeddingConfig for nomic-embed-text.
        """
        return cls(
            model_name="nomic-embed-text",
            provider=EmbeddingProvider.OLLAMA,
            dimensions=dimensions,
            max_tokens=8192,
            query_prefix="search_query: " if use_query_prefix else None,
            document_prefix=None,
            base_url=base_url,
        )
    
    @classmethod
    def for_minilm(cls) -> "EmbeddingConfig":
        """Create configuration for all-MiniLM-L6-v2 (legacy/fallback).
        
        Note: This model has a 256-token limit which may truncate
        512-token chunks. Use for quick testing only.
        """
        return cls(
            model_name="all-MiniLM-L6-v2",
            provider=EmbeddingProvider.SENTENCE_TRANSFORMERS,
            dimensions=384,
            max_tokens=256,
            query_prefix=None,
            document_prefix=None,
        )
    
    @classmethod
    def for_mxbai(
        cls,
        base_url: str = "http://localhost:11434",
    ) -> "EmbeddingConfig":
        """Create configuration for mxbai-embed-large.
        
        Note: This model has a 512-token limit. Your 512-token chunks
        with overlap will be truncated. Use nomic-embed-text instead.
        """
        return cls(
            model_name="mxbai-embed-large",
            provider=EmbeddingProvider.OLLAMA,
            dimensions=1024,
            max_tokens=512,
            query_prefix="Represent this sentence for searching relevant passages: ",
            document_prefix=None,
            base_url=base_url,
        )
    
    def validate_chunk_size(self, chunk_tokens: int) -> bool:
        """Check if chunk size is compatible with model context window.
        
        Args:
            chunk_tokens: Number of tokens in chunks.
        
        Returns:
            True if chunk size is within model limits.
        """
        return chunk_tokens <= self.max_tokens
    
    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "model_name": self.model_name,
            "provider": self.provider.value,
            "dimensions": self.dimensions,
            "max_tokens": self.max_tokens,
            "batch_size": self.batch_size,
            "normalize": self.normalize,
            "query_prefix": self.query_prefix,
            "document_prefix": self.document_prefix,
            "base_url": self.base_url,
        }


# Default production configuration
DEFAULT_EMBEDDING_CONFIG = EmbeddingConfig.for_nomic()
