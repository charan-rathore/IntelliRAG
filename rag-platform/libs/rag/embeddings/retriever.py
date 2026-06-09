"""Embedding-based retriever using nomic-embed-text for benchmarking.

This module provides a retriever that uses nomic-embed-text embeddings
for semantic similarity search. Designed for integration with the
chunking benchmark framework.

Usage:
    from libs.rag.embeddings import NomicEmbeddingRetriever, EmbeddingConfig
    
    # Create retriever with chunks
    chunks = [("id1", "chunk text 1"), ("id2", "chunk text 2")]
    retriever = NomicEmbeddingRetriever(chunks)
    
    # Retrieve similar chunks
    results = retriever.retrieve("What is Kubernetes?", top_k=5)
"""

from __future__ import annotations

import logging
from typing import List, Optional, Tuple

import numpy as np

from .config import EmbeddingConfig, EmbeddingProvider
from .embedder import Embedder

logger = logging.getLogger(__name__)


class NomicEmbeddingRetriever:
    """Retriever using nomic-embed-text embeddings for semantic search.
    
    This retriever is designed for the benchmark framework, providing
    semantic similarity search using the recommended nomic-embed-text model.
    
    Features:
    - Pre-computes document embeddings on initialization
    - Uses query prefix for better retrieval accuracy
    - Supports both dot product and cosine similarity
    - Falls back to SimpleRetriever if embeddings fail
    
    Example:
        chunks = [("id1", "chunk1"), ("id2", "chunk2")]
        retriever = NomicEmbeddingRetriever(chunks)
        
        results = retriever.retrieve("What is X?", top_k=5)
        # Returns: ["most relevant chunk", "second most relevant", ...]
    """
    
    def __init__(
        self,
        chunks: List[Tuple[str, str]],
        config: Optional[EmbeddingConfig] = None,
    ) -> None:
        """Initialize retriever with chunks.
        
        Args:
            chunks: List of (chunk_id, chunk_text) tuples.
            config: Embedding configuration. Defaults to nomic-embed-text.
        """
        self.chunks = chunks
        self.config = config or EmbeddingConfig.for_nomic()
        self._embedder: Optional[Embedder] = None
        self._embeddings: Optional[np.ndarray] = None
        self._initialized = False
        
        # Try to initialize embeddings
        try:
            self._initialize_embeddings()
        except Exception as e:
            logger.warning(
                f"Failed to initialize embeddings: {e}. "
                "Falling back to lexical retrieval."
            )
    
    def _initialize_embeddings(self) -> None:
        """Initialize embedder and compute chunk embeddings."""
        if not self.chunks:
            return
        
        self._embedder = Embedder(self.config)
        
        # Extract texts and compute embeddings
        texts = [text for _, text in self.chunks]
        
        logger.info(f"Computing embeddings for {len(texts)} chunks...")
        self._embeddings = self._embedder.embed_documents(texts)
        
        logger.info(
            f"Embeddings computed: shape={self._embeddings.shape}, "
            f"model={self.config.model_name}"
        )
        
        self._initialized = True
    
    def retrieve(self, query: str, top_k: int = 5) -> List[str]:
        """Retrieve top-k chunks by embedding similarity.
        
        Args:
            query: Query string.
            top_k: Number of chunks to return.
        
        Returns:
            List of chunk texts sorted by relevance.
        """
        if not self._initialized or self._embeddings is None:
            # Fallback to lexical retrieval
            return self._lexical_retrieve(query, top_k)
        
        # Compute query embedding
        query_embedding = self._embedder.embed_query(query)
        
        # Compute similarities (dot product, since normalized = cosine)
        similarities = np.dot(self._embeddings, query_embedding)
        
        # Get top-k indices
        if top_k >= len(self.chunks):
            top_indices = np.argsort(similarities)[::-1]
        else:
            top_indices = np.argpartition(similarities, -top_k)[-top_k:]
            top_indices = top_indices[np.argsort(similarities[top_indices])[::-1]]
        
        return [self.chunks[i][1] for i in top_indices[:top_k]]
    
    def retrieve_with_scores(
        self, query: str, top_k: int = 5
    ) -> List[Tuple[str, str, float]]:
        """Retrieve top-k chunks with similarity scores.
        
        Args:
            query: Query string.
            top_k: Number of chunks to return.
        
        Returns:
            List of (chunk_id, chunk_text, score) tuples sorted by relevance.
        """
        if not self._initialized or self._embeddings is None:
            # Fallback with fake scores
            texts = self._lexical_retrieve(query, top_k)
            return [(str(i), text, 0.0) for i, text in enumerate(texts)]
        
        # Compute query embedding
        query_embedding = self._embedder.embed_query(query)
        
        # Compute similarities
        similarities = np.dot(self._embeddings, query_embedding)
        
        # Get top-k indices
        if top_k >= len(self.chunks):
            top_indices = np.argsort(similarities)[::-1]
        else:
            top_indices = np.argpartition(similarities, -top_k)[-top_k:]
            top_indices = top_indices[np.argsort(similarities[top_indices])[::-1]]
        
        return [
            (self.chunks[i][0], self.chunks[i][1], float(similarities[i]))
            for i in top_indices[:top_k]
        ]
    
    def _lexical_retrieve(self, query: str, top_k: int) -> List[str]:
        """Fallback lexical retrieval using word overlap."""
        query_words = set(query.lower().split())
        
        scored = []
        for chunk_id, chunk_text in self.chunks:
            chunk_words = set(chunk_text.lower().split())
            
            if not chunk_words:
                continue
            
            overlap = len(query_words & chunk_words)
            jaccard = overlap / len(query_words | chunk_words) if (query_words | chunk_words) else 0
            
            scored.append((jaccard, chunk_text))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        
        return [text for _, text in scored[:top_k]]
    
    @property
    def is_initialized(self) -> bool:
        """Check if embeddings are ready."""
        return self._initialized
    
    @property
    def embedding_dimensions(self) -> int:
        """Get embedding dimensions."""
        return self.config.dimensions
    
    def close(self) -> None:
        """Close embedder connections."""
        if self._embedder:
            self._embedder.close()


class MultiModelRetriever:
    """Retriever that supports switching between embedding models.
    
    Useful for A/B testing different models or comparing performance.
    
    Example:
        retriever = MultiModelRetriever(chunks)
        
        # Test with nomic
        nomic_results = retriever.retrieve("query", model="nomic-embed-text")
        
        # Test with minilm
        minilm_results = retriever.retrieve("query", model="all-MiniLM-L6-v2")
    """
    
    def __init__(self, chunks: List[Tuple[str, str]]) -> None:
        """Initialize with chunks.
        
        Args:
            chunks: List of (chunk_id, chunk_text) tuples.
        """
        self.chunks = chunks
        self._retrievers: dict[str, NomicEmbeddingRetriever] = {}
    
    def _get_retriever(self, model: str) -> NomicEmbeddingRetriever:
        """Get or create retriever for model."""
        if model not in self._retrievers:
            if model == "nomic-embed-text":
                config = EmbeddingConfig.for_nomic()
            elif model == "all-MiniLM-L6-v2":
                config = EmbeddingConfig.for_minilm()
            elif model == "mxbai-embed-large":
                config = EmbeddingConfig.for_mxbai()
            else:
                config = EmbeddingConfig(model_name=model)
            
            self._retrievers[model] = NomicEmbeddingRetriever(
                self.chunks, config=config
            )
        
        return self._retrievers[model]
    
    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        model: str = "nomic-embed-text",
    ) -> List[str]:
        """Retrieve chunks using specified model.
        
        Args:
            query: Query string.
            top_k: Number of chunks to return.
            model: Embedding model to use.
        
        Returns:
            List of chunk texts.
        """
        retriever = self._get_retriever(model)
        return retriever.retrieve(query, top_k)
    
    def compare_models(
        self,
        query: str,
        models: List[str],
        top_k: int = 5,
    ) -> dict[str, List[str]]:
        """Compare retrieval results across models.
        
        Args:
            query: Query string.
            models: List of model names to compare.
            top_k: Number of chunks per model.
        
        Returns:
            Dictionary mapping model name to results.
        """
        return {
            model: self.retrieve(query, top_k, model)
            for model in models
        }
    
    def close(self) -> None:
        """Close all retrievers."""
        for retriever in self._retrievers.values():
            retriever.close()
