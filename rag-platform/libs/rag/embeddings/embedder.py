"""Embedding generation using nomic-embed-text via Ollama.

This module provides production-ready embedding generation optimized for
the RAG pipeline. It supports both Ollama (recommended) and sentence-transformers.

Usage:
    # Initialize with default nomic-embed-text configuration
    embedder = Embedder()
    
    # Embed documents (no prefix)
    doc_embeddings = embedder.embed_documents(["chunk1", "chunk2"])
    
    # Embed queries (with "search_query: " prefix for better retrieval)
    query_embedding = embedder.embed_query("What is Kubernetes?")
    
    # Batch embedding with progress bar
    embeddings = embedder.embed_batch(chunks, batch_size=32)
"""

from __future__ import annotations

import logging
from typing import List, Optional, Union

import numpy as np

from .config import EmbeddingConfig, EmbeddingProvider, DEFAULT_EMBEDDING_CONFIG

logger = logging.getLogger(__name__)


class Embedder:
    """Production embedding generator using nomic-embed-text.
    
    Supports multiple backends:
    - Ollama (recommended): `ollama pull nomic-embed-text`
    - sentence-transformers: For legacy models like all-MiniLM-L6-v2
    
    Features:
    - Automatic query/document prefixing for optimal retrieval
    - Batch processing with configurable batch size
    - L2 normalization for cosine similarity
    - Matryoshka dimension truncation (768 -> 256 -> 128)
    
    Example:
        embedder = Embedder(EmbeddingConfig.for_nomic())
        
        # Embed chunks for storage
        doc_embeddings = embedder.embed_documents(chunk_texts)
        
        # Embed query for retrieval
        query_embedding = embedder.embed_query(user_question)
    """
    
    def __init__(self, config: Optional[EmbeddingConfig] = None) -> None:
        """Initialize embedder with configuration.
        
        Args:
            config: Embedding configuration. Defaults to nomic-embed-text.
        """
        self.config = config or DEFAULT_EMBEDDING_CONFIG
        self._model = None
        self._ollama_client = None
        self._initialized = False
    
    def _initialize(self) -> None:
        """Lazy initialization of embedding model."""
        if self._initialized:
            return
        
        if self.config.provider == EmbeddingProvider.OLLAMA:
            self._initialize_ollama()
        else:
            self._initialize_sentence_transformers()
        
        self._initialized = True
    
    def _initialize_ollama(self) -> None:
        """Initialize Ollama embedding client."""
        try:
            import httpx
            self._ollama_client = httpx.Client(
                base_url=self.config.base_url,
                timeout=60.0,
            )
            
            # Verify model is available
            response = self._ollama_client.get("/api/tags")
            if response.status_code == 200:
                models = response.json().get("models", [])
                model_names = [m.get("name", "").split(":")[0] for m in models]
                if self.config.model_name not in model_names:
                    logger.warning(
                        f"Model '{self.config.model_name}' not found in Ollama. "
                        f"Available: {model_names}. Run: ollama pull {self.config.model_name}"
                    )
            
            logger.info(
                f"Initialized Ollama embedder with model={self.config.model_name}"
            )
            
        except ImportError:
            raise RuntimeError(
                "httpx is required for Ollama embeddings. "
                "Install with: pip install httpx"
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to connect to Ollama at {self.config.base_url}: {e}. "
                f"Make sure Ollama is running: ollama serve"
            )
    
    def _initialize_sentence_transformers(self) -> None:
        """Initialize sentence-transformers model."""
        try:
            from sentence_transformers import SentenceTransformer
            
            self._model = SentenceTransformer(self.config.model_name)
            logger.info(
                f"Initialized sentence-transformers with model={self.config.model_name}"
            )
            
        except ImportError:
            raise RuntimeError(
                "sentence-transformers is required for this model. "
                "Install with: pip install sentence-transformers"
            )
    
    def _embed_ollama(self, texts: List[str]) -> np.ndarray:
        """Generate embeddings using Ollama API."""
        embeddings = []
        
        for text in texts:
            response = self._ollama_client.post(
                "/api/embeddings",
                json={
                    "model": self.config.model_name,
                    "prompt": text,
                },
            )
            
            if response.status_code != 200:
                raise RuntimeError(
                    f"Ollama embedding failed: {response.status_code} {response.text}"
                )
            
            embedding = response.json().get("embedding", [])
            embeddings.append(embedding)
        
        return np.array(embeddings, dtype=np.float32)
    
    def _embed_sentence_transformers(self, texts: List[str]) -> np.ndarray:
        """Generate embeddings using sentence-transformers."""
        embeddings = self._model.encode(
            texts,
            batch_size=self.config.batch_size,
            show_progress_bar=self.config.show_progress,
            convert_to_numpy=True,
            normalize_embeddings=False,  # We handle normalization ourselves
        )
        return embeddings.astype(np.float32)
    
    def _normalize(self, embeddings: np.ndarray) -> np.ndarray:
        """L2 normalize embeddings for cosine similarity."""
        if not self.config.normalize:
            return embeddings
        
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)  # Avoid division by zero
        return embeddings / norms
    
    def _truncate_dimensions(self, embeddings: np.ndarray) -> np.ndarray:
        """Truncate embeddings to configured dimensions (Matryoshka).
        
        nomic-embed-text supports Matryoshka representation learning,
        allowing truncation from 768 -> 256 -> 128 with ~95% accuracy retention.
        """
        if embeddings.shape[1] <= self.config.dimensions:
            return embeddings
        
        return embeddings[:, :self.config.dimensions]
    
    def embed_documents(
        self,
        texts: List[str],
        show_progress: Optional[bool] = None,
    ) -> np.ndarray:
        """Embed documents (chunks) for storage.
        
        Uses document prefix if configured (typically None for nomic).
        
        Args:
            texts: List of document texts to embed.
            show_progress: Override config's show_progress setting.
        
        Returns:
            NumPy array of shape (n_texts, dimensions).
        """
        self._initialize()
        
        if not texts:
            return np.array([], dtype=np.float32).reshape(0, self.config.dimensions)
        
        # Apply document prefix if configured
        if self.config.document_prefix:
            texts = [f"{self.config.document_prefix}{t}" for t in texts]
        
        # Generate embeddings
        if self.config.provider == EmbeddingProvider.OLLAMA:
            embeddings = self._embed_ollama(texts)
        else:
            old_progress = self.config.show_progress
            if show_progress is not None:
                self.config.show_progress = show_progress
            embeddings = self._embed_sentence_transformers(texts)
            self.config.show_progress = old_progress
        
        # Post-process
        embeddings = self._truncate_dimensions(embeddings)
        embeddings = self._normalize(embeddings)
        
        return embeddings
    
    def embed_query(self, text: str) -> np.ndarray:
        """Embed a single query for retrieval.
        
        Uses query prefix if configured ("search_query: " for nomic).
        
        Args:
            text: Query text to embed.
        
        Returns:
            NumPy array of shape (dimensions,).
        """
        self._initialize()
        
        # Apply query prefix if configured
        if self.config.query_prefix:
            text = f"{self.config.query_prefix}{text}"
        
        # Generate embedding
        if self.config.provider == EmbeddingProvider.OLLAMA:
            embedding = self._embed_ollama([text])[0]
        else:
            embedding = self._embed_sentence_transformers([text])[0]
        
        # Post-process
        embedding = embedding[:self.config.dimensions]
        if self.config.normalize:
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm
        
        return embedding
    
    def embed_queries(self, texts: List[str]) -> np.ndarray:
        """Embed multiple queries for retrieval.
        
        Uses query prefix if configured.
        
        Args:
            texts: List of query texts to embed.
        
        Returns:
            NumPy array of shape (n_texts, dimensions).
        """
        self._initialize()
        
        if not texts:
            return np.array([], dtype=np.float32).reshape(0, self.config.dimensions)
        
        # Apply query prefix if configured
        if self.config.query_prefix:
            texts = [f"{self.config.query_prefix}{t}" for t in texts]
        
        # Generate embeddings
        if self.config.provider == EmbeddingProvider.OLLAMA:
            embeddings = self._embed_ollama(texts)
        else:
            embeddings = self._embed_sentence_transformers(texts)
        
        # Post-process
        embeddings = self._truncate_dimensions(embeddings)
        embeddings = self._normalize(embeddings)
        
        return embeddings
    
    def embed_batch(
        self,
        texts: List[str],
        batch_size: Optional[int] = None,
        is_query: bool = False,
    ) -> np.ndarray:
        """Embed a large batch of texts with progress tracking.
        
        Processes texts in batches to manage memory usage.
        
        Args:
            texts: List of texts to embed.
            batch_size: Override config's batch_size.
            is_query: Whether texts are queries (applies query prefix).
        
        Returns:
            NumPy array of shape (n_texts, dimensions).
        """
        self._initialize()
        
        if not texts:
            return np.array([], dtype=np.float32).reshape(0, self.config.dimensions)
        
        batch_size = batch_size or self.config.batch_size
        all_embeddings = []
        
        # Apply appropriate prefix
        prefix = self.config.query_prefix if is_query else self.config.document_prefix
        if prefix:
            texts = [f"{prefix}{t}" for t in texts]
        
        # Process in batches
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            
            if self.config.provider == EmbeddingProvider.OLLAMA:
                batch_embeddings = self._embed_ollama(batch)
            else:
                batch_embeddings = self._embed_sentence_transformers(batch)
            
            all_embeddings.append(batch_embeddings)
            
            if self.config.show_progress:
                processed = min(i + batch_size, len(texts))
                logger.info(f"Embedded {processed}/{len(texts)} texts")
        
        embeddings = np.vstack(all_embeddings)
        embeddings = self._truncate_dimensions(embeddings)
        embeddings = self._normalize(embeddings)
        
        return embeddings
    
    @property
    def dimensions(self) -> int:
        """Get configured embedding dimensions."""
        return self.config.dimensions
    
    def close(self) -> None:
        """Close any open connections."""
        if self._ollama_client:
            self._ollama_client.close()
            self._ollama_client = None
        self._initialized = False


def create_embedder(
    model: str = "nomic-embed-text",
    provider: str = "ollama",
    dimensions: int = 768,
    **kwargs,
) -> Embedder:
    """Factory function to create an embedder.
    
    Args:
        model: Model name.
        provider: "ollama" or "sentence_transformers".
        dimensions: Embedding dimensions.
        **kwargs: Additional EmbeddingConfig parameters.
    
    Returns:
        Configured Embedder instance.
    
    Examples:
        # Default nomic-embed-text via Ollama
        embedder = create_embedder()
        
        # MiniLM via sentence-transformers
        embedder = create_embedder(
            model="all-MiniLM-L6-v2",
            provider="sentence_transformers",
            dimensions=384,
        )
    """
    config = EmbeddingConfig(
        model_name=model,
        provider=EmbeddingProvider(provider),
        dimensions=dimensions,
        **kwargs,
    )
    return Embedder(config)
