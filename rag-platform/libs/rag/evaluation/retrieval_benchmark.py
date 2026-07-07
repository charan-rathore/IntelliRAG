"""Retrieval benchmark harness with standard IR metrics."""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, List, Optional, Set

from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.retrieval.models import RetrievalResult

logger = logging.getLogger(__name__)


@dataclass
class RetrievalEvalSample:
    """Ground truth for a single retrieval evaluation."""

    question: str
    relevant_chunk_ids: Set[str]
    relevant_texts: List[str] = field(default_factory=list)


@dataclass
class RetrievalEvalResult:
    """Metrics for a single query."""

    question: str
    retriever: str
    recall_at_k: float
    precision_at_k: float
    mrr: float
    ndcg_at_k: float
    top_k: int
    retrieved_ids: List[str] = field(default_factory=list)
    latency_ms: float = 0.0


@dataclass
class RetrievalBenchmarkResult:
    """Aggregated benchmark results across queries."""

    dataset_name: str
    retriever: str
    top_k: int
    num_queries: int
    avg_recall_at_k: float
    avg_precision_at_k: float
    avg_mrr: float
    avg_ndcg_at_k: float
    avg_latency_ms: float
    per_query: List[RetrievalEvalResult] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)

    def to_summary(self) -> str:
        lines = [
            f"Retrieval Benchmark: {self.dataset_name}",
            f"Retriever: {self.retriever} | top_k={self.top_k} | queries={self.num_queries}",
            "-" * 60,
            f"Recall@{self.top_k}:    {self.avg_recall_at_k:.4f}",
            f"Precision@{self.top_k}: {self.avg_precision_at_k:.4f}",
            f"MRR:           {self.avg_mrr:.4f}",
            f"NDCG@{self.top_k}:     {self.avg_ndcg_at_k:.4f}",
            f"Avg Latency:   {self.avg_latency_ms:.2f} ms",
        ]
        return "\n".join(lines)


def _is_relevant(chunk_id: str, text: str, sample: RetrievalEvalSample) -> bool:
    if chunk_id in sample.relevant_chunk_ids:
        return True
    text_lower = text.lower()
    for ref in sample.relevant_texts:
        ref_lower = ref.lower().strip()
        if ref_lower and (ref_lower in text_lower or text_lower in ref_lower):
            return True
    return False


def recall_at_k(retrieved_ids: List[str], relevant: Set[str], k: int) -> float:
    if not relevant:
        return 0.0
    hits = sum(1 for cid in retrieved_ids[:k] if cid in relevant)
    return hits / len(relevant)


def precision_at_k(retrieved_ids: List[str], relevant: Set[str], k: int) -> float:
    if k == 0:
        return 0.0
    hits = sum(1 for cid in retrieved_ids[:k] if cid in relevant)
    return hits / k


def mrr(retrieved_ids: List[str], relevant: Set[str]) -> float:
    for rank, cid in enumerate(retrieved_ids, start=1):
        if cid in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(
    retrieved_ids: List[str],
    relevant: Set[str],
    k: int,
) -> float:
    if not relevant:
        return 0.0

    dcg = 0.0
    for rank, cid in enumerate(retrieved_ids[:k], start=1):
        if cid in relevant:
            dcg += 1.0 / math.log2(rank + 1)

    ideal_hits = min(len(relevant), k)
    idcg = sum(1.0 / math.log2(i + 1) for i in range(1, ideal_hits + 1))
    return dcg / idcg if idcg > 0 else 0.0


class RetrievalBenchmark:
    """Benchmark runner for comparing retrieval strategies."""

    def __init__(
        self,
        dataset: EvaluationDataset,
        corpus: Optional[List[tuple[str, str]]] = None,
        chunk_doc_ids: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        Args:
            dataset: Evaluation dataset with questions and reference contexts.
            corpus: Optional full (chunk_id, text) corpus for recall computation.
            chunk_doc_ids: Optional chunk_id -> source document id mapping.
        """
        self.dataset = dataset
        self.corpus = corpus or []
        self.chunk_doc_ids = chunk_doc_ids or {}

    def _resolve_relevant_ids(
        self,
        sample: RetrievalEvalSample,
        document_id: Optional[str] = None,
    ) -> Set[str]:
        """Determine ground-truth relevant chunk IDs from corpus and references."""
        relevant = set(sample.relevant_chunk_ids)

        for chunk_id, text in self.corpus:
            if _is_relevant(chunk_id, text, sample):
                relevant.add(chunk_id)
            elif document_id and self.chunk_doc_ids.get(chunk_id) == document_id:
                relevant.add(chunk_id)

        return relevant

    def _build_samples(self) -> List[tuple[RetrievalEvalSample, Optional[str]]]:
        samples = []
        for sample in self.dataset.samples:
            relevant_ids = set()
            if "relevant_chunk_ids" in sample.metadata:
                relevant_ids = set(sample.metadata["relevant_chunk_ids"])
            eval_sample = RetrievalEvalSample(
                question=sample.question,
                relevant_chunk_ids=relevant_ids,
                relevant_texts=sample.reference_context,
            )
            samples.append((eval_sample, sample.document_id))
        return samples

    def evaluate_retriever(
        self,
        retriever_fn: Callable[[str, int], RetrievalResult],
        retriever_name: str,
        top_k: int = 5,
    ) -> RetrievalBenchmarkResult:
        """Evaluate a retriever function against the dataset."""
        eval_samples = self._build_samples()
        per_query: List[RetrievalEvalResult] = []

        for eval_sample, document_id in eval_samples:
            result = retriever_fn(eval_sample.question, top_k)
            retrieved_ids = [c.chunk_id for c in result.chunks]
            relevant = self._resolve_relevant_ids(eval_sample, document_id)

            rec = recall_at_k(retrieved_ids, relevant, top_k)
            prec = precision_at_k(retrieved_ids, relevant, top_k)
            mrr_score = mrr(retrieved_ids, relevant)
            ndcg = ndcg_at_k(retrieved_ids, relevant, top_k)

            per_query.append(
                RetrievalEvalResult(
                    question=eval_sample.question,
                    retriever=retriever_name,
                    recall_at_k=rec,
                    precision_at_k=prec,
                    mrr=mrr_score,
                    ndcg_at_k=ndcg,
                    top_k=top_k,
                    retrieved_ids=retrieved_ids,
                    latency_ms=result.latency_ms,
                )
            )

        n = len(per_query) or 1
        return RetrievalBenchmarkResult(
            dataset_name=self.dataset.name,
            retriever=retriever_name,
            top_k=top_k,
            num_queries=len(per_query),
            avg_recall_at_k=sum(r.recall_at_k for r in per_query) / n,
            avg_precision_at_k=sum(r.precision_at_k for r in per_query) / n,
            avg_mrr=sum(r.mrr for r in per_query) / n,
            avg_ndcg_at_k=sum(r.ndcg_at_k for r in per_query) / n,
            avg_latency_ms=sum(r.latency_ms for r in per_query) / n,
            per_query=per_query,
        )

    def compare_retrievers(
        self,
        retrievers: Dict[str, Callable[[str, int], RetrievalResult]],
        top_k: int = 5,
    ) -> Dict[str, RetrievalBenchmarkResult]:
        """Compare multiple retrievers on the same dataset."""
        results = {}
        for name, fn in retrievers.items():
            logger.info(f"Benchmarking retriever: {name}")
            start = time.time()
            results[name] = self.evaluate_retriever(fn, name, top_k=top_k)
            elapsed = (time.time() - start) * 1000
            logger.info(
                f"  {name}: Recall@{top_k}={results[name].avg_recall_at_k:.4f}, "
                f"MRR={results[name].avg_mrr:.4f} ({elapsed:.0f}ms total)"
            )
        return results

    def comparison_table(
        self,
        results: Dict[str, RetrievalBenchmarkResult],
    ) -> str:
        """Generate a comparison table across retrievers."""
        lines = [
            f"{'Retriever':<12} {'Recall@K':<12} {'Precision@K':<14} "
            f"{'MRR':<10} {'NDCG@K':<10} {'Latency(ms)':<12}",
            "-" * 72,
        ]
        sorted_results = sorted(
            results.values(),
            key=lambda r: r.avg_mrr,
            reverse=True,
        )
        for r in sorted_results:
            lines.append(
                f"{r.retriever:<12} {r.avg_recall_at_k:<12.4f} {r.avg_precision_at_k:<14.4f} "
                f"{r.avg_mrr:<10.4f} {r.avg_ndcg_at_k:<10.4f} {r.avg_latency_ms:<12.2f}"
            )
        return "\n".join(lines)
