"""Comprehensive reranking evaluation harness.

Evaluates reranking lift across multiple strategies:
- Before/after MRR, NDCG, Recall, Precision
- Ablation across retrieval modes (dense, keyword, hybrid)
- Latency overhead analysis
- Rank displacement (how often reranking changes top-1)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, List, Optional, Set

from libs.rag.evaluation.models import EvaluationDataset
from libs.rag.evaluation.retrieval_benchmark import (
    RetrievalBenchmark,
    RetrievalEvalResult,
    _is_relevant,
    mrr,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
)
from libs.rag.reranking.models import RerankResult
from libs.rag.retrieval.models import RetrievalResult

logger = logging.getLogger(__name__)


@dataclass
class RerankEvalResult:
    """Metrics for a single query after reranking."""

    question: str
    pipeline: str
    recall_at_k: float
    precision_at_k: float
    mrr: float
    ndcg_at_k: float
    top_k: int
    top1_changed: bool
    avg_rank_displacement: float
    retrieval_latency_ms: float
    rerank_latency_ms: float
    total_latency_ms: float
    retrieved_ids: List[str] = field(default_factory=list)


@dataclass
class RerankBenchmarkResult:
    """Aggregated reranking benchmark results."""

    dataset_name: str
    pipeline: str
    retrieval_mode: str
    reranker: str
    top_k: int
    retrieve_top_n: int
    num_queries: int
    avg_recall_at_k: float
    avg_precision_at_k: float
    avg_mrr: float
    avg_ndcg_at_k: float
    mrr_lift: float
    ndcg_lift: float
    top1_change_rate: float
    avg_rank_displacement: float
    avg_retrieval_latency_ms: float
    avg_rerank_latency_ms: float
    avg_total_latency_ms: float
    per_query: List[RerankEvalResult] = field(default_factory=list)
    baseline_mrr: float = 0.0
    timestamp: datetime = field(default_factory=datetime.now)

    def to_summary(self) -> str:
        lines = [
            f"Reranking Benchmark: {self.dataset_name}",
            f"Pipeline: {self.pipeline} | retrieval={self.retrieval_mode} | reranker={self.reranker}",
            f"retrieve_top_n={self.retrieve_top_n} | top_k={self.top_k} | queries={self.num_queries}",
            "-" * 60,
            f"MRR:           {self.avg_mrr:.4f}  (baseline: {self.baseline_mrr:.4f}, lift: {self.mrr_lift:+.4f})",
            f"NDCG@{self.top_k}:     {self.avg_ndcg_at_k:.4f}  (lift: {self.ndcg_lift:+.4f})",
            f"Recall@{self.top_k}:    {self.avg_recall_at_k:.4f}",
            f"Precision@{self.top_k}: {self.avg_precision_at_k:.4f}",
            f"Top-1 changed: {self.top1_change_rate:.1%} of queries",
            f"Avg rank displacement: {self.avg_rank_displacement:.2f}",
            f"Latency: retrieval={self.avg_retrieval_latency_ms:.1f}ms, "
            f"rerank={self.avg_rerank_latency_ms:.1f}ms, "
            f"total={self.avg_total_latency_ms:.1f}ms",
        ]
        return "\n".join(lines)


@dataclass
class RerankComparisonReport:
    """Full comparison report across pipelines and ablations."""

    dataset_name: str
    results: List[RerankBenchmarkResult]
    baseline_results: Dict[str, float]
    timestamp: datetime = field(default_factory=datetime.now)

    def comparison_table(self) -> str:
        lines = [
            f"{'Pipeline':<28} {'MRR':<8} {'Lift':<8} {'NDCG':<8} "
            f"{'Recall':<8} {'Rerank ms':<10} {'Top1 Chg':<10}",
            "-" * 88,
        ]
        sorted_results = sorted(self.results, key=lambda r: r.avg_mrr, reverse=True)
        for r in sorted_results:
            lines.append(
                f"{r.pipeline:<28} {r.avg_mrr:<8.4f} {r.mrr_lift:<+8.4f} "
                f"{r.avg_ndcg_at_k:<8.4f} {r.avg_recall_at_k:<8.4f} "
                f"{r.avg_rerank_latency_ms:<10.1f} {r.top1_change_rate:<10.1%}"
            )
        return "\n".join(lines)

    def best_pipeline(self) -> Optional[RerankBenchmarkResult]:
        if not self.results:
            return None
        return max(self.results, key=lambda r: r.avg_mrr)


class RerankingBenchmark:
    """Benchmark runner for reranking evaluation with ablations."""

    def __init__(
        self,
        dataset: EvaluationDataset,
        corpus: List[tuple[str, str]],
        chunk_doc_ids: Optional[Dict[str, str]] = None,
    ) -> None:
        self.dataset = dataset
        self.corpus = corpus
        self.chunk_doc_ids = chunk_doc_ids or {}
        self._retrieval_benchmark = RetrievalBenchmark(
            dataset, corpus=corpus, chunk_doc_ids=self.chunk_doc_ids
        )

    def _resolve_relevant_ids(self, sample) -> Set[str]:
        from libs.rag.evaluation.retrieval_benchmark import RetrievalEvalSample

        eval_sample = RetrievalEvalSample(
            question=sample.question,
            relevant_chunk_ids=set(sample.metadata.get("relevant_chunk_ids", [])),
            relevant_texts=sample.reference_context,
        )
        return self._retrieval_benchmark._resolve_relevant_ids(
            eval_sample, sample.document_id
        )

    def _evaluate_rerank_result(
        self,
        question: str,
        rerank_result: RerankResult,
        retrieval_result: RetrievalResult,
        relevant: Set[str],
        top_k: int,
        pipeline: str,
    ) -> RerankEvalResult:
        retrieved_ids = [c.chunk_id for c in rerank_result.chunks]
        baseline_ids = [c.chunk_id for c in retrieval_result.chunks[:top_k]]

        top1_changed = (
            bool(retrieved_ids) and bool(baseline_ids)
            and retrieved_ids[0] != baseline_ids[0]
        )

        displacements = []
        baseline_rank_map = {cid: i + 1 for i, cid in enumerate(baseline_ids)}
        for i, cid in enumerate(retrieved_ids):
            if cid in baseline_rank_map:
                displacements.append(abs((i + 1) - baseline_rank_map[cid]))

        avg_displacement = sum(displacements) / len(displacements) if displacements else 0.0

        return RerankEvalResult(
            question=question,
            pipeline=pipeline,
            recall_at_k=recall_at_k(retrieved_ids, relevant, top_k),
            precision_at_k=precision_at_k(retrieved_ids, relevant, top_k),
            mrr=mrr(retrieved_ids, relevant),
            ndcg_at_k=ndcg_at_k(retrieved_ids, relevant, top_k),
            top_k=top_k,
            top1_changed=top1_changed,
            avg_rank_displacement=avg_displacement,
            retrieval_latency_ms=rerank_result.retrieval_latency_ms,
            rerank_latency_ms=rerank_result.rerank_latency_ms,
            total_latency_ms=rerank_result.total_latency_ms,
            retrieved_ids=retrieved_ids,
        )

    def evaluate_pipeline(
        self,
        retrieve_fn: Callable[[str, int], RetrievalResult],
        rerank_fn: Callable[[str, RetrievalResult, int], RerankResult],
        pipeline_name: str,
        retrieval_mode: str,
        reranker_name: str,
        top_k: int = 5,
        retrieve_top_n: int = 20,
    ) -> RerankBenchmarkResult:
        """Evaluate a retrieve-then-rerank pipeline against the dataset."""
        per_query: List[RerankEvalResult] = []
        baseline_mrrs: List[float] = []
        baseline_ndcgs: List[float] = []

        for sample in self.dataset.samples:
            relevant = self._resolve_relevant_ids(sample)

            retrieval_result = retrieve_fn(sample.question, retrieve_top_n)
            baseline_ids = [c.chunk_id for c in retrieval_result.chunks[:top_k]]
            baseline_mrrs.append(mrr(baseline_ids, relevant))
            baseline_ndcgs.append(ndcg_at_k(baseline_ids, relevant, top_k))

            rerank_result = rerank_fn(sample.question, retrieval_result, top_k)
            per_query.append(
                self._evaluate_rerank_result(
                    question=sample.question,
                    rerank_result=rerank_result,
                    retrieval_result=retrieval_result,
                    relevant=relevant,
                    top_k=top_k,
                    pipeline=pipeline_name,
                )
            )

        n = len(per_query) or 1
        baseline_mrr = sum(baseline_mrrs) / (len(baseline_mrrs) or 1)
        baseline_ndcg = sum(baseline_ndcgs) / (len(baseline_ndcgs) or 1)
        avg_mrr = sum(r.mrr for r in per_query) / n
        avg_ndcg = sum(r.ndcg_at_k for r in per_query) / n

        return RerankBenchmarkResult(
            dataset_name=self.dataset.name,
            pipeline=pipeline_name,
            retrieval_mode=retrieval_mode,
            reranker=reranker_name,
            top_k=top_k,
            retrieve_top_n=retrieve_top_n,
            num_queries=len(per_query),
            avg_recall_at_k=sum(r.recall_at_k for r in per_query) / n,
            avg_precision_at_k=sum(r.precision_at_k for r in per_query) / n,
            avg_mrr=avg_mrr,
            avg_ndcg_at_k=avg_ndcg,
            mrr_lift=avg_mrr - baseline_mrr,
            ndcg_lift=avg_ndcg - baseline_ndcg,
            top1_change_rate=sum(1 for r in per_query if r.top1_changed) / n,
            avg_rank_displacement=sum(r.avg_rank_displacement for r in per_query) / n,
            avg_retrieval_latency_ms=sum(r.retrieval_latency_ms for r in per_query) / n,
            avg_rerank_latency_ms=sum(r.rerank_latency_ms for r in per_query) / n,
            avg_total_latency_ms=sum(r.total_latency_ms for r in per_query) / n,
            per_query=per_query,
            baseline_mrr=baseline_mrr,
        )

    def run_full_comparison(
        self,
        retrieval_service,
        rerankers: Dict[str, object],
        retrieval_modes: Optional[List[str]] = None,
        top_k: int = 5,
        retrieve_top_n: int = 20,
    ) -> RerankComparisonReport:
        """Run ablation across retrieval modes and rerankers."""
        if retrieval_modes is None:
            retrieval_modes = ["dense", "keyword", "hybrid"]

        results: List[RerankBenchmarkResult] = []
        baseline_mrrs: Dict[str, float] = {}

        for mode in retrieval_modes:
            def retrieve_fn(q, n, m=mode):
                return retrieval_service.retrieve(q, mode=m, top_k=n)

            baseline = self._retrieval_benchmark.evaluate_retriever(
                retrieve_fn, f"{mode}_baseline", top_k=top_k
            )
            baseline_mrrs[mode] = baseline.avg_mrr

            for reranker_name, reranker in rerankers.items():
                from libs.rag.reranking.service import RerankingService

                pipeline_name = f"{mode}+{reranker_name}"
                logger.info(f"Evaluating pipeline: {pipeline_name}")

                svc = RerankingService(
                    retrieval_service=retrieval_service,
                    reranker=reranker,
                    retrieve_top_n=retrieve_top_n,
                )

                per_query: List[RerankEvalResult] = []
                baseline_mrr_list: List[float] = []

                for sample in self.dataset.samples:
                    relevant = self._resolve_relevant_ids(sample)
                    rerank_result = svc.retrieve_and_rerank(
                        query=sample.question,
                        retrieval_mode=mode,
                        top_k=top_k,
                    )
                    retrieval_result = retrieval_service.retrieve(
                        sample.question, mode=mode, top_k=retrieve_top_n
                    )
                    baseline_ids = [c.chunk_id for c in retrieval_result.chunks[:top_k]]
                    baseline_mrr_list.append(mrr(baseline_ids, relevant))

                    per_query.append(
                        self._evaluate_rerank_result(
                            question=sample.question,
                            rerank_result=rerank_result,
                            retrieval_result=retrieval_result,
                            relevant=relevant,
                            top_k=top_k,
                            pipeline=pipeline_name,
                        )
                    )

                n = len(per_query) or 1
                baseline_mrr = sum(baseline_mrr_list) / (len(baseline_mrr_list) or 1)
                avg_mrr = sum(r.mrr for r in per_query) / n
                baseline_ndcg = baseline.avg_ndcg_at_k

                results.append(
                    RerankBenchmarkResult(
                        dataset_name=self.dataset.name,
                        pipeline=pipeline_name,
                        retrieval_mode=mode,
                        reranker=reranker_name,
                        top_k=top_k,
                        retrieve_top_n=retrieve_top_n,
                        num_queries=len(per_query),
                        avg_recall_at_k=sum(r.recall_at_k for r in per_query) / n,
                        avg_precision_at_k=sum(r.precision_at_k for r in per_query) / n,
                        avg_mrr=avg_mrr,
                        avg_ndcg_at_k=sum(r.ndcg_at_k for r in per_query) / n,
                        mrr_lift=avg_mrr - baseline_mrr,
                        ndcg_lift=sum(r.ndcg_at_k for r in per_query) / n - baseline_ndcg,
                        top1_change_rate=sum(1 for r in per_query if r.top1_changed) / n,
                        avg_rank_displacement=sum(r.avg_rank_displacement for r in per_query) / n,
                        avg_retrieval_latency_ms=sum(r.retrieval_latency_ms for r in per_query) / n,
                        avg_rerank_latency_ms=sum(r.rerank_latency_ms for r in per_query) / n,
                        avg_total_latency_ms=sum(r.total_latency_ms for r in per_query) / n,
                        per_query=per_query,
                        baseline_mrr=baseline_mrr,
                    )
                )

                logger.info(
                    f"  {pipeline_name}: MRR={avg_mrr:.4f} (lift={avg_mrr - baseline_mrr:+.4f})"
                )

        return RerankComparisonReport(
            dataset_name=self.dataset.name,
            results=results,
            baseline_results=baseline_mrrs,
        )
