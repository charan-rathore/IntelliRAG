"""Tests for retrieval layer components."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock
from uuid import uuid4

import numpy as np
import pytest

from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.evaluation.retrieval_benchmark import (
    RetrievalBenchmark,
    mrr,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
)
from libs.rag.indexing.service import IndexingService
from libs.rag.indexing.vector_store import VectorSearchResult
from libs.rag.retrieval.dense import DenseRetriever
from libs.rag.retrieval.hybrid import HybridRetriever
from libs.rag.retrieval.keyword import BM25Index, KeywordRetriever, tokenize
from libs.rag.retrieval.models import RetrievedChunk, RetrievalResult
from libs.rag.retrieval.service import RetrievalService


class MockVectorStore:
    def __init__(self, data: Dict[str, Dict[str, Any]]):
        self._data = data

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[VectorSearchResult]:
        results = []
        for cid, entry in self._data.items():
            score = sum(a * b for a, b in zip(query_embedding, entry["embedding"]))
            results.append(VectorSearchResult(
                chunk_id=cid,
                score=score,
                metadata=entry.get("metadata", {}),
                text=entry.get("text"),
            ))
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]

    def add(self, *args, **kwargs):
        return 0

    def delete(self, *args, **kwargs):
        return 0

    def count(self):
        return len(self._data)

    def collection_exists(self):
        return True


CORPUS = [
    ("chunk-1", "Kubernetes pod scheduling failures in production cluster"),
    ("chunk-2", "Resource fragmentation on cluster nodes causes pending pods"),
    ("chunk-3", "Python asyncio event loop best practices for web servers"),
    ("chunk-4", "Node affinity rules spread workloads across availability zones"),
]


class TestTokenize:
    def test_basic(self):
        assert tokenize("Hello World 123") == ["hello", "world", "123"]


class TestBM25Index:
    def test_search_returns_relevant(self):
        index = BM25Index(CORPUS)
        results = index.search("kubernetes pod scheduling", top_k=2)
        assert len(results) >= 1
        assert results[0][0] == "chunk-1"

    def test_empty_query(self):
        index = BM25Index(CORPUS)
        assert index.search("", top_k=5) == []


class TestKeywordRetriever:
    def test_retrieve(self):
        retriever = KeywordRetriever(CORPUS)
        result = retriever.retrieve("resource fragmentation nodes", top_k=2)
        assert result.retriever == "keyword"
        assert len(result.chunks) >= 1
        assert result.chunks[0].chunk_id == "chunk-2"


class TestDenseRetriever:
    def test_retrieve(self):
        mock_store = MockVectorStore({
            "chunk-1": {
                "embedding": [1.0, 0.0, 0.0],
                "text": "kubernetes scheduling",
            },
            "chunk-2": {
                "embedding": [0.0, 1.0, 0.0],
                "text": "python asyncio",
            },
        })
        service = MagicMock(spec=IndexingService)
        service.search.return_value = mock_store.search([1.0, 0.0, 0.0], top_k=2)

        retriever = DenseRetriever(service)
        result = retriever.retrieve("kubernetes", top_k=2)
        assert result.retriever == "dense"
        assert len(result.chunks) == 2
        assert result.chunks[0].retriever == "dense"


class TestHybridRetriever:
    def test_fusion(self):
        mock_store = MockVectorStore({
            "chunk-1": {"embedding": [1.0, 0.0], "text": "kubernetes scheduling"},
            "chunk-2": {"embedding": [0.0, 1.0], "text": "resource fragmentation"},
        })
        service = MagicMock(spec=IndexingService)
        service.search.side_effect = lambda **kwargs: mock_store.search(
            [1.0, 0.0], top_k=kwargs.get("top_k", 5)
        )

        dense = DenseRetriever(service)
        keyword = KeywordRetriever(CORPUS)
        hybrid = HybridRetriever(dense, keyword)

        result = hybrid.retrieve("kubernetes scheduling", top_k=3)
        assert result.retriever == "hybrid"
        assert len(result.chunks) >= 1


class TestRetrievalService:
    def test_modes(self):
        service_mock = MagicMock(spec=IndexingService)
        service_mock.search.return_value = [
            VectorSearchResult(chunk_id="chunk-1", score=0.9, text="kubernetes"),
        ]
        svc = RetrievalService(service_mock, chunk_corpus=CORPUS)

        dense = svc.retrieve("kubernetes", mode="dense", top_k=1)
        assert dense.retriever == "dense"

        keyword = svc.retrieve("kubernetes", mode="keyword", top_k=1)
        assert keyword.retriever == "keyword"

        hybrid = svc.retrieve("kubernetes", mode="hybrid", top_k=1)
        assert hybrid.retriever == "hybrid"


class TestRetrievalMetrics:
    def test_recall_precision_mrr_ndcg(self):
        relevant = {"a", "b"}
        retrieved = ["a", "c", "b", "d"]

        assert recall_at_k(retrieved, relevant, 3) == 1.0
        assert precision_at_k(retrieved, relevant, 3) == pytest.approx(2 / 3)
        assert mrr(retrieved, relevant) == 1.0
        assert ndcg_at_k(retrieved, relevant, 3) > 0.9

    def test_empty_relevant(self):
        assert recall_at_k(["a"], set(), 1) == 0.0
        assert ndcg_at_k(["a"], set(), 1) == 0.0


class TestRetrievalBenchmark:
    def _make_mock_indexing_service(self):
        embeddings = {
            "chunk-1": [1.0, 0.0, 0.0],
            "chunk-2": [0.8, 0.2, 0.0],
            "chunk-3": [0.0, 1.0, 0.0],
            "chunk-4": [0.7, 0.3, 0.0],
        }
        texts = {cid: text for cid, text in CORPUS}

        store_data = {
            cid: {"embedding": emb, "text": texts[cid]}
            for cid, emb in embeddings.items()
        }
        mock_store = MockVectorStore(store_data)

        service = MagicMock(spec=IndexingService)

        def mock_search(query, top_k=10, filter_metadata=None):
            if "kubernetes" in query.lower() or "scheduling" in query.lower():
                q_emb = [1.0, 0.0, 0.0]
            elif "fragmentation" in query.lower():
                q_emb = [0.8, 0.2, 0.0]
            else:
                q_emb = [0.5, 0.5, 0.0]
            return mock_store.search(q_emb, top_k=top_k)

        service.search.side_effect = mock_search
        return service

    def test_benchmark_comparison(self):
        dataset = EvaluationDataset(
            name="test_retrieval",
            samples=[
                EvaluationSample(
                    question="What causes kubernetes pod scheduling failures?",
                    ground_truth="Resource fragmentation",
                    reference_context=["Kubernetes pod scheduling failures"],
                ),
                EvaluationSample(
                    question="What causes resource fragmentation on nodes?",
                    ground_truth="Fragmented CPU and memory",
                    reference_context=["Resource fragmentation on cluster nodes"],
                ),
            ],
        )

        service = self._make_mock_indexing_service()
        retrieval_svc = RetrievalService(service, chunk_corpus=CORPUS)

        benchmark = RetrievalBenchmark(dataset, corpus=CORPUS)
        results = benchmark.compare_retrievers(
            {
                "dense": lambda q, k: retrieval_svc.retrieve(q, mode="dense", top_k=k),
                "keyword": lambda q, k: retrieval_svc.retrieve(q, mode="keyword", top_k=k),
                "hybrid": lambda q, k: retrieval_svc.retrieve(q, mode="hybrid", top_k=k),
            },
            top_k=3,
        )

        assert len(results) == 3
        for name, result in results.items():
            assert result.num_queries == 2
            assert result.avg_mrr >= 0.0

        table = benchmark.comparison_table(results)
        assert "dense" in table
        assert "keyword" in table
        assert "hybrid" in table
