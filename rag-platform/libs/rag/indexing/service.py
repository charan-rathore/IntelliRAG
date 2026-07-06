"""Indexing service for the RAG pipeline.

This service orchestrates the CHUNKED → EMBEDDED → INDEXED transitions:
1. Takes chunks from the chunking service
2. Generates embeddings using the Embedder
3. Persists chunks to the vector store with metadata
4. Reports results for lifecycle state updates

LIFECYCLE POSITION:
    CHUNKED → (this service: embed) → EMBEDDED → (this service: index) → INDEXED

DESIGN DECISIONS:
- All-or-nothing per document: Either all chunks are embedded and indexed, or none.
  This prevents partial indexing that would return incomplete results.
- Upsert semantics: Re-indexing the same chunks is safe (idempotent).
- Old version cleanup: Before indexing a new version, delete old vectors.

FAILURE HANDLING:
- Ollama down → IndexingResult.success=False, document stays at CHUNKED
- Vector store write failure → IndexingResult.success=False, stays at EMBEDDED
- Partial embedding → Rolls back (doesn't write to vector store)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from uuid import UUID

import numpy as np

from libs.rag.embeddings.config import EmbeddingConfig, DEFAULT_EMBEDDING_CONFIG
from libs.rag.embeddings.embedder import Embedder
from libs.shared.models.chunk import Chunk

from .vector_store import VectorSearchResult, VectorStore

if TYPE_CHECKING:
    from libs.connectors.sinks.postgres.chunk_repository import ChunkRepository

logger = logging.getLogger(__name__)


@dataclass
class IndexingConfig:
    """Configuration for the indexing service.

    Attributes:
        embedding_config: Configuration for the embedding model.
        batch_size: Number of chunks to embed in a single batch.
        collection_name: Vector store collection name.
        store_document_text: Whether to store chunk text in the vector store.
            Pro: Enables text retrieval without Postgres roundtrip.
            Con: Doubles storage (text in both Postgres and vector store).
            Decision: True for V1 (simplicity), revisit at scale.
    """
    embedding_config: EmbeddingConfig = None
    batch_size: int = 32
    collection_name: str = "rag_chunks"
    store_document_text: bool = True

    def __post_init__(self):
        if self.embedding_config is None:
            self.embedding_config = DEFAULT_EMBEDDING_CONFIG


@dataclass
class IndexingResult:
    """Result of indexing a set of chunks.

    Contains both success/failure status and detailed metrics
    for observability and debugging.
    """
    document_id: UUID
    version_id: UUID
    success: bool
    chunks_embedded: int = 0
    chunks_indexed: int = 0
    embedding_time_ms: float = 0.0
    indexing_time_ms: float = 0.0
    total_time_ms: float = 0.0
    embedding_model: str = ""
    embedding_dimensions: int = 0
    error_message: Optional[str] = None
    old_vectors_deleted: int = 0

    @classmethod
    def failure(
        cls,
        document_id: UUID,
        version_id: UUID,
        error_message: str,
    ) -> "IndexingResult":
        return cls(
            document_id=document_id,
            version_id=version_id,
            success=False,
            error_message=error_message,
        )


class IndexingService:
    """Service for embedding and indexing document chunks.

    Orchestrates the full indexing pipeline:
    1. Generate embeddings for chunks (via Embedder/Ollama)
    2. Prepare metadata payloads for filtered search
    3. Delete old vectors for the document (if re-indexing)
    4. Insert new vectors into the vector store

    Usage:
        store = ChromaVectorStore(persist_directory="./data/chroma")
        service = IndexingService(vector_store=store)

        result = service.index_document_chunks(
            chunks=chunk_list,
            document_id=doc_id,
            version_id=ver_id,
        )

        if result.success:
            # Update lifecycle to INDEXED
            pass
    """

    def __init__(
        self,
        vector_store: VectorStore,
        config: Optional[IndexingConfig] = None,
        chunk_repository: Optional["ChunkRepository"] = None,
    ) -> None:
        self.vector_store = vector_store
        self.config = config or IndexingConfig()
        self.chunk_repository = chunk_repository
        self._embedder: Optional[Embedder] = None

    def _get_embedder(self) -> Embedder:
        """Lazy initialization of the embedding model."""
        if self._embedder is None:
            self._embedder = Embedder(self.config.embedding_config)
        return self._embedder

    def index_document_chunks(
        self,
        chunks: List[Chunk],
        document_id: UUID,
        version_id: UUID,
        delete_old_vectors: bool = True,
    ) -> IndexingResult:
        """Embed and index all chunks for a document version.

        This is the main entry point for the indexing pipeline.
        It performs all-or-nothing indexing: if any step fails,
        no vectors are written.

        Args:
            chunks: List of Chunk objects from the chunking service.
            document_id: Parent document ID.
            version_id: Document version being indexed.
            delete_old_vectors: Whether to remove old vectors first.

        Returns:
            IndexingResult with status and metrics.
        """
        total_start = time.time()

        if not chunks:
            return IndexingResult.failure(
                document_id, version_id,
                "No chunks provided for indexing",
            )

        embedder = self._get_embedder()
        embedding_model = self.config.embedding_config.model_name
        embedding_dims = self.config.embedding_config.dimensions

        # Step 1: Generate embeddings for all chunks
        embed_start = time.time()
        try:
            texts = [chunk.chunk_text for chunk in chunks]
            embeddings = embedder.embed_batch(
                texts,
                batch_size=self.config.batch_size,
                is_query=False,
            )
        except Exception as e:
            logger.error(
                f"Embedding generation failed for document={document_id}: {e}",
                exc_info=True,
            )
            return IndexingResult.failure(
                document_id, version_id,
                f"Embedding generation failed: {e}",
            )
        embed_time_ms = (time.time() - embed_start) * 1000

        if embeddings.shape[0] != len(chunks):
            return IndexingResult.failure(
                document_id, version_id,
                f"Embedding count mismatch: got {embeddings.shape[0]}, expected {len(chunks)}",
            )

        logger.info(
            f"Generated {len(chunks)} embeddings for document={document_id} "
            f"in {embed_time_ms:.1f}ms (model={embedding_model}, dims={embedding_dims})"
        )

        # Step 2: Delete old vectors for this document (if re-indexing)
        old_deleted = 0
        if delete_old_vectors:
            try:
                old_deleted = self.vector_store.delete(
                    filter_metadata={"document_id": str(document_id)}
                )
                if old_deleted > 0:
                    logger.info(
                        f"Deleted {old_deleted} old vectors for document={document_id}"
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to delete old vectors for document={document_id}: {e}. "
                    "Proceeding with upsert (will overwrite)."
                )

        # Step 3: Prepare vector store payloads
        ids = []
        embedding_lists = []
        metadatas = []
        documents = []

        for i, chunk in enumerate(chunks):
            chunk_id_str = str(chunk.chunk_id)
            ids.append(chunk_id_str)
            embedding_lists.append(embeddings[i].tolist())

            metadata = self._build_vector_metadata(
                chunk=chunk,
                document_id=document_id,
                version_id=version_id,
                embedding_model=embedding_model,
                embedding_dimensions=embedding_dims,
            )
            metadatas.append(metadata)

            if self.config.store_document_text:
                documents.append(chunk.chunk_text)

        # Step 4: Insert into vector store
        index_start = time.time()
        try:
            indexed_count = self.vector_store.add(
                ids=ids,
                embeddings=embedding_lists,
                metadatas=metadatas,
                documents=documents if self.config.store_document_text else None,
            )
        except Exception as e:
            logger.error(
                f"Vector store insertion failed for document={document_id}: {e}",
                exc_info=True,
            )
            return IndexingResult.failure(
                document_id, version_id,
                f"Vector store insertion failed: {e}",
            )
        index_time_ms = (time.time() - index_start) * 1000

        if self.chunk_repository is not None:
            try:
                chunk_ids = [chunk.chunk_id for chunk in chunks]
                self.chunk_repository.mark_embedded(
                    chunk_ids=chunk_ids,
                    embedding_model=embedding_model,
                    embedding_dimensions=embedding_dims,
                )
                self.chunk_repository.mark_indexed(
                    chunk_ids=chunk_ids,
                    collection_name=self.config.collection_name,
                )
            except Exception as e:
                logger.error(
                    f"Postgres status update failed for document={document_id}: {e}",
                    exc_info=True,
                )
                return IndexingResult.failure(
                    document_id, version_id,
                    f"Postgres status update failed: {e}",
                )

        total_time_ms = (time.time() - total_start) * 1000

        logger.info(
            f"Indexed {indexed_count} chunks for document={document_id} "
            f"in {total_time_ms:.1f}ms (embed={embed_time_ms:.1f}ms, index={index_time_ms:.1f}ms)"
        )

        return IndexingResult(
            document_id=document_id,
            version_id=version_id,
            success=True,
            chunks_embedded=len(chunks),
            chunks_indexed=indexed_count,
            embedding_time_ms=embed_time_ms,
            indexing_time_ms=index_time_ms,
            total_time_ms=total_time_ms,
            embedding_model=embedding_model,
            embedding_dimensions=embedding_dims,
            old_vectors_deleted=old_deleted,
        )

    def search(
        self,
        query: str,
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[VectorSearchResult]:
        """Search the vector store using a text query.

        Embeds the query using the same model used for indexing,
        then performs vector similarity search.

        Args:
            query: Natural language query.
            top_k: Number of results to return.
            filter_metadata: Optional metadata filter.

        Returns:
            List of VectorSearchResult sorted by relevance.
        """
        embedder = self._get_embedder()
        query_embedding = embedder.embed_query(query)
        query_list = query_embedding.tolist()

        return self.vector_store.search(
            query_embedding=query_list,
            top_k=top_k,
            filter_metadata=filter_metadata,
        )

    def remove_document(self, document_id: UUID) -> int:
        """Remove all vectors for a document from the store.

        Used when a document is deleted or needs full re-indexing.

        Args:
            document_id: The document to remove.

        Returns:
            Number of vectors removed.
        """
        deleted = self.vector_store.delete(
            filter_metadata={"document_id": str(document_id)}
        )
        logger.info(f"Removed {deleted} vectors for document={document_id}")
        return deleted

    def get_stats(self) -> Dict[str, Any]:
        """Get indexing statistics for observability.

        Returns:
            Dictionary with vector count, model info, etc.
        """
        return {
            "total_vectors": self.vector_store.count(),
            "collection_exists": self.vector_store.collection_exists(),
            "embedding_model": self.config.embedding_config.model_name,
            "embedding_dimensions": self.config.embedding_config.dimensions,
            "collection_name": self.config.collection_name,
        }

    def close(self) -> None:
        """Clean up resources."""
        if self._embedder is not None:
            self._embedder.close()
            self._embedder = None

    def _build_vector_metadata(
        self,
        chunk: Chunk,
        document_id: UUID,
        version_id: UUID,
        embedding_model: str,
        embedding_dimensions: int,
    ) -> Dict[str, Any]:
        """Build metadata payload for vector store.

        This metadata is stored alongside each vector and enables:
        - Filtered search (by source_type, tenant_id, tags)
        - Traceability (link vector back to document/version)
        - Model tracking (which model generated this embedding)
        """
        meta = chunk.metadata
        return {
            "document_id": str(document_id),
            "version_id": str(version_id),
            "chunk_id": str(chunk.chunk_id),
            "chunk_index": chunk.chunk_index,
            "token_count": chunk.token_count,
            "source_type": meta.source_type.value if meta.source_type else "",
            "source_uri": meta.source_uri or "",
            "tenant_id": meta.tenant_id or "",
            "section_header": meta.section_header or "",
            "has_code_block": meta.has_code_block,
            "is_summary_chunk": meta.is_summary_chunk,
            "tags": ",".join(meta.tags) if meta.tags else "",
            "labels": ",".join(meta.labels) if meta.labels else "",
            "service": meta.service or "",
            "component": meta.component or "",
            "embedding_model": embedding_model,
            "embedding_dimensions": embedding_dimensions,
        }
