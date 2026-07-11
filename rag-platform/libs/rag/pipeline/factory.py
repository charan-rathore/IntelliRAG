"""Production and evaluation pipeline factory."""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from libs.rag.chunking.service import ChunkingService
from libs.rag.context.config import ContextAssemblyConfig
from libs.rag.context.service import ContextAssemblyService
from libs.rag.embeddings.embedder import Embedder
from libs.rag.evaluation.faithfulness import FaithfulnessEvaluator
from libs.rag.evaluation.platform import PipelineHandles
from libs.rag.indexing.chroma_store import ChromaVectorStore
from libs.rag.indexing.service import IndexingConfig, IndexingService
from libs.observability import ObservedRAGPipeline, ObservabilityCollector
from libs.rag.pipeline.embedders import TfidfEmbedder
from libs.rag.reranking.cross_encoder import LexicalReranker
from libs.rag.reranking.pass_through import PassThroughReranker
from libs.rag.reranking.service import RerankingService
from libs.rag.retrieval.service import RetrievalService, RetrieverMode
from libs.shared.models.document import CanonicalDocument, DocumentMetadata, DocumentVersion
from libs.shared.models.lifecycle import IngestionSource, IngestionState

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


@dataclass
class PipelineBuildConfig:
    persist_dir: Optional[str] = None
    use_ollama_embeddings: bool = False
    ollama_base_url: str = "http://localhost:11434"
    collection_name: str = "rag_chunks"
    context_strategy: str = "full"
    context_max_tokens: int = 2048
    context_max_chunks: int = 5
    retrieve_top_n: int = 20
    default_retrieval_mode: RetrieverMode = "hybrid"
    reranker_type: str = "lexical"  # lexical | pass_through | cross_encoder


@dataclass
class BuiltPipeline:
    handles: PipelineHandles
    observed: ObservedRAGPipeline
    persist_dir: str
    chunk_doc_ids: Dict[str, str] = field(default_factory=dict)

    @property
    def corpus(self) -> List[Tuple[str, str]]:
        return self.handles.corpus


class PipelineFactory:
    """Build indexed RAG pipelines shared by API and evaluation."""

    @classmethod
    def build(cls, config: Optional[PipelineBuildConfig] = None) -> BuiltPipeline:
        cfg = config or PipelineBuildConfig()
        persist_dir = cfg.persist_dir or tempfile.mkdtemp(prefix="rag-pipeline-")
        os.makedirs(persist_dir, exist_ok=True)

        chunking_service = ChunkingService()
        all_chunks = []
        chunk_doc_ids: Dict[str, str] = {}

        for doc_key, text in SAMPLE_DOCS.items():
            document_id = uuid4()
            version_id = uuid4()
            now = datetime.now(timezone.utc)
            document = CanonicalDocument(
                document_id=document_id,
                external_id=doc_key,
                title=doc_key,
                metadata=DocumentMetadata(
                    source_type=IngestionSource.MARKDOWN_DOC,
                    source_uri=f"file://{doc_key}",
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
            for chunk in chunks:
                chunk.metadata.extra["source_doc_id"] = doc_key
                chunk_doc_ids[str(chunk.chunk_id)] = doc_key
            all_chunks.extend(chunks)

        indexing_config = IndexingConfig()
        store = ChromaVectorStore(
            persist_directory=persist_dir,
            embedding_dimensions=indexing_config.embedding_config.dimensions,
        )
        service = IndexingService(vector_store=store, config=indexing_config)

        corpus_texts = [c.chunk_text for c in all_chunks]
        embedder = cls._create_embedder(cfg, corpus_texts, indexing_config)
        service._embedder = embedder

        indexed_by_doc: Dict[str, List] = {}
        for chunk in all_chunks:
            source_key = chunk.metadata.extra.get("source_doc_id", "unknown")
            indexed_by_doc.setdefault(source_key, []).append(chunk)

        for source_key, doc_chunks in indexed_by_doc.items():
            doc_id = doc_chunks[0].document_id
            ver_id = doc_chunks[0].version_id
            service.index_document_chunks(
                chunks=doc_chunks,
                document_id=doc_id,
                version_id=ver_id,
                delete_old_vectors=False,
            )
            logger.info(
                "Indexed %d chunks for source=%s document=%s",
                len(doc_chunks),
                source_key,
                doc_id,
            )

        corpus = [(str(c.chunk_id), c.chunk_text) for c in all_chunks]
        chunk_metadata = {
            str(c.chunk_id): {"source_doc_id": chunk_doc_ids[str(c.chunk_id)]}
            for c in all_chunks
        }
        retrieval_svc = RetrievalService(
            service, chunk_corpus=corpus, chunk_metadata=chunk_metadata
        )
        reranker = cls._create_reranker(cfg.reranker_type)
        rerank_svc = RerankingService(
            retrieval_svc, reranker, retrieve_top_n=cfg.retrieve_top_n
        )
        context_svc = ContextAssemblyService(
            ContextAssemblyConfig(
                strategy=cfg.context_strategy,
                max_tokens=cfg.context_max_tokens,
                max_chunks=cfg.context_max_chunks,
            )
        )
        faithfulness = FaithfulnessEvaluator(use_llm_judge=False)
        collector = ObservabilityCollector()

        handles = PipelineHandles(
            retrieval_service=retrieval_svc,
            reranking_service=rerank_svc,
            context_service=context_svc,
            generation_service=None,
            faithfulness_evaluator=faithfulness,
            corpus=corpus,
            chunk_doc_ids=chunk_doc_ids,
        )

        observed = ObservedRAGPipeline(
            retrieval_service=retrieval_svc,
            reranking_service=rerank_svc,
            context_service=context_svc,
            generation_service=None,  # set by caller
            faithfulness_evaluator=faithfulness,
            collector=collector,
        )

        return BuiltPipeline(
            handles=handles,
            observed=observed,
            persist_dir=persist_dir,
            chunk_doc_ids=chunk_doc_ids,
        )

    @staticmethod
    def _create_embedder(cfg: PipelineBuildConfig, corpus_texts: List[str], indexing_config: IndexingConfig):
        if cfg.use_ollama_embeddings:
            try:
                embedder = Embedder(indexing_config.embedding_config)
                embedder._initialize()
                logger.info("Using Ollama embeddings: %s", indexing_config.embedding_config.model_name)
                return embedder
            except Exception as exc:
                logger.warning("Ollama embeddings unavailable (%s), falling back to TF-IDF", exc)

        tfidf = TfidfEmbedder(dimensions=indexing_config.embedding_config.dimensions)
        tfidf.fit(corpus_texts)
        logger.info("Using TF-IDF content-aware embeddings (%d dims)", tfidf.dimensions)
        return tfidf

    @staticmethod
    def _create_reranker(reranker_type: str):
        if reranker_type == "pass_through":
            return PassThroughReranker()
        if reranker_type == "cross_encoder":
            from libs.rag.reranking.cross_encoder import CrossEncoderReranker

            return CrossEncoderReranker()
        return LexicalReranker()
