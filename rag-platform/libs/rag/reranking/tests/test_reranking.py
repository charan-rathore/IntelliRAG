"""Tests for reranking layer."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.evaluation.reranking_benchmark import RerankingBenchmark
from libs.rag.indexing.vector_store import VectorSearchResult
from libs.rag.reranking.cross_encoder import LexicalReranker
from libs.rag.reranking.service import RerankingService
from libs.rag.retrieval.models import RetrievedChunk, RetrievalResult
from libs.rag.retrieval.service import RetrievalService


CORPUS = [
    ("chunk-1", "Kubernetes pod scheduling failures in production cluster"),
    ("chunk-2", "Resource fragmentation on cluster nodes causes pending pods"),
    ("chunk-3", "Python asyncio event loop best practices for web servers"),
    ("chunk-4", "Node affinity rules spread workloads across availability zones"),
]


class MockVectorStore:
    def __init__(self, data: Dict[str, Dict[str, Any]]):
        self._data = data

    def search(self, query_embedding, top_k=10, filter_metadata=None):
        results = []
        for cid, entry in self._data.items():
            score = sum(a * b for a, b in zip(query_embedding, entry["embedding"]))
            results.append(VectorSearchResult(
                chunk_id=cid, score=score, text=entry.get("text"), metadata={},
            ))
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]

    def add(self, *a, **k):
        return 0

    def delete(self, *a, **k):
        return 0

    def count(self):
        return len(self._data)

    def collection_exists(self):
        return True


def _make_retrieval_service():
    store_data = {
        "chunk-1": {"embedding": [1.0, 0.0], "text": CORPUS[0][1]},
        "chunk-2": {"embedding": [0.9, 0.1], "text": CORPUS[1][1]},
        "chunk-3": {"embedding": [0.0, 1.0], "text": CORPUS[2][1]},
        "chunk-4": {"embedding": [0.8, 0.2], "text": CORPUS[3][1]},
    }
    service = MagicMock()
    service.search.side_effect = lambda query, top_k=10, **kw: MockVectorStore(
        store_data
    ).search([1.0, 0.0], top_k=top_k)
    return RetrievalService(service, chunk_corpus=CORPUS)


class TestLexicalReranker:
    def test_rerank_promotes_relevant(self):
        reranker = LexicalReranker()
        candidates = [
            RetrievedChunk("chunk-3", CORPUS[2][1], 0.9, 1, "hybrid"),
            RetrievedChunk("chunk-2", CORPUS[1][1], 0.5, 2, "hybrid"),
            RetrievedChunk("chunk-1", CORPUS[0][1], 0.3, 3, "hybrid"),
        ]
        result = reranker.rerank(
            "resource fragmentation on cluster nodes",
            candidates,
            top_k=2,
        )
        assert result[0].chunk_id == "chunk-2"
        assert result[0].original_rank == 2
        assert result[0].rerank_score > result[1].rerank_score


class TestRerankingService:
    def test_retrieve_and_rerank(self):
        retrieval_svc = _make_retrieval_service()
        reranker = LexicalReranker()
        svc = RerankingService(retrieval_svc, reranker, retrieve_top_n=4)

        result = svc.retrieve_and_rerank(
            query="kubernetes pod scheduling",
            retrieval_mode="hybrid",
            top_k=2,
        )
        assert result.candidates_in >= 1
        assert result.candidates_out == 2
        assert result.total_latency_ms >= 0
        assert all(c.original_rank > 0 for c in result.chunks)


class TestRerankingBenchmark:
    def test_full_comparison(self):
        dataset = EvaluationDataset(
            name="rerank_test",
            samples=[
                EvaluationSample(
                    question="What causes kubernetes pod scheduling failures?",
                    ground_truth="Resource fragmentation",
                    reference_context=["resource fragmentation on cluster nodes"],
                ),
                EvaluationSample(
                    question="How should you manage asyncio event loops?",
                    ground_truth="Use asyncio.run()",
                    reference_context=["asyncio event loop best practices"],
                ),
            ],
        )

        retrieval_svc = _make_retrieval_service()
        benchmark = RerankingBenchmark(dataset, corpus=CORPUS)

        report = benchmark.run_full_comparison(
            retrieval_service=retrieval_svc,
            rerankers={"lexical": LexicalReranker()},
            retrieval_modes=["hybrid", "keyword"],
            top_k=3,
            retrieve_top_n=4,
        )

        assert len(report.results) == 2
        table = report.comparison_table()
        assert "hybrid+lexical" in table
        assert report.best_pipeline() is not None
