"""Tests for ChromaDB vector store implementation.

Tests cover:
- Basic CRUD operations (add, search, delete, count)
- Upsert idempotency (re-inserting same IDs updates rather than duplicates)
- Metadata filtering on search
- Delete by document_id
- Edge cases (empty inputs, dimension mismatches)
- Persistence (data survives re-initialization)
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import pytest

from libs.rag.indexing.chroma_store import ChromaVectorStore


@pytest.fixture
def temp_dir():
    """Create a temporary directory for ChromaDB persistence."""
    d = tempfile.mkdtemp(prefix="chroma_test_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def store(temp_dir):
    """Create a fresh ChromaVectorStore for each test."""
    return ChromaVectorStore(
        collection_name="test_collection",
        persist_directory=temp_dir,
        embedding_dimensions=4,
        distance_metric="cosine",
    )


def _make_embeddings(n: int, dims: int = 4) -> list[list[float]]:
    """Generate simple test embeddings."""
    return [[float(i + j) / 10 for j in range(dims)] for i in range(n)]


class TestChromaVectorStoreBasicOps:
    """Test basic CRUD operations."""

    def test_add_and_count(self, store):
        ids = ["c1", "c2", "c3"]
        embeddings = _make_embeddings(3)
        metadatas = [{"doc": "d1"}, {"doc": "d1"}, {"doc": "d2"}]

        count = store.add(ids=ids, embeddings=embeddings, metadatas=metadatas)

        assert count == 3
        assert store.count() == 3

    def test_add_empty(self, store):
        count = store.add(ids=[], embeddings=[])
        assert count == 0
        assert store.count() == 0

    def test_add_with_documents(self, store):
        ids = ["c1", "c2"]
        embeddings = _make_embeddings(2)
        documents = ["hello world", "foo bar"]

        store.add(ids=ids, embeddings=embeddings, documents=documents)

        results = store.search(query_embedding=embeddings[0], top_k=2)
        assert len(results) == 2
        texts = [r.text for r in results]
        assert "hello world" in texts

    def test_search_returns_sorted_by_similarity(self, store):
        ids = ["c1", "c2", "c3"]
        embeddings = [[1.0, 0.0, 0.0, 0.0], [0.9, 0.1, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
        store.add(ids=ids, embeddings=embeddings)

        results = store.search(
            query_embedding=[1.0, 0.0, 0.0, 0.0],
            top_k=3,
        )

        assert len(results) == 3
        assert results[0].chunk_id == "c1"
        assert results[0].score > results[2].score

    def test_search_with_metadata_filter(self, store):
        ids = ["c1", "c2", "c3"]
        embeddings = _make_embeddings(3)
        metadatas = [
            {"source_type": "github_issue"},
            {"source_type": "markdown_doc"},
            {"source_type": "github_issue"},
        ]
        store.add(ids=ids, embeddings=embeddings, metadatas=metadatas)

        results = store.search(
            query_embedding=embeddings[0],
            top_k=10,
            filter_metadata={"source_type": "github_issue"},
        )

        assert len(results) == 2
        for r in results:
            assert r.metadata.get("source_type") == "github_issue"

    def test_delete_by_ids(self, store):
        ids = ["c1", "c2", "c3"]
        embeddings = _make_embeddings(3)
        store.add(ids=ids, embeddings=embeddings)

        deleted = store.delete(ids=["c1", "c3"])

        assert deleted == 2
        assert store.count() == 1

    def test_delete_by_metadata(self, store):
        ids = ["c1", "c2", "c3"]
        embeddings = _make_embeddings(3)
        metadatas = [
            {"document_id": "doc-1"},
            {"document_id": "doc-1"},
            {"document_id": "doc-2"},
        ]
        store.add(ids=ids, embeddings=embeddings, metadatas=metadatas)

        deleted = store.delete(filter_metadata={"document_id": "doc-1"})

        assert deleted == 2
        assert store.count() == 1

    def test_delete_requires_argument(self, store):
        with pytest.raises(ValueError, match="At least one"):
            store.delete()

    def test_collection_exists(self, store):
        assert store.collection_exists() is True

    def test_count_empty(self, store):
        assert store.count() == 0


class TestChromaVectorStoreIdempotency:
    """Test upsert semantics — re-inserting same IDs is safe."""

    def test_upsert_same_ids_doesnt_duplicate(self, store):
        ids = ["c1", "c2"]
        embeddings = _make_embeddings(2)
        store.add(ids=ids, embeddings=embeddings)
        assert store.count() == 2

        new_embeddings = [[0.5, 0.5, 0.5, 0.5], [0.6, 0.6, 0.6, 0.6]]
        store.add(ids=ids, embeddings=new_embeddings)
        assert store.count() == 2

    def test_upsert_updates_metadata(self, store):
        ids = ["c1"]
        embeddings = _make_embeddings(1)
        store.add(ids=ids, embeddings=embeddings, metadatas=[{"version": "v1"}])

        store.add(ids=ids, embeddings=embeddings, metadatas=[{"version": "v2"}])

        results = store.search(query_embedding=embeddings[0], top_k=1)
        assert results[0].metadata.get("version") == "v2"


class TestChromaVectorStoreValidation:
    """Test input validation and edge cases."""

    def test_dimension_mismatch_on_add(self, store):
        ids = ["c1"]
        wrong_dims = [[1.0, 2.0]]  # 2 dims instead of 4

        with pytest.raises(ValueError, match="Expected 4 dimensions"):
            store.add(ids=ids, embeddings=wrong_dims)

    def test_dimension_mismatch_on_search(self, store):
        store.add(ids=["c1"], embeddings=[[1.0, 0.0, 0.0, 0.0]])

        with pytest.raises(ValueError, match="dimensions"):
            store.search(query_embedding=[1.0, 0.0])

    def test_ids_embeddings_length_mismatch(self, store):
        with pytest.raises(ValueError, match="same length"):
            store.add(ids=["c1", "c2"], embeddings=[[1.0, 0.0, 0.0, 0.0]])


class TestChromaVectorStoreDocumentOps:
    """Test document-level operations."""

    def test_delete_by_document_id(self, store):
        ids = ["c1", "c2", "c3", "c4"]
        embeddings = _make_embeddings(4)
        metadatas = [
            {"document_id": "doc-1"},
            {"document_id": "doc-1"},
            {"document_id": "doc-2"},
            {"document_id": "doc-2"},
        ]
        store.add(ids=ids, embeddings=embeddings, metadatas=metadatas)
        assert store.count() == 4

        deleted = store.delete_by_document_id("doc-1")
        assert deleted == 2
        assert store.count() == 2

    def test_get_by_document_id(self, store):
        ids = ["c1", "c2", "c3"]
        embeddings = _make_embeddings(3)
        metadatas = [
            {"document_id": "doc-1"},
            {"document_id": "doc-1"},
            {"document_id": "doc-2"},
        ]
        documents = ["text1", "text2", "text3"]
        store.add(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=documents)

        items = store.get_by_document_id("doc-1")
        assert len(items) == 2


class TestChromaVectorStorePersistence:
    """Test that data persists across re-initialization."""

    def test_data_survives_reinit(self, temp_dir):
        store1 = ChromaVectorStore(
            collection_name="persist_test",
            persist_directory=temp_dir,
            embedding_dimensions=4,
        )
        store1.add(
            ids=["c1", "c2"],
            embeddings=_make_embeddings(2),
            metadatas=[{"doc": "d1"}, {"doc": "d2"}],
        )
        assert store1.count() == 2

        store2 = ChromaVectorStore(
            collection_name="persist_test",
            persist_directory=temp_dir,
            embedding_dimensions=4,
        )
        assert store2.count() == 2

    def test_reset_clears_data(self, store):
        store.add(ids=["c1", "c2"], embeddings=_make_embeddings(2))
        assert store.count() == 2

        store.reset()
        assert store.count() == 0


class TestChromaVectorStoreMetadataSanitization:
    """Test that complex metadata types are handled correctly."""

    def test_list_metadata_serialized(self, store):
        ids = ["c1"]
        embeddings = _make_embeddings(1)
        metadatas = [{"tags": ["python", "ai"], "labels": []}]

        store.add(ids=ids, embeddings=embeddings, metadatas=metadatas)

        results = store.search(query_embedding=embeddings[0], top_k=1)
        assert results[0].metadata.get("tags") == "python,ai"
        assert results[0].metadata.get("labels") == ""

    def test_none_values_stripped(self, store):
        ids = ["c1"]
        embeddings = _make_embeddings(1)
        metadatas = [{"key1": "value1", "key2": None}]

        store.add(ids=ids, embeddings=embeddings, metadatas=metadatas)

        results = store.search(query_embedding=embeddings[0], top_k=1)
        assert "key2" not in results[0].metadata
