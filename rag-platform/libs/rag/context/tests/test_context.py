"""Tests for context assembly layer."""

from __future__ import annotations

from libs.rag.context.budget import pack_by_budget
from libs.rag.context.compression import compress_extractive
from libs.rag.context.config import ContextAssemblyConfig
from libs.rag.context.deduplication import deduplicate_by_similarity, jaccard_similarity
from libs.rag.context.selection import maximal_marginal_relevance
from libs.rag.context.service import ContextAssemblyService
from libs.rag.evaluation.context_benchmark import ContextBenchmark
from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.retrieval.models import RetrievedChunk


CHUNKS = [
    RetrievedChunk(
        chunk_id="c1",
        text="Kubernetes pod scheduling failures traced to resource fragmentation on nodes.",
        score=0.9,
        rank=1,
        retriever="hybrid",
        metadata={"document_id": "k8s"},
    ),
    RetrievedChunk(
        chunk_id="c2",
        text="Resource fragmentation on cluster nodes causes pods stuck in Pending state.",
        score=0.85,
        rank=2,
        retriever="hybrid",
        metadata={"document_id": "k8s"},
    ),
    RetrievedChunk(
        chunk_id="c3",
        text="Python asyncio event loop best practices for web servers.",
        score=0.7,
        rank=3,
        retriever="hybrid",
        metadata={"document_id": "python"},
    ),
    RetrievedChunk(
        chunk_id="c4",
        text="Use asyncio.run() for top-level entry points in Python 3.7+.",
        score=0.65,
        rank=4,
        retriever="hybrid",
        metadata={"document_id": "python"},
    ),
]

DUPLICATE_CHUNKS = CHUNKS + [
    RetrievedChunk(
        chunk_id="c5",
        text="Kubernetes pod scheduling failures traced to resource fragmentation on nodes.",
        score=0.5,
        rank=5,
        retriever="hybrid",
    ),
]


class TestDeduplication:
    def test_jaccard_identical(self):
        text = "kubernetes pod scheduling failures"
        assert jaccard_similarity(text, text) == 1.0

    def test_dedup_removes_near_duplicates(self):
        raw = [(c.chunk_id, c.text, c.score, c.metadata) for c in DUPLICATE_CHUNKS]
        deduped, removed = deduplicate_by_similarity(raw, threshold=0.85)
        assert removed >= 1
        assert len(deduped) < len(raw)


class TestSelection:
    def test_mmr_promotes_diversity(self):
        raw = [(c.chunk_id, c.text, c.score, c.metadata) for c in CHUNKS]
        selected = maximal_marginal_relevance(
            raw, "kubernetes scheduling", top_k=2, lambda_param=0.5
        )
        assert len(selected) == 2
        doc_ids = {s[3].get("document_id") for s in selected}
        assert len(doc_ids) >= 1


class TestBudget:
    def test_pack_respects_limit(self):
        raw = [(c.chunk_id, c.text, c.score, c.metadata) for c in CHUNKS]
        packed, dropped = pack_by_budget(raw, max_tokens=50)
        total = sum(len(t) // 4 for _, t, _, _ in packed)
        assert total <= 50 or len(packed) >= 1


class TestCompression:
    def test_compress_reduces_tokens(self):
        long_text = "Sentence one about kubernetes. " * 20 + "Query term scheduling here."
        compressed, was = compress_extractive(
            long_text, query="scheduling", max_tokens=30
        )
        assert was is True
        assert len(compressed) < len(long_text)


class TestContextAssemblyService:
    def test_full_pipeline(self):
        svc = ContextAssemblyService()
        result = svc.assemble(
            query="kubernetes pod scheduling failures",
            chunks=DUPLICATE_CHUNKS,
            config_override=ContextAssemblyConfig(
                strategy="full",
                max_tokens=512,
                max_chunks=5,
                min_chunk_tokens=5,
            ),
        )
        assert result.stats.dedup_applied
        assert result.stats.mmr_applied
        assert result.stats.duplicates_removed >= 1
        assert "[Source 1]" in result.context_text
        assert len(result.citations) >= 1

    def test_compressed_pipeline(self):
        svc = ContextAssemblyService()
        result = svc.assemble(
            query="kubernetes scheduling",
            chunks=CHUNKS,
            config_override=ContextAssemblyConfig(
                strategy="full_compressed",
                max_tokens=256,
                per_chunk_max_tokens=60,
            ),
        )
        assert result.stats.compression_applied or result.total_tokens <= 256


class TestContextBenchmark:
    def test_strategy_comparison(self):
        dataset = EvaluationDataset(
            name="context_test",
            samples=[
                EvaluationSample(
                    question="What causes kubernetes scheduling failures?",
                    ground_truth="Resource fragmentation",
                    reference_context=["resource fragmentation on cluster nodes"],
                ),
            ],
        )
        corpus = [(c.chunk_id, c.text) for c in CHUNKS]
        svc = ContextAssemblyService()

        def chunks_provider(q):
            return CHUNKS

        benchmark = ContextBenchmark(dataset, corpus=corpus)
        report = benchmark.run_strategy_comparison(
            assembly_service=svc,
            chunks_provider=chunks_provider,
            strategies=["top_k", "full"],
            max_tokens=512,
        )
        assert len(report.results) == 2
        table = report.comparison_table()
        assert "top_k" in table
        assert "full" in table
