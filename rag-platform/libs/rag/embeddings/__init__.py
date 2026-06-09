"""Embedding generation for RAG pipeline.

This module provides production-ready embedding generation using
nomic-embed-text-v1.5 via Ollama (recommended) or sentence-transformers.

Quick Start:
    # Pull the model first
    # $ ollama pull nomic-embed-text
    
    from libs.rag.embeddings import Embedder, EmbeddingConfig
    
    # Default configuration (nomic-embed-text)
    embedder = Embedder()
    
    # Embed documents for storage
    doc_embeddings = embedder.embed_documents(["chunk1", "chunk2"])
    
    # Embed query for retrieval
    query_embedding = embedder.embed_query("What is Kubernetes?")

Model Comparison:
    | Model              | Size   | Dims | Context | MTEB  |
    |--------------------|--------|------|---------|-------|
    | nomic-embed-text   | 274 MB | 768  | 8,192   | 62.39 |
    | mxbai-embed-large  | 670 MB | 1024 | 512     | 64.68 |
    | all-MiniLM-L6-v2   | 46 MB  | 384  | 256     | 56.30 |

Recommendation:
    Use nomic-embed-text for production. It handles 512-token chunks
    without truncation (8K context), supports Matryoshka dimensions
    (768/256/128), and runs locally via Ollama.
"""

from .config import (
    EmbeddingConfig,
    EmbeddingModel,
    EmbeddingProvider,
    DEFAULT_EMBEDDING_CONFIG,
)
from .embedder import Embedder, create_embedder
from .retriever import NomicEmbeddingRetriever

__all__ = [
    # Configuration
    "EmbeddingConfig",
    "EmbeddingModel", 
    "EmbeddingProvider",
    "DEFAULT_EMBEDDING_CONFIG",
    # Embedder
    "Embedder",
    "create_embedder",
    # Retriever
    "NomicEmbeddingRetriever",
]
