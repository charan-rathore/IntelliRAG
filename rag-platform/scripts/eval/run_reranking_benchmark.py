#!/usr/bin/env python3
"""Reranking benchmark: compare retrieval-only vs retrieve+rerank pipelines.

Evaluates:
- MRR/NDCG lift from reranking
- Ablation across dense, keyword, hybrid retrieval modes
- Latency overhead of reranking stage
- Top-1 change rate (how often reranking changes the best result)

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_reranking_benchmark.py
    PYTHONPATH=rag-platform python scripts/eval/run_reranking_benchmark.py --use-cross-encoder
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
import tempfile
from uuid import uuid4

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


SAMPLE_DOCS = {
    "k8s-incident": """\
# Kubernetes Pod Scheduling Failures

## Problem Description
We observed intermittent pod scheduling failures in the production cluster.

## Root Cause Analysis
The issue was traced to resource fragmentation on the cluster nodes.
While total cluster capacity was sufficient, individual nodes had
fragmented CPU and memory allocations that prevented scheduling.

## Resolution
We implemented resource quotas, pod priority classes, and node affinity rules.
""",
    "python-async": """\
# Python Asyncio Best Practices

## Event Loop Management
Always use asyncio.run() for top-level entry points in Python 3.7+.

## Connection Pooling
Use aiohttp ClientSession as a context manager to reuse TCP connections.

## Error Handling
Wrap coroutines in try/except and use asyncio.gather with return_exceptions=True.
""",
}


def build_services(use_cross_encoder: bool, persist_dir: str):
    from datetime import datetime, timezone
    from unittest.mock import MagicMock

    import numpy as np

    from libs.rag.chunking.service import ChunkingService
    from libs.rag.indexing.chroma_store import ChromaVectorStore
    from libs.rag.indexing.service import IndexingConfig, IndexingService
    from libs.rag.reranking.cross_encoder import CrossEncoderReranker, LexicalReranker
    from libs.rag.retrieval.service import RetrievalService
    from libs.shared.models.document import CanonicalDocument, DocumentMetadata, DocumentVersion
    from libs.shared.models.lifecycle import IngestionSource, IngestionState

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
    store = ChromaVectorStore(
        persist_directory=persist_dir,
        embedding_dimensions=config.embedding_config.dimensions,
    )
    service = IndexingService(vector_store=store, config=config)

    if not use_cross_encoder:
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

    rerankers = {"lexical": LexicalReranker()}
    if use_cross_encoder:
        try:
            rerankers["cross_encoder"] = CrossEncoderReranker()
            logger.info("Using cross-encoder/ms-marco-MiniLM-L-6-v2")
        except Exception as e:
            logger.warning(f"Cross-encoder unavailable: {e}. Using lexical only.")

    return retrieval_svc, rerankers, corpus


def main():
    from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
    from libs.rag.evaluation.reranking_benchmark import RerankingBenchmark
    from libs.rag.evaluation.retrieval_benchmark import RetrievalBenchmark

    parser = argparse.ArgumentParser(description="Run reranking benchmark")
    parser.add_argument(
        "--use-cross-encoder",
        action="store_true",
        help="Use sentence-transformers cross-encoder (downloads ~80MB model)",
    )
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--retrieve-top-n", type=int, default=20)
    args = parser.parse_args()

    persist_dir = tempfile.mkdtemp(prefix="rerank_bench_")
    try:
        retrieval_svc, rerankers, corpus = build_services(
            args.use_cross_encoder, persist_dir
        )

        dataset = EvaluationDataset(
            name="reranking_benchmark_v1",
            samples=[
                EvaluationSample(
                    question="What caused kubernetes pod scheduling failures?",
                    ground_truth="Resource fragmentation on cluster nodes",
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

        print("\n=== Retrieval Baselines (no reranking) ===\n")
        retrieval_bench = RetrievalBenchmark(dataset, corpus=corpus)
        baselines = retrieval_bench.compare_retrievers(
            {
                "dense": lambda q, k: retrieval_svc.retrieve(q, mode="dense", top_k=k),
                "keyword": lambda q, k: retrieval_svc.retrieve(q, mode="keyword", top_k=k),
                "hybrid": lambda q, k: retrieval_svc.retrieve(q, mode="hybrid", top_k=k),
            },
            top_k=args.top_k,
        )
        print(retrieval_bench.comparison_table(baselines))

        print("\n=== Reranking Pipelines (retrieve + rerank) ===\n")
        rerank_bench = RerankingBenchmark(dataset, corpus=corpus)
        report = rerank_bench.run_full_comparison(
            retrieval_service=retrieval_svc,
            rerankers=rerankers,
            retrieval_modes=["dense", "keyword", "hybrid"],
            top_k=args.top_k,
            retrieve_top_n=args.retrieve_top_n,
        )
        print(report.comparison_table())

        best = report.best_pipeline()
        if best:
            print(f"\nBest pipeline: {best.pipeline} (MRR={best.avg_mrr:.4f}, lift={best.mrr_lift:+.4f})")
            print()
            print(best.to_summary())

    finally:
        shutil.rmtree(persist_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
