"""Shared pipeline builder for evaluation scripts."""

from __future__ import annotations

import tempfile
from uuid import uuid4

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


def build_eval_pipeline(persist_dir: str | None = None):
    """Build a complete RAG pipeline for evaluation."""
    from datetime import datetime, timezone
    from unittest.mock import MagicMock

    import numpy as np

    from libs.rag.chunking.service import ChunkingService
    from libs.rag.context.config import ContextAssemblyConfig
    from libs.rag.context.service import ContextAssemblyService
    from libs.rag.evaluation.faithfulness import FaithfulnessEvaluator
    from libs.rag.evaluation.platform import PipelineHandles
    from libs.rag.indexing.chroma_store import ChromaVectorStore
    from libs.rag.indexing.service import IndexingConfig, IndexingService
    from libs.rag.reranking.cross_encoder import LexicalReranker
    from libs.rag.reranking.service import RerankingService
    from libs.rag.retrieval.service import RetrievalService
    from libs.shared.models.document import CanonicalDocument, DocumentMetadata, DocumentVersion
    from libs.shared.models.lifecycle import IngestionSource, IngestionState

    if persist_dir is None:
        persist_dir = tempfile.mkdtemp(prefix="eval-pipeline-")

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
        for c in chunks:
            c.metadata.extra["document_id"] = doc_id
        all_chunks.extend(chunks)

    config = IndexingConfig()
    store = ChromaVectorStore(
        persist_directory=persist_dir,
        embedding_dimensions=config.embedding_config.dimensions,
    )
    service = IndexingService(vector_store=store, config=config)
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
    context_svc = ContextAssemblyService(
        ContextAssemblyConfig(strategy="full", max_tokens=2048, max_chunks=5)
    )

    return PipelineHandles(
        retrieval_service=retrieval_svc,
        reranking_service=rerank_svc,
        context_service=context_svc,
        generation_service=None,
        faithfulness_evaluator=FaithfulnessEvaluator(use_llm_judge=False),
        corpus=corpus,
    )
