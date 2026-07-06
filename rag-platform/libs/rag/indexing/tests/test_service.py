"""Tests for the IndexingService.

Tests cover:
- End-to-end indexing (chunks → embeddings → vector store)
- Idempotent re-indexing
- Error handling (embedding failures, vector store failures)
- Search functionality
- Document removal
- Stats reporting

Uses an in-memory mock vector store to avoid ChromaDB dependency
in unit tests. Integration tests use the real ChromaDB.
"""

from __future__ import annotations

import shutil
import tempfile
from datetime import datetime
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import numpy as np
import pytest

from libs.shared.models.chunk import Chunk, ChunkMetadata
from libs.shared.models.lifecycle import IngestionSource
from libs.rag.indexing.chroma_store import ChromaVectorStore
from libs.rag.indexing.service import IndexingConfig, IndexingResult, IndexingService
from libs.rag.indexing.vector_store import VectorSearchResult


class MockVectorStore:
    """In-memory mock vector store for unit testing."""

    def __init__(self):
        self._data: Dict[str, Dict[str, Any]] = {}

    def add(
        self,
        ids: List[str],
        embeddings: List[List[float]],
        metadatas: Optional[List[Dict[str, Any]]] = None,
        documents: Optional[List[str]] = None,
    ) -> int:
        for i, id_ in enumerate(ids):
            self._data[id_] = {
                "embedding": embeddings[i],
                "metadata": metadatas[i] if metadatas else {},
                "document": documents[i] if documents else None,
            }
        return len(ids)

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[VectorSearchResult]:
        results = []
        for id_, data in self._data.items():
            if filter_metadata:
                match = all(
                    data["metadata"].get(k) == v
                    for k, v in filter_metadata.items()
                )
                if not match:
                    continue
            score = sum(a * b for a, b in zip(query_embedding, data["embedding"]))
            results.append(VectorSearchResult(
                chunk_id=id_,
                score=score,
                metadata=data["metadata"],
                text=data.get("document"),
            ))
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]

    def delete(
        self,
        ids: Optional[List[str]] = None,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> int:
        deleted = 0
        if ids:
            for id_ in ids:
                if id_ in self._data:
                    del self._data[id_]
                    deleted += 1
        elif filter_metadata:
            to_delete = []
            for id_, data in self._data.items():
                match = all(
                    data["metadata"].get(k) == v
                    for k, v in filter_metadata.items()
                )
                if match:
                    to_delete.append(id_)
            for id_ in to_delete:
                del self._data[id_]
                deleted += 1
        return deleted

    def count(self) -> int:
        return len(self._data)

    def collection_exists(self) -> bool:
        return True


def _make_chunks(n: int, document_id: UUID = None, version_id: UUID = None) -> List[Chunk]:
    """Create test chunks."""
    doc_id = document_id or uuid4()
    ver_id = version_id or uuid4()
    return [
        Chunk.create(
            document_id=doc_id,
            version_id=ver_id,
            chunk_index=i,
            chunk_text=f"Test chunk {i} with some content about topic {i}",
            token_count=10 + i,
            metadata=ChunkMetadata(
                source_type=IngestionSource.GITHUB_ISSUE,
                source_uri=f"https://github.com/test/repo/issues/{i}",
                tenant_id="test-tenant",
                tags=["test", "phase5"],
            ),
        )
        for i in range(n)
    ]


def _mock_embedder_embed_batch(texts, batch_size=32, is_query=False):
    """Mock embed_batch that returns deterministic embeddings."""
    return np.array([[float(i) / 10 for _ in range(768)] for i in range(len(texts))], dtype=np.float32)


def _mock_embedder_embed_query(text):
    """Mock embed_query that returns a deterministic embedding."""
    return np.array([0.5] * 768, dtype=np.float32)


class TestIndexingServiceCore:
    """Test core indexing functionality."""

    def test_index_document_chunks_success(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(3, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_get.return_value = mock_embedder

            result = service.index_document_chunks(
                chunks=chunks,
                document_id=doc_id,
                version_id=ver_id,
            )

        assert result.success is True
        assert result.chunks_embedded == 3
        assert result.chunks_indexed == 3
        assert result.document_id == doc_id
        assert result.version_id == ver_id
        assert result.embedding_model != ""
        assert result.embedding_time_ms > 0
        assert result.total_time_ms > 0
        assert mock_store.count() == 3

    def test_index_empty_chunks_fails(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        result = service.index_document_chunks(
            chunks=[],
            document_id=uuid4(),
            version_id=uuid4(),
        )

        assert result.success is False
        assert "No chunks" in result.error_message

    def test_index_stores_metadata(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(1, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_get.return_value = mock_embedder

            service.index_document_chunks(
                chunks=chunks,
                document_id=doc_id,
                version_id=ver_id,
            )

        chunk_id_str = str(chunks[0].chunk_id)
        stored = mock_store._data[chunk_id_str]
        metadata = stored["metadata"]

        assert metadata["document_id"] == str(doc_id)
        assert metadata["version_id"] == str(ver_id)
        assert metadata["source_type"] == "github_issue"
        assert metadata["tenant_id"] == "test-tenant"
        assert "test" in metadata["tags"]

    def test_index_stores_document_text(self):
        mock_store = MockVectorStore()
        config = IndexingConfig(store_document_text=True)
        service = IndexingService(vector_store=mock_store, config=config)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(1, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_get.return_value = mock_embedder

            service.index_document_chunks(
                chunks=chunks,
                document_id=doc_id,
                version_id=ver_id,
            )

        stored = mock_store._data[str(chunks[0].chunk_id)]
        assert stored["document"] is not None
        assert "Test chunk 0" in stored["document"]


class TestIndexingServiceIdempotency:
    """Test re-indexing the same document is safe."""

    def test_reindex_replaces_old_vectors(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        doc_id = uuid4()
        ver_id_1 = uuid4()
        ver_id_2 = uuid4()

        chunks_v1 = _make_chunks(3, doc_id, ver_id_1)
        chunks_v2 = _make_chunks(2, doc_id, ver_id_2)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_get.return_value = mock_embedder

            result1 = service.index_document_chunks(
                chunks=chunks_v1, document_id=doc_id, version_id=ver_id_1,
            )
            assert result1.success is True
            assert mock_store.count() == 3

            result2 = service.index_document_chunks(
                chunks=chunks_v2, document_id=doc_id, version_id=ver_id_2,
                delete_old_vectors=True,
            )

        assert result2.success is True
        assert result2.old_vectors_deleted == 3
        assert mock_store.count() == 2


class TestIndexingServiceErrorHandling:
    """Test error handling paths."""

    def test_embedding_failure_returns_error(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(2, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = RuntimeError("Ollama is down")
            mock_get.return_value = mock_embedder

            result = service.index_document_chunks(
                chunks=chunks, document_id=doc_id, version_id=ver_id,
            )

        assert result.success is False
        assert "Ollama is down" in result.error_message
        assert mock_store.count() == 0

    def test_vector_store_failure_returns_error(self):
        mock_store = MagicMock()
        mock_store.delete.return_value = 0
        mock_store.add.side_effect = RuntimeError("ChromaDB crashed")

        service = IndexingService(vector_store=mock_store)
        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(2, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_get.return_value = mock_embedder

            result = service.index_document_chunks(
                chunks=chunks, document_id=doc_id, version_id=ver_id,
            )

        assert result.success is False
        assert "ChromaDB crashed" in result.error_message


class TestIndexingServiceSearch:
    """Test search functionality."""

    def test_search_returns_results(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(5, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_embedder.embed_query.side_effect = _mock_embedder_embed_query
            mock_get.return_value = mock_embedder

            service.index_document_chunks(
                chunks=chunks, document_id=doc_id, version_id=ver_id,
            )

            results = service.search("test query", top_k=3)

        assert len(results) == 3
        assert all(isinstance(r, VectorSearchResult) for r in results)

    def test_search_with_filter(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(3, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_embedder.embed_query.side_effect = _mock_embedder_embed_query
            mock_get.return_value = mock_embedder

            service.index_document_chunks(
                chunks=chunks, document_id=doc_id, version_id=ver_id,
            )

            results = service.search(
                "test query",
                top_k=10,
                filter_metadata={"tenant_id": "test-tenant"},
            )

        assert len(results) == 3


class TestIndexingServiceDocumentOps:
    """Test document-level operations."""

    def test_remove_document(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(3, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.side_effect = _mock_embedder_embed_batch
            mock_get.return_value = mock_embedder

            service.index_document_chunks(
                chunks=chunks, document_id=doc_id, version_id=ver_id,
            )
            assert mock_store.count() == 3

            removed = service.remove_document(doc_id)

        assert removed == 3
        assert mock_store.count() == 0

    def test_get_stats(self):
        mock_store = MockVectorStore()
        service = IndexingService(vector_store=mock_store)

        stats = service.get_stats()

        assert stats["total_vectors"] == 0
        assert stats["collection_exists"] is True
        assert stats["embedding_model"] == "nomic-embed-text"
        assert stats["embedding_dimensions"] == 768


class TestIndexingServiceIntegration:
    """Integration tests using real ChromaDB (no mocks)."""

    @pytest.fixture
    def chroma_dir(self):
        d = tempfile.mkdtemp(prefix="index_test_")
        yield d
        shutil.rmtree(d, ignore_errors=True)

    def test_end_to_end_with_chroma(self, chroma_dir):
        """Full integration: index chunks → search → verify results."""
        store = ChromaVectorStore(
            collection_name="integration_test",
            persist_directory=chroma_dir,
            embedding_dimensions=768,
        )
        service = IndexingService(vector_store=store)

        doc_id = uuid4()
        ver_id = uuid4()
        chunks = _make_chunks(3, doc_id, ver_id)

        with patch.object(service, '_get_embedder') as mock_get:
            mock_embedder = MagicMock()
            mock_embedder.embed_batch.return_value = np.random.rand(3, 768).astype(np.float32)
            mock_embedder.embed_query.return_value = np.random.rand(768).astype(np.float32)
            mock_get.return_value = mock_embedder

            result = service.index_document_chunks(
                chunks=chunks, document_id=doc_id, version_id=ver_id,
            )

            assert result.success is True
            assert store.count() == 3

            search_results = service.search("test query", top_k=2)
            assert len(search_results) == 2

            removed = service.remove_document(doc_id)
            assert removed == 3
            assert store.count() == 0
