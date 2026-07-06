#!/usr/bin/env python3
"""Retrieval benchmark: compare dense, keyword, and hybrid retrievers.

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_retrieval_benchmark.py
    PYTHONPATH=rag-platform python scripts/eval/run_retrieval_benchmark.py --use-ollama
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
import tempfile
from uuid import uuid4

from libs.rag.chunking.service import ChunkingService
from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.evaluation.retrieval_benchmark import RetrievalBenchmark
from libs.rag.indexing.chroma_store import ChromaVectorStore
from libs.rag.indexing.service import IndexingConfig, IndexingService
from libs.rag.retrieval.service import RetrievalService
from libs.shared.models.lifecycle import IngestionSource

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


EVAL_QUESTIONS = [
    EvaluationSample(
        question="What caused kubernetes pod scheduling failures?",
        ground_truth="Resource fragmentation on cluster nodes",
        reference_context=["resource fragmentation on the cluster nodes"],
        document_id="k8s-incident",
    ),
    EvaluationSample(
        question="How were pod scheduling failures resolved?",
        ground_truth="Resource quotas, priority classes, and node affinity",
        reference_context=["resource quotas, pod priority classes, and node affinity"],
        document_id="k8s-incident",
    ),
    EvaluationSample(
        question="How should you manage asyncio event loops?",
        ground_truth="Use asyncio.run() for top-level entry points",
        reference_context=["Always use asyncio.run() for top-level entry points"],
        document_id="python-async",
    ),
    EvaluationSample(
        question="What is the best practice for aiohttp connections?",
        ground_truth="Use ClientSession as a context manager",
        reference_context=["Use aiohttp ClientSession as a context manager"],
        document_id="python-async",
    ),
]


def build_index(use_ollama: bool, persist_dir: str):
    """Chunk documents, index them, and return retrieval service + corpus."""
    from datetime import datetime, timezone

    from libs.shared.models.document import CanonicalDocument, DocumentMetadata, DocumentVersion
    from libs.shared.models.lifecycle import IngestionState

    chunking_service = ChunkingService()
    all_chunks = []

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
        all_chunks.extend(chunks)

    config = IndexingConfig()
    if not use_ollama:
        from unittest.mock import MagicMock
        import numpy as np

        mock_embedder = MagicMock()
        dim = config.embedding_config.dimensions

        def mock_embed_batch(texts, **kwargs):
            rng = np.random.RandomState(42)
            return rng.randn(len(texts), dim).astype(np.float32)

        def mock_embed_query(text):
            rng = np.random.RandomState(hash(text) % 2**31)
            return rng.randn(dim).astype(np.float32)

        store = ChromaVectorStore(
            persist_directory=persist_dir,
            embedding_dimensions=dim,
        )
        service = IndexingService(vector_store=store, config=config)
        service._embedder = MagicMock()
        service._embedder.embed_batch.side_effect = mock_embed_batch
        service._embedder.embed_query.side_effect = mock_embed_query
    else:
        store = ChromaVectorStore(
            persist_directory=persist_dir,
            embedding_dimensions=config.embedding_config.dimensions,
        )
        service = IndexingService(vector_store=store, config=config)

    doc_id = all_chunks[0].document_id if all_chunks else uuid4()
    ver_id = all_chunks[0].version_id if all_chunks else uuid4()

    for chunk in all_chunks:
        chunk.document_id = doc_id
        chunk.version_id = ver_id

    result = service.index_document_chunks(
        chunks=all_chunks,
        document_id=doc_id,
        version_id=ver_id,
        delete_old_vectors=False,
    )
    if not result.success:
        raise RuntimeError(f"Indexing failed: {result.error_message}")

    corpus = [(str(c.chunk_id), c.chunk_text) for c in all_chunks]
    retrieval_svc = RetrievalService(service, chunk_corpus=corpus)
    return retrieval_svc, corpus


def main():
    parser = argparse.ArgumentParser(description="Run retrieval benchmark")
    parser.add_argument("--use-ollama", action="store_true", help="Use real Ollama embeddings")
    parser.add_argument("--top-k", type=int, default=5, help="Top-k for retrieval")
    args = parser.parse_args()

    persist_dir = tempfile.mkdtemp(prefix="retrieval_bench_")
    try:
        retrieval_svc, corpus = build_index(args.use_ollama, persist_dir)

        dataset = EvaluationDataset(
            name="retrieval_benchmark_v1",
            description="Built-in sample docs for retrieval evaluation",
            samples=EVAL_QUESTIONS,
        )

        benchmark = RetrievalBenchmark(dataset, corpus=corpus)
        results = benchmark.compare_retrievers(
            {
                "dense": lambda q, k: retrieval_svc.retrieve(q, mode="dense", top_k=k),
                "keyword": lambda q, k: retrieval_svc.retrieve(q, mode="keyword", top_k=k),
                "hybrid": lambda q, k: retrieval_svc.retrieve(q, mode="hybrid", top_k=k),
            },
            top_k=args.top_k,
        )

        print()
        print(benchmark.comparison_table(results))
        print()

        best = max(results.values(), key=lambda r: r.avg_mrr)
        print(f"Best retriever by MRR: {best.retriever} (MRR={best.avg_mrr:.4f})")

        for name, result in results.items():
            print()
            print(result.to_summary())

    finally:
        shutil.rmtree(persist_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
