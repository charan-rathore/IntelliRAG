"""Vector store abstraction for the RAG pipeline.

This module defines the protocol (interface) that all vector store backends
must implement. This abstraction exists so we can:
1. Start with ChromaDB (zero-infra, pip install)
2. Swap to Qdrant, pgvector, or Pinecone later
3. Unit test with in-memory implementations

PRODUCTION VS LOCAL:
- Production: Qdrant Cloud / Pinecone (managed, scalable, SLA-backed)
- Local: ChromaDB (embedded, SQLite-backed, zero cost)
- Gap: No horizontal scaling, no replication, no HNSW tuning
- Upgrade trigger: >500K vectors or need for sub-10ms p99 latency
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class VectorSearchResult:
    """A single result from vector similarity search.

    Attributes:
        chunk_id: The unique identifier for the chunk.
        score: Similarity score (higher = more similar for cosine/dot product).
        metadata: Payload metadata stored alongside the vector.
        text: The chunk text (if stored in the vector store).
    """
    chunk_id: str
    score: float
    metadata: Dict[str, Any] = field(default_factory=dict)
    text: Optional[str] = None


@runtime_checkable
class VectorStore(Protocol):
    """Protocol for vector store backends.

    Any vector store implementation must support these operations.
    The protocol is intentionally minimal — we add methods only when
    we have a concrete use case, not speculatively.

    Operations:
        add: Insert vectors with metadata (supports upsert for idempotency)
        search: Find similar vectors with optional metadata filtering
        delete: Remove vectors by chunk IDs or by document_id filter
        count: Get the number of vectors in a collection
        collection_exists: Check if a collection has been created
    """

    def add(
        self,
        ids: List[str],
        embeddings: List[List[float]],
        metadatas: Optional[List[Dict[str, Any]]] = None,
        documents: Optional[List[str]] = None,
    ) -> int:
        """Insert or upsert vectors into the store.

        Args:
            ids: Unique identifiers for each vector (chunk_ids).
            embeddings: Vector embeddings as lists of floats.
            metadatas: Optional metadata payloads for filtered search.
            documents: Optional raw text to store alongside vectors.

        Returns:
            Number of vectors successfully inserted/upserted.
        """
        ...

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[VectorSearchResult]:
        """Search for similar vectors.

        Args:
            query_embedding: The query vector.
            top_k: Maximum number of results to return.
            filter_metadata: Optional metadata filter (exact match).

        Returns:
            List of VectorSearchResult sorted by descending similarity.
        """
        ...

    def delete(
        self,
        ids: Optional[List[str]] = None,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> int:
        """Delete vectors by IDs or metadata filter.

        At least one of ids or filter_metadata must be provided.

        Args:
            ids: Specific vector IDs to delete.
            filter_metadata: Delete all vectors matching this filter.

        Returns:
            Number of vectors deleted.
        """
        ...

    def count(self) -> int:
        """Get total number of vectors in the collection.

        Returns:
            Vector count.
        """
        ...

    def collection_exists(self) -> bool:
        """Check if the underlying collection has been created.

        Returns:
            True if the collection exists and is ready for operations.
        """
        ...
