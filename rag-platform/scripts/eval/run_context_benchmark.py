#!/usr/bin/env python3
"""Context assembly benchmark: compare dedup, MMR, budget, and compression strategies.

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_context_benchmark.py
    PYTHONPATH=rag-platform python scripts/eval/run_context_benchmark.py --budget-sweep
"""

from __future__ import annotations

import argparse
import logging
import shutil
import tempfile
from uuid import uuid4

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


SAMPLE_DOCS = {
    "k8s-incident": """\
# Kubernetes Pod Scheduling Failures

## Problem Description
We observed intermittent pod scheduling failures in the production cluster.
Pods were getting stuck in Pending state for 10-15 minutes during peak hours.

## Root Cause Analysis
The issue was traced to resource fragmentation on the cluster nodes.
While total cluster capacity was sufficient, individual nodes had
fragmented CPU and memory allocations that prevented scheduling.

### Key Findings
1. Node A had 2 CPUs free but only 512Mi memory
2. Node B had 4Gi memory free but only 0.5 CPU
3. Pod requests: 1 CPU + 2Gi memory, no single node could satisfy this

## Resolution
We implemented resource quotas, pod priority classes, and node affinity rules.
Repeated analysis confirmed resource fragmentation as the root cause.
""",
    "python-async": """\
# Python Asyncio Best Practices

## Event Loop Management
Always use asyncio.run() for top-level entry points in Python 3.7+.
Avoid creating multiple event loops in the same thread.

## Connection Pooling
Use aiohttp ClientSession as a context manager to reuse TCP connections.
Set appropriate timeouts to prevent hung coroutines.

## Error Handling
Wrap coroutines in try/except and use asyncio.gather with return_exceptions=True
for concurrent tasks that should not fail together.
""",
}


def build_pipeline(persist_dir: str):
    from datetime import datetime, timezone
    from unittest.mock import MagicMock

    import numpy as np

    from libs.rag.chunking.service import ChunkingService
    from libs.rag.context.service import ContextAssemblyService
    from libs.rag.indexing.chroma_store import ChromaVectorStore
    from libs.rag.indexing.service import IndexingConfig, IndexingService
    from libs.rag.reranking.cross_encoder import LexicalReranker
    from libs.rag.reranking.service import RerankingService
    from libs.rag.retrieval.service import RetrievalService
    from libs.shared.models.document import CanonicalDocument, DocumentMetadata, DocumentVersion
    from libs.shared.models.lifecycle import IngestionSource, IngestionState

    chunking_service = ChunkingService()
    all_chunks = []
    chunk_map = {}

    for doc_id, text in SAMPLE_DOCS.items():
        document_id = uuid4()
        version_id = uuid4()
        now = datetime.now(timezone.utc)
        document = CanonicalDocument(
            document_id=document_id,
            external_id=doc_id,
            title=doc_id,
            metadata=DocumentMetadata(
                source_type=IngestionSource.MARKDOWN_DOC,
                source_uri=f"file://{doc_id}",
            ),
            hash_content="hash",
            created_at=now,
            updated_at=now,
            ingested_at=now,
            lifecycle_state=IngestionState.REGISTERED,
        )
        version = DocumentVersion(
            document_id=document_id,
            version_id=version_id,
            version_index=1,
            body_text=text,
            hash_payload="payload-hash",
            valid_from=now,
            is_active=True,
        )
        _, chunks = chunking_service.chunk_document(document, version)
        for c in chunks:
            c.metadata.extra["document_id"] = doc_id
            chunk_map[str(c.chunk_id)] = c
        all_chunks.extend(chunks)

    config = IndexingConfig()
    store = ChromaVectorStore(
        persist_directory=persist_dir,
        embedding_dimensions=config.embedding_config.dimensions,
    )
    service = IndexingService(vector_store=store, config=config)

    mock_embedder = MagicMock()
    dim = config.embedding_config.dimensions

    def mock_embed_batch(texts, **kwargs):
        rng = np.random.RandomState(42)
        return rng.randn(len(texts), dim).astype(np.float32)

    def mock_embed_query(text):
        rng = np.random.RandomState(hash(text) % 2**31)
        return rng.randn(dim).astype(np.float32)

    service._embedder = MagicMock()
    service._embedder.embed_batch.side_effect = mock_embed_batch
    service._embedder.embed_query.side_effect = mock_embed_query

    doc_id = all_chunks[0].document_id
    ver_id = all_chunks[0].version_id
    for chunk in all_chunks:
        chunk.document_id = doc_id
        chunk.version_id = ver_id

    service.index_document_chunks(
        chunks=all_chunks,
        document_id=doc_id,
        version_id=ver_id,
        delete_old_vectors=False,
    )

    corpus = [(str(c.chunk_id), c.chunk_text) for c in all_chunks]
    retrieval_svc = RetrievalService(service, chunk_corpus=corpus)
    rerank_svc = RerankingService(retrieval_svc, LexicalReranker(), retrieve_top_n=20)
    assembly_svc = ContextAssemblyService()

    def chunks_provider(query: str):
        rerank_result = rerank_svc.retrieve_and_rerank(
            query=query,
            retrieval_mode="hybrid",
            top_k=10,
        )
        for chunk in rerank_result.chunks:
            if chunk.chunk_id in chunk_map:
                orig = chunk_map[chunk.chunk_id]
                chunk.metadata["document_id"] = orig.metadata.extra.get("document_id", "")
        return rerank_result.chunks

    return assembly_svc, chunks_provider, corpus


def main():
    from libs.rag.evaluation.context_benchmark import ContextBenchmark
    from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample

    parser = argparse.ArgumentParser(description="Run context assembly benchmark")
    parser.add_argument("--max-tokens", type=int, default=1024)
    parser.add_argument("--budget-sweep", action="store_true")
    args = parser.parse_args()

    persist_dir = tempfile.mkdtemp(prefix="context_bench_")
    try:
        assembly_svc, chunks_provider, corpus = build_pipeline(persist_dir)

        dataset = EvaluationDataset(
            name="context_benchmark_v1",
            samples=[
                EvaluationSample(
                    question="What caused kubernetes pod scheduling failures?",
                    ground_truth="Resource fragmentation",
                    reference_context=["resource fragmentation on the cluster nodes"],
                    document_id="k8s-incident",
                ),
                EvaluationSample(
                    question="How were scheduling failures resolved?",
                    ground_truth="Resource quotas and node affinity",
                    reference_context=["resource quotas, pod priority classes, and node affinity"],
                    document_id="k8s-incident",
                ),
                EvaluationSample(
                    question="How should you manage asyncio event loops?",
                    ground_truth="Use asyncio.run()",
                    reference_context=["Always use asyncio.run() for top-level entry points"],
                    document_id="python-async",
                ),
                EvaluationSample(
                    question="What is the best practice for aiohttp connections?",
                    ground_truth="Use ClientSession as context manager",
                    reference_context=["Use aiohttp ClientSession as a context manager"],
                    document_id="python-async",
                ),
            ],
        )

        benchmark = ContextBenchmark(dataset, corpus=corpus)

        print("\n=== Context Assembly Strategy Comparison ===\n")
        report = benchmark.run_strategy_comparison(
            assembly_service=assembly_svc,
            chunks_provider=chunks_provider,
            max_tokens=args.max_tokens,
        )
        print(report.comparison_table())

        best = report.best_strategy()
        if best:
            print(f"\nBest strategy by token efficiency: {best.strategy}")
            print()
            print(best.to_summary())

        if args.budget_sweep:
            print("\n=== Budget Sweep (full strategy) ===\n")
            sweep = benchmark.run_budget_sweep(
                assembly_service=assembly_svc,
                chunks_provider=chunks_provider,
                budgets=[256, 512, 1024, 2048],
                strategy="full",
            )
            print(f"{'Budget':<10} {'Precision':<12} {'Recall':<10} {'Efficiency':<12}")
            print("-" * 48)
            for budget, result in sorted(sweep.items()):
                print(
                    f"{budget:<10} {result.avg_context_precision:<12.4f} "
                    f"{result.avg_context_recall:<10.4f} {result.avg_token_efficiency:<12.4f}"
                )

    finally:
        shutil.rmtree(persist_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
