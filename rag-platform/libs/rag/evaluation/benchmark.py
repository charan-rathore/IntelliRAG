"""Chunking strategy benchmark runner.

This module provides tools to systematically compare chunking strategies
using evaluation datasets and RAGAS metrics.

Instead of guessing which chunking strategy is better, run benchmarks:

    benchmark = ChunkingBenchmark(dataset)
    results = benchmark.run_comparison(
        strategies=["recursive", "structure_aware"],
        chunk_sizes=[256, 512, 1024],
        overlaps=[25, 50, 100],
    )
    
    print(results.to_summary_table())
    # Shows which strategy + config combination performs best
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple
from uuid import uuid4

from libs.shared.models.chunk import ChunkMetadata, ChunkingResult
from libs.shared.models.lifecycle import IngestionSource

from ..chunking.base import ChunkerConfig
from ..chunking.factory import get_chunker_for_strategy
from .models import (
    ChunkingEvalResult,
    EvaluationDataset,
    EvaluationSample,
    StrategyComparison,
)
from .ragas_wrapper import RagasConfig, RagasEvaluator

logger = logging.getLogger(__name__)


@dataclass
class BenchmarkConfig:
    """Configuration for benchmark runs.
    
    Attributes:
        strategies: List of chunking strategy names to compare.
        chunk_sizes: List of chunk sizes (in tokens) to test.
        overlaps: List of overlap sizes (in tokens) to test.
        top_k: Number of chunks to retrieve per query.
        ragas_config: Configuration for RAGAS evaluator.
    """
    strategies: List[str]
    chunk_sizes: List[int] = None
    overlaps: List[int] = None
    top_k: int = 5
    ragas_config: Optional[RagasConfig] = None
    
    def __post_init__(self):
        if self.chunk_sizes is None:
            self.chunk_sizes = [256, 512, 1024]
        if self.overlaps is None:
            self.overlaps = [25, 50, 100]


class SimpleRetriever:
    """Simple retriever using lexical similarity for benchmarking.
    
    This is a baseline retriever for testing chunking quality.
    In production, replace with your actual embedding-based retriever.
    """
    
    def __init__(self, chunks: List[Tuple[str, str]]) -> None:
        """Initialize with chunks.
        
        Args:
            chunks: List of (chunk_id, chunk_text) tuples.
        """
        self.chunks = chunks
    
    def retrieve(self, query: str, top_k: int = 5) -> List[str]:
        """Retrieve top-k chunks by lexical similarity.
        
        Args:
            query: Query string.
            top_k: Number of chunks to return.
        
        Returns:
            List of chunk texts.
        """
        query_words = set(query.lower().split())
        
        scored = []
        for chunk_id, chunk_text in self.chunks:
            chunk_words = set(chunk_text.lower().split())
            
            if not chunk_words:
                continue
            
            overlap = len(query_words & chunk_words)
            jaccard = overlap / len(query_words | chunk_words) if (query_words | chunk_words) else 0
            
            scored.append((jaccard, chunk_text))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        
        return [text for _, text in scored[:top_k]]


class EmbeddingRetriever:
    """Embedding-based retriever for more accurate benchmarking.
    
    Uses sentence embeddings for semantic similarity search.
    Requires sentence-transformers library.
    """
    
    def __init__(
        self,
        chunks: List[Tuple[str, str]],
        model_name: str = "all-MiniLM-L6-v2",
    ) -> None:
        """Initialize with chunks and embedding model.
        
        Args:
            chunks: List of (chunk_id, chunk_text) tuples.
            model_name: Sentence transformer model name.
        """
        self.chunks = chunks
        self._model = None
        self._embeddings = None
        self._model_name = model_name
        
        try:
            self._initialize_embeddings()
        except ImportError:
            logger.warning(
                "sentence-transformers not installed. "
                "Falling back to lexical retrieval."
            )
    
    def _initialize_embeddings(self) -> None:
        """Initialize embedding model and compute chunk embeddings."""
        from sentence_transformers import SentenceTransformer
        
        self._model = SentenceTransformer(self._model_name)
        
        texts = [text for _, text in self.chunks]
        self._embeddings = self._model.encode(texts, convert_to_numpy=True)
    
    def retrieve(self, query: str, top_k: int = 5) -> List[str]:
        """Retrieve top-k chunks by embedding similarity.
        
        Args:
            query: Query string.
            top_k: Number of chunks to return.
        
        Returns:
            List of chunk texts.
        """
        if self._model is None or self._embeddings is None:
            fallback = SimpleRetriever(self.chunks)
            return fallback.retrieve(query, top_k)
        
        import numpy as np
        
        query_embedding = self._model.encode([query], convert_to_numpy=True)
        
        similarities = np.dot(self._embeddings, query_embedding.T).flatten()
        
        top_indices = np.argsort(similarities)[-top_k:][::-1]
        
        return [self.chunks[i][1] for i in top_indices]


class ChunkingBenchmark:
    """Benchmark runner for comparing chunking strategies.
    
    Provides systematic evaluation of different chunking configurations
    to determine optimal settings for your use case.
    
    Example:
        dataset = EvaluationDataset.from_json("eval_data.json")
        benchmark = ChunkingBenchmark(dataset)
        
        # Compare strategies
        results = benchmark.run_comparison(
            strategies=["recursive", "structure_aware"],
            chunk_sizes=[256, 512, 1024],
        )
        
        print(results.to_summary_table())
        print(f"Best: {results.best_strategy}")
    """
    
    def __init__(
        self,
        dataset: EvaluationDataset,
        source_documents: Optional[Dict[str, str]] = None,
        ragas_config: Optional[RagasConfig] = None,
        use_embeddings: bool = False,
    ) -> None:
        """Initialize benchmark runner.
        
        Args:
            dataset: Evaluation dataset with questions and ground truths.
            source_documents: Map of document_id -> document text.
                If None, uses concatenated reference_context from samples.
            ragas_config: RAGAS configuration.
            use_embeddings: Whether to use embedding-based retrieval.
        """
        self.dataset = dataset
        self.source_documents = source_documents
        self.evaluator = RagasEvaluator(ragas_config)
        self.use_embeddings = use_embeddings
        
        if not source_documents:
            self._infer_source_documents()
    
    def _infer_source_documents(self) -> None:
        """Infer source documents from evaluation samples."""
        self.source_documents = {}
        
        for sample in self.dataset.samples:
            doc_id = sample.document_id or "default"
            if doc_id not in self.source_documents:
                self.source_documents[doc_id] = ""
            
            self.source_documents[doc_id] += "\n\n".join(sample.reference_context)
            self.source_documents[doc_id] += "\n\n"
    
    def run_single(
        self,
        strategy: str,
        chunk_size: int,
        chunk_overlap: int,
        top_k: int = 5,
    ) -> ChunkingEvalResult:
        """Run evaluation for a single chunking configuration.
        
        Args:
            strategy: Chunking strategy name.
            chunk_size: Chunk size in tokens.
            chunk_overlap: Overlap in tokens.
            top_k: Number of chunks to retrieve per query.
        
        Returns:
            Evaluation results for this configuration.
        """
        config = ChunkerConfig(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        chunker = get_chunker_for_strategy(strategy, config)
        
        start_time = time.time()
        all_chunks: List[Tuple[str, str]] = []
        
        base_metadata = ChunkMetadata(
            source_type=IngestionSource.MARKDOWN_DOC,
        )
        
        total_tokens = 0
        min_tokens = float("inf")
        max_tokens = 0
        
        for doc_id, doc_text in self.source_documents.items():
            if not doc_text.strip():
                continue
            
            document_id = uuid4()
            version_id = uuid4()
            
            try:
                result: ChunkingResult = chunker.chunk(
                    text=doc_text,
                    document_id=document_id,
                    version_id=version_id,
                    base_metadata=base_metadata,
                )
                
                for chunk in result.chunks:
                    all_chunks.append((str(chunk.chunk_id), chunk.chunk_text))
                    total_tokens += chunk.token_count
                    min_tokens = min(min_tokens, chunk.token_count)
                    max_tokens = max(max_tokens, chunk.token_count)
                    
            except Exception as e:
                logger.error(f"Chunking failed for doc {doc_id}: {e}")
        
        chunking_time = (time.time() - start_time) * 1000
        
        if not all_chunks:
            return ChunkingEvalResult(
                strategy_name=strategy,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                context_precision=0.0,
                context_recall=0.0,
                total_chunks=0,
            )
        
        if self.use_embeddings:
            retriever = EmbeddingRetriever(all_chunks)
        else:
            retriever = SimpleRetriever(all_chunks)
        
        questions = []
        retrieved_contexts = []
        ground_truths = []
        
        for sample in self.dataset.samples:
            questions.append(sample.question)
            ground_truths.append(sample.ground_truth)
            
            contexts = retriever.retrieve(sample.question, top_k=top_k)
            retrieved_contexts.append(contexts)
        
        eval_start = time.time()
        
        scores = self.evaluator.evaluate_retrieval(
            questions=questions,
            contexts=retrieved_contexts,
            ground_truths=ground_truths,
        )
        
        eval_time = (time.time() - eval_start) * 1000
        
        avg_tokens = total_tokens / len(all_chunks) if all_chunks else 0
        
        return ChunkingEvalResult(
            strategy_name=strategy,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            context_precision=scores.get("context_precision", 0.0),
            context_recall=scores.get("context_recall", 0.0),
            total_chunks=len(all_chunks),
            avg_chunk_tokens=avg_tokens,
            min_chunk_tokens=int(min_tokens) if min_tokens != float("inf") else 0,
            max_chunk_tokens=max_tokens,
            chunking_time_ms=chunking_time,
            evaluation_time_ms=eval_time,
        )
    
    def run_comparison(
        self,
        strategies: List[str] = None,
        chunk_sizes: List[int] = None,
        overlaps: List[int] = None,
        top_k: int = 5,
    ) -> StrategyComparison:
        """Compare multiple chunking strategies and configurations.
        
        Runs a grid search over strategies, chunk sizes, and overlaps
        to find the optimal configuration.
        
        Args:
            strategies: Strategies to compare. Defaults to all available.
            chunk_sizes: Chunk sizes to test. Defaults to [256, 512, 1024].
            overlaps: Overlap sizes to test. Defaults to [25, 50, 100].
            top_k: Number of chunks to retrieve.
        
        Returns:
            StrategyComparison with all results and best configuration.
        """
        if strategies is None:
            strategies = ["recursive", "structure_aware", "github_issue"]
        if chunk_sizes is None:
            chunk_sizes = [256, 512, 1024]
        if overlaps is None:
            overlaps = [25, 50, 100]
        
        results = []
        total_configs = len(strategies) * len(chunk_sizes) * len(overlaps)
        current = 0
        
        for strategy in strategies:
            for chunk_size in chunk_sizes:
                for overlap in overlaps:
                    if overlap >= chunk_size:
                        continue
                    
                    current += 1
                    logger.info(
                        f"[{current}/{total_configs}] Testing {strategy} "
                        f"(size={chunk_size}, overlap={overlap})"
                    )
                    
                    try:
                        result = self.run_single(
                            strategy=strategy,
                            chunk_size=chunk_size,
                            chunk_overlap=overlap,
                            top_k=top_k,
                        )
                        results.append(result)
                        
                        logger.info(
                            f"  -> Precision: {result.context_precision:.4f}, "
                            f"Recall: {result.context_recall:.4f}, "
                            f"F1: {result.combined_score:.4f}"
                        )
                        
                    except Exception as e:
                        logger.error(f"  -> Failed: {e}")
        
        return StrategyComparison(
            dataset_name=self.dataset.name,
            results=results,
        )
    
    def find_optimal_chunk_size(
        self,
        strategy: str,
        size_range: Tuple[int, int] = (128, 2048),
        step: int = 128,
        overlap_ratio: float = 0.1,
        top_k: int = 5,
    ) -> ChunkingEvalResult:
        """Find optimal chunk size for a given strategy.
        
        Sweeps through chunk sizes to find the inflection point
        on the precision-recall curve.
        
        Args:
            strategy: Chunking strategy to optimize.
            size_range: (min, max) chunk size range.
            step: Step size for chunk size sweep.
            overlap_ratio: Overlap as fraction of chunk size.
            top_k: Number of chunks to retrieve.
        
        Returns:
            Best ChunkingEvalResult found.
        """
        min_size, max_size = size_range
        
        results = []
        for chunk_size in range(min_size, max_size + 1, step):
            overlap = int(chunk_size * overlap_ratio)
            overlap = max(10, min(overlap, chunk_size - 10))
            
            result = self.run_single(
                strategy=strategy,
                chunk_size=chunk_size,
                chunk_overlap=overlap,
                top_k=top_k,
            )
            results.append(result)
            
            logger.info(
                f"Chunk size {chunk_size}: F1={result.combined_score:.4f}"
            )
        
        best = max(results, key=lambda r: r.combined_score)
        
        logger.info(
            f"Optimal chunk size for {strategy}: {best.chunk_size} "
            f"(F1={best.combined_score:.4f})"
        )
        
        return best


def quick_benchmark(
    documents: Dict[str, str],
    questions: List[str],
    ground_truths: List[str],
    strategies: List[str] = None,
) -> StrategyComparison:
    """Quick benchmark with minimal setup.
    
    Convenience function for quick strategy comparison.
    
    Args:
        documents: Map of document_id -> document text.
        questions: Evaluation questions.
        ground_truths: Expected answers.
        strategies: Strategies to compare.
    
    Returns:
        StrategyComparison results.
    
    Example:
        results = quick_benchmark(
            documents={"doc1": "Long document text..."},
            questions=["What is X?", "How does Y work?"],
            ground_truths=["X is...", "Y works by..."],
        )
        print(results.to_summary_table())
    """
    samples = [
        EvaluationSample(
            question=q,
            ground_truth=gt,
            reference_context=[gt],
        )
        for q, gt in zip(questions, ground_truths)
    ]
    
    dataset = EvaluationDataset(
        name="quick_benchmark",
        samples=samples,
    )
    
    benchmark = ChunkingBenchmark(
        dataset=dataset,
        source_documents=documents,
    )
    
    return benchmark.run_comparison(strategies=strategies)
