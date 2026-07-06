"""ChromaDB vector store implementation.

ChromaDB is an embedded vector database backed by SQLite. It provides:
- Zero infrastructure (pip install chromadb)
- Persistent storage to disk
- Metadata filtering on search
- Upsert semantics (idempotent writes)

TRADEOFFS VS QDRANT:
- Pro: No Docker, no separate process, ~50MB memory
- Pro: Embedded in the Python process (no network calls)
- Con: Single-process access only (no concurrent writers)
- Con: No HNSW tuning, no quantization controls
- Con: Scale ceiling ~500K-1M vectors before performance degrades

WHEN TO UPGRADE:
- Multiple workers need concurrent write access → Qdrant
- Need sub-10ms p99 at >500K vectors → Qdrant with HNSW tuning
- Need binary/scalar quantization → Qdrant
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from .vector_store import VectorSearchResult

logger = logging.getLogger(__name__)

DEFAULT_COLLECTION_NAME = "rag_chunks"
DEFAULT_PERSIST_DIR = "./data/chroma"


class ChromaVectorStore:
    """ChromaDB-backed vector store for local development.

    Uses ChromaDB's persistent client with SQLite backend.
    Supports upsert, metadata filtering, and similarity search.

    Usage:
        store = ChromaVectorStore(persist_directory="./data/chroma")

        store.add(
            ids=["chunk-1", "chunk-2"],
            embeddings=[[0.1, 0.2, ...], [0.3, 0.4, ...]],
            metadatas=[{"source_type": "github_issue"}, {...}],
            documents=["chunk text 1", "chunk text 2"],
        )

        results = store.search(
            query_embedding=[0.15, 0.25, ...],
            top_k=5,
            filter_metadata={"source_type": "github_issue"},
        )
    """

    def __init__(
        self,
        collection_name: str = DEFAULT_COLLECTION_NAME,
        persist_directory: str = DEFAULT_PERSIST_DIR,
        embedding_dimensions: int = 768,
        distance_metric: str = "cosine",
    ) -> None:
        """Initialize ChromaDB vector store.

        Args:
            collection_name: Name of the ChromaDB collection.
            persist_directory: Directory for SQLite persistence.
            embedding_dimensions: Expected embedding dimensions (for validation).
            distance_metric: Distance metric (cosine, l2, ip).
        """
        self._collection_name = collection_name
        self._persist_directory = persist_directory
        self._embedding_dimensions = embedding_dimensions
        self._distance_metric = distance_metric
        self._client = None
        self._collection = None

    def _ensure_initialized(self) -> None:
        """Lazy initialization of ChromaDB client and collection."""
        if self._collection is not None:
            return

        try:
            import chromadb
            from chromadb.config import Settings
        except ImportError:
            raise RuntimeError(
                "chromadb is required for vector indexing. "
                "Install with: pip install chromadb"
            )

        persist_path = Path(self._persist_directory)
        persist_path.mkdir(parents=True, exist_ok=True)

        self._client = chromadb.PersistentClient(
            path=str(persist_path),
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True,
            ),
        )

        self._collection = self._client.get_or_create_collection(
            name=self._collection_name,
            metadata={"hnsw:space": self._distance_metric},
        )

        logger.info(
            f"ChromaDB initialized: collection={self._collection_name}, "
            f"persist={self._persist_directory}, "
            f"existing_count={self._collection.count()}"
        )

    def add(
        self,
        ids: List[str],
        embeddings: List[List[float]],
        metadatas: Optional[List[Dict[str, Any]]] = None,
        documents: Optional[List[str]] = None,
    ) -> int:
        """Insert or upsert vectors into ChromaDB.

        Uses ChromaDB's upsert for idempotency — re-inserting the same
        chunk_id overwrites the previous vector and metadata.

        Args:
            ids: Chunk IDs (must be unique strings).
            embeddings: Vector embeddings.
            metadatas: Metadata payloads for filtered search.
            documents: Raw chunk texts.

        Returns:
            Number of vectors upserted.
        """
        self._ensure_initialized()

        if not ids:
            return 0

        if len(ids) != len(embeddings):
            raise ValueError(
                f"ids and embeddings must have same length: {len(ids)} vs {len(embeddings)}"
            )

        if embeddings and len(embeddings[0]) != self._embedding_dimensions:
            raise ValueError(
                f"Expected {self._embedding_dimensions} dimensions, "
                f"got {len(embeddings[0])}"
            )

        sanitized_metadatas = None
        if metadatas:
            sanitized_metadatas = [
                self._sanitize_metadata(m) for m in metadatas
            ]

        self._collection.upsert(
            ids=ids,
            embeddings=embeddings,
            metadatas=sanitized_metadatas,
            documents=documents,
        )

        logger.info(f"Upserted {len(ids)} vectors to collection={self._collection_name}")
        return len(ids)

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[VectorSearchResult]:
        """Search for similar vectors with optional metadata filtering.

        Args:
            query_embedding: Query vector.
            top_k: Number of results.
            filter_metadata: Exact-match metadata filter.

        Returns:
            Results sorted by descending similarity.
        """
        self._ensure_initialized()

        if len(query_embedding) != self._embedding_dimensions:
            raise ValueError(
                f"Query embedding has {len(query_embedding)} dimensions, "
                f"expected {self._embedding_dimensions}"
            )

        where_filter = None
        if filter_metadata:
            where_filter = self._build_where_filter(filter_metadata)

        query_result = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, self._collection.count() or top_k),
            where=where_filter,
            include=["metadatas", "documents", "distances"],
        )

        results = []
        if query_result and query_result["ids"] and query_result["ids"][0]:
            ids = query_result["ids"][0]
            distances = query_result["distances"][0] if query_result.get("distances") else [0.0] * len(ids)
            metadatas_list = query_result["metadatas"][0] if query_result.get("metadatas") else [{}] * len(ids)
            documents_list = query_result["documents"][0] if query_result.get("documents") else [None] * len(ids)

            for i, chunk_id in enumerate(ids):
                score = 1.0 - distances[i] if self._distance_metric == "cosine" else -distances[i]
                results.append(VectorSearchResult(
                    chunk_id=chunk_id,
                    score=score,
                    metadata=metadatas_list[i] or {},
                    text=documents_list[i],
                ))

        return results

    def delete(
        self,
        ids: Optional[List[str]] = None,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> int:
        """Delete vectors by IDs or metadata filter.

        Args:
            ids: Specific chunk IDs to delete.
            filter_metadata: Delete all matching vectors.

        Returns:
            Number of vectors deleted (approximate — ChromaDB doesn't
            report exact delete counts, so we count before/after).
        """
        self._ensure_initialized()

        if not ids and not filter_metadata:
            raise ValueError("At least one of ids or filter_metadata must be provided")

        count_before = self._collection.count()

        if ids:
            existing = self._collection.get(ids=ids)
            existing_ids = existing["ids"] if existing else []
            if existing_ids:
                self._collection.delete(ids=existing_ids)

        elif filter_metadata:
            where_filter = self._build_where_filter(filter_metadata)
            self._collection.delete(where=where_filter)

        count_after = self._collection.count()
        deleted = count_before - count_after

        logger.info(f"Deleted {deleted} vectors from collection={self._collection_name}")
        return deleted

    def count(self) -> int:
        """Get total vector count."""
        self._ensure_initialized()
        return self._collection.count()

    def collection_exists(self) -> bool:
        """Check if collection exists and is initialized."""
        try:
            self._ensure_initialized()
            return self._collection is not None
        except Exception:
            return False

    def delete_by_document_id(self, document_id: str) -> int:
        """Delete all vectors for a specific document.

        This is the primary cleanup operation during re-indexing:
        when a document gets a new version, delete old vectors first.

        Args:
            document_id: The document UUID string.

        Returns:
            Number of vectors deleted.
        """
        return self.delete(filter_metadata={"document_id": document_id})

    def get_by_document_id(self, document_id: str) -> List[Dict[str, Any]]:
        """Get all vectors for a document (for debugging/validation).

        Args:
            document_id: The document UUID string.

        Returns:
            List of dicts with id, metadata, and document text.
        """
        self._ensure_initialized()

        result = self._collection.get(
            where={"document_id": document_id},
            include=["metadatas", "documents"],
        )

        items = []
        if result and result["ids"]:
            for i, chunk_id in enumerate(result["ids"]):
                items.append({
                    "chunk_id": chunk_id,
                    "metadata": result["metadatas"][i] if result.get("metadatas") else {},
                    "text": result["documents"][i] if result.get("documents") else None,
                })

        return items

    def reset(self) -> None:
        """Delete the entire collection. Used for testing only."""
        self._ensure_initialized()
        self._client.delete_collection(self._collection_name)
        self._collection = None
        self._ensure_initialized()
        logger.warning(f"Reset collection={self._collection_name}")

    def _sanitize_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitize metadata for ChromaDB compatibility.

        ChromaDB metadata values must be str, int, float, or bool.
        Lists and nested dicts are not supported.
        """
        sanitized = {}
        for key, value in metadata.items():
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                sanitized[key] = value
            elif isinstance(value, list):
                sanitized[key] = ",".join(str(v) for v in value) if value else ""
            elif isinstance(value, dict):
                for nested_key, nested_val in value.items():
                    if nested_val is not None and isinstance(nested_val, (str, int, float, bool)):
                        sanitized[f"{key}_{nested_key}"] = nested_val
            else:
                sanitized[key] = str(value)
        return sanitized

    def _build_where_filter(self, filter_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Build ChromaDB where filter from metadata dict.

        Single key-value pairs become {"key": "value"}.
        Multiple conditions become {"$and": [{"key1": "val1"}, {"key2": "val2"}]}.
        """
        conditions = []
        for key, value in filter_metadata.items():
            if value is not None:
                conditions.append({key: value})

        if not conditions:
            return {}
        if len(conditions) == 1:
            return conditions[0]
        return {"$and": conditions}
