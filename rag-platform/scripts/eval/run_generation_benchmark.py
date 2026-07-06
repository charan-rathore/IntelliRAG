#!/usr/bin/env python3
"""Generation benchmark: citation-aware answers with faithfulness evaluation.

Evaluates:
- Faithfulness (claim-level grounding in cited sources)
- Citation precision and recall
- Hallucination rate
- Citation coverage
- Answer relevancy
- Prompt style comparison (citation_aware vs concise vs detailed)
- Optional RAGAS faithfulness when eval extras installed

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_generation_benchmark.py
    PYTHONPATH=rag-platform python scripts/eval/run_generation_benchmark.py --use-ollama
    PYTHONPATH=rag-platform python scripts/eval/run_generation_benchmark.py --compare-styles
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

EVAL_QUESTIONS = [
    (
        "What caused the Kubernetes pod scheduling failures?",
        "Resource fragmentation on cluster nodes prevented scheduling.",
        ["resource fragmentation", "Pending state"],
    ),
    (
        "How should you manage the Python asyncio event loop?",
        "Use asyncio.run() for top-level entry points in Python 3.7+.",
        ["asyncio.run()", "event loop"],
    ),
    (
        "What is the recommended approach for aiohttp connection pooling?",
        "Use aiohttp ClientSession as a context manager to reuse TCP connections.",
        ["ClientSession", "connection"],
    ),
]


def build_pipeline(persist_dir: str):
    from datetime import datetime, timezone
    from unittest.mock import MagicMock

    import numpy as np

    from libs.rag.chunking.service import ChunkingService
    from libs.rag.context.config import ContextAssemblyConfig
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
    assembly_svc = ContextAssemblyService(
        ContextAssemblyConfig(strategy="full", max_tokens=2048, max_chunks=5)
    )

    def context_fn(query: str):
        rerank_result = rerank_svc.retrieve_and_rerank(
            query=query,
            retrieval_mode="hybrid",
            top_k=5,
        )
        for chunk in rerank_result.chunks:
            if chunk.chunk_id in chunk_map:
                orig = chunk_map[chunk.chunk_id]
                chunk.metadata["document_id"] = orig.metadata.extra.get("document_id", "")
        return assembly_svc.assemble_from_rerank(rerank_result)

    return assembly_svc, context_fn


def build_dataset() -> "EvaluationDataset":
    from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample

    samples = [
        EvaluationSample(
            question=q,
            ground_truth=gt,
            reference_context=refs,
        )
        for q, gt, refs in EVAL_QUESTIONS
    ]
    return EvaluationDataset(name="generation-benchmark", samples=samples)


def parse_args():
    parser = argparse.ArgumentParser(description="Generation faithfulness benchmark")
    parser.add_argument(
        "--use-ollama",
        action="store_true",
        help="Use real Ollama for generation (default: mock LLM)",
    )
    parser.add_argument(
        "--model",
        default="llama3.2",
        help="Ollama model for generation",
    )
    parser.add_argument(
        "--ollama-url",
        default="http://localhost:11434",
        help="Ollama server URL",
    )
    parser.add_argument(
        "--compare-styles",
        action="store_true",
        help="Compare citation_aware vs concise vs detailed prompts",
    )
    parser.add_argument(
        "--use-llm-judge",
        action="store_true",
        help="Use Ollama LLM-as-judge for entailment (slower, more accurate)",
    )
    parser.add_argument(
        "--use-ragas",
        action="store_true",
        help="Also run RAGAS faithfulness metrics (requires eval extras)",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    from libs.rag.evaluation.faithfulness import FaithfulnessEvaluator
    from libs.rag.evaluation.generation_benchmark import GenerationBenchmark
    from libs.rag.generation.config import GenerationConfig
    from libs.rag.generation.ollama import MockLLMClient, OllamaClient
    from libs.rag.generation.service import GenerationService

    tmpdir = tempfile.mkdtemp(prefix="gen-bench-")
    try:
        _, context_fn = build_pipeline(tmpdir)
        dataset = build_dataset()

        config = GenerationConfig.for_ollama(model=args.model, base_url=args.ollama_url)

        if args.use_ollama:
            client = OllamaClient(config)
            if not client.is_available():
                logger.error("Ollama not available at %s", args.ollama_url)
                sys.exit(1)
            logger.info("Using Ollama model: %s", args.model)
        else:
            client = MockLLMClient()
            logger.info("Using mock LLM (pass --use-ollama for real generation)")

        gen_service = GenerationService(config=config, llm_client=client)
        faith_eval = FaithfulnessEvaluator(
            use_llm_judge=args.use_llm_judge,
            judge_config=config,
        )

        ragas_eval = None
        if args.use_ragas:
            try:
                from libs.rag.evaluation.ragas_wrapper import RagasConfig, RagasEvaluator

                ragas_eval = RagasEvaluator(
                    RagasConfig.for_ollama(model=args.model, base_url=args.ollama_url)
                )
            except Exception as e:
                logger.warning("RAGAS not available: %s", e)

        benchmark = GenerationBenchmark(gen_service, faith_eval, ragas_eval)

        if args.compare_styles:
            report = benchmark.compare_prompt_styles(dataset, context_fn)
            print("\n" + report.comparison_table())
            for result in report.results:
                print("\n" + result.to_summary())
        else:
            result = benchmark.run(dataset, context_fn)
            print("\n" + result.to_summary())

            print("\nPer-query results:")
            for q in result.per_query:
                print(
                    f"  Q: {q.question[:60]}... "
                    f"faith={q.faithfulness:.2f} "
                    f"cit_prec={q.citation_precision:.2f} "
                    f"halluc={q.hallucination_rate:.2f} "
                    f"refused={q.refused}"
                )

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
