"""Context assembly evaluation harness.

Measures context quality across assembly strategies:
- Context precision: relevant tokens / total tokens in assembled context
- Context recall: reference coverage in assembled context
- Token efficiency: relevant information per token spent
- Deduplication rate: redundant chunks removed
- Budget utilization: tokens used vs budget limit
- Source diversity: unique documents represented
- Compression ratio: tokens saved by compression
- Latency overhead per strategy
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, List, Optional, Set

from libs.rag.chunking.utils import estimate_token_count
from libs.rag.context.config import ContextAssemblyConfig
from libs.rag.context.models import AssembledContext
from libs.rag.evaluation.models import EvaluationDataset
from libs.rag.evaluation.retrieval_benchmark import _is_relevant
from libs.rag.retrieval.keyword import tokenize

logger = logging.getLogger(__name__)


@dataclass
class ContextEvalResult:
    """Metrics for a single query's assembled context."""

    question: str
    strategy: str
    context_precision: float
    context_recall: float
    token_efficiency: float
    dedup_rate: float
    budget_utilization: float
    source_diversity: int
    compression_ratio: float
    chunks_in: int
    chunks_out: int
    tokens_out: int
    latency_ms: float
    has_relevant_content: bool


@dataclass
class ContextBenchmarkResult:
    """Aggregated context assembly benchmark results."""

    dataset_name: str
    strategy: str
    max_tokens: int
    num_queries: int
    avg_context_precision: float
    avg_context_recall: float
    avg_token_efficiency: float
    avg_dedup_rate: float
    avg_budget_utilization: float
    avg_source_diversity: float
    avg_compression_ratio: float
    avg_latency_ms: float
    relevant_content_rate: float
    per_query: List[ContextEvalResult] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)

    def to_summary(self) -> str:
        lines = [
            f"Context Benchmark: {self.dataset_name}",
            f"Strategy: {self.strategy} | max_tokens={self.max_tokens} | queries={self.num_queries}",
            "-" * 60,
            f"Context Precision:  {self.avg_context_precision:.4f}",
            f"Context Recall:     {self.avg_context_recall:.4f}",
            f"Token Efficiency:   {self.avg_token_efficiency:.4f}",
            f"Dedup Rate:         {self.avg_dedup_rate:.4f}",
            f"Budget Utilization: {self.avg_budget_utilization:.4f}",
            f"Source Diversity:   {self.avg_source_diversity:.1f}",
            f"Compression Ratio:  {self.avg_compression_ratio:.4f}",
            f"Relevant Content:   {self.relevant_content_rate:.1%}",
            f"Avg Latency:        {self.avg_latency_ms:.2f} ms",
        ]
        return "\n".join(lines)


@dataclass
class ContextComparisonReport:
    """Comparison across assembly strategies."""

    dataset_name: str
    results: List[ContextBenchmarkResult]
    timestamp: datetime = field(default_factory=datetime.now)

    def comparison_table(self) -> str:
        lines = [
            f"{'Strategy':<18} {'Precision':<11} {'Recall':<9} {'Efficiency':<11} "
            f"{'Dedup':<8} {'Budget':<8} {'Diversity':<10} {'Latency':<10}",
            "-" * 90,
        ]
        sorted_results = sorted(
            self.results,
            key=lambda r: r.avg_token_efficiency,
            reverse=True,
        )
        for r in sorted_results:
            lines.append(
                f"{r.strategy:<18} {r.avg_context_precision:<11.4f} "
                f"{r.avg_context_recall:<9.4f} {r.avg_token_efficiency:<11.4f} "
                f"{r.avg_dedup_rate:<8.4f} {r.avg_budget_utilization:<8.4f} "
                f"{r.avg_source_diversity:<10.1f} {r.avg_latency_ms:<10.2f}"
            )
        return "\n".join(lines)

    def best_strategy(self) -> Optional[ContextBenchmarkResult]:
        if not self.results:
            return None
        return max(self.results, key=lambda r: r.avg_token_efficiency)


def _token_overlap_recall(assembled_text: str, reference_texts: List[str]) -> float:
    """Measure what fraction of reference key phrases appear in context."""
    if not reference_texts:
        return 0.0

    context_lower = assembled_text.lower()
    hits = 0
    for ref in reference_texts:
        ref_lower = ref.lower().strip()
        if not ref_lower:
            continue
        ref_tokens = set(tokenize(ref_lower))
        if not ref_tokens:
            continue
        context_tokens = set(tokenize(context_lower))
        overlap = len(ref_tokens & context_tokens) / len(ref_tokens)
        if overlap >= 0.5 or ref_lower in context_lower:
            hits += 1

    return hits / len(reference_texts)


def _context_precision(
    assembled: AssembledContext,
    relevant_chunk_ids: Set[str],
    reference_texts: List[str],
) -> float:
    """Fraction of assembled tokens from relevant chunks."""
    if not assembled.chunks:
        return 0.0

    relevant_tokens = 0
    total_tokens = 0

    for chunk in assembled.chunks:
        total_tokens += chunk.token_count
        is_relevant = chunk.chunk_id in relevant_chunk_ids
        if not is_relevant:
            for ref in reference_texts:
                ref_lower = ref.lower()
                if ref_lower in chunk.text.lower() or chunk.text.lower() in ref_lower:
                    is_relevant = True
                    break
        if is_relevant:
            relevant_tokens += chunk.token_count

    return relevant_tokens / total_tokens if total_tokens > 0 else 0.0


class ContextBenchmark:
    """Benchmark runner for context assembly strategies."""

    def __init__(
        self,
        dataset: EvaluationDataset,
        corpus: List[tuple[str, str]],
    ) -> None:
        self.dataset = dataset
        self.corpus = corpus

    def _resolve_relevant_ids(self, sample) -> Set[str]:
        relevant = set(sample.metadata.get("relevant_chunk_ids", []))
        for chunk_id, text in self.corpus:
            for ref in sample.reference_context:
                ref_lower = ref.lower().strip()
                if ref_lower and (
                    ref_lower in text.lower() or text.lower() in ref_lower
                ):
                    relevant.add(chunk_id)
        return relevant

    def evaluate_strategy(
        self,
        assemble_fn: Callable[[str, List], AssembledContext],
        chunks_provider: Callable[[str], list],
        strategy_name: str,
        max_tokens: int = 2048,
    ) -> ContextBenchmarkResult:
        """Evaluate a single assembly strategy."""
        per_query: List[ContextEvalResult] = []

        for sample in self.dataset.samples:
            chunks = chunks_provider(sample.question)
            assembled = assemble_fn(sample.question, chunks)
            relevant_ids = self._resolve_relevant_ids(sample)

            precision = _context_precision(
                assembled, relevant_ids, sample.reference_context
            )
            recall = _token_overlap_recall(
                assembled.context_text, sample.reference_context
            )
            efficiency = precision * recall / max(assembled.stats.budget_utilization, 0.01)

            dedup_rate = (
                assembled.stats.duplicates_removed / assembled.stats.chunks_in
                if assembled.stats.chunks_in > 0
                else 0.0
            )

            sources = set()
            for c in assembled.chunks:
                doc_id = c.metadata.get("document_id", c.chunk_id)
                sources.add(doc_id)

            compression_ratio = (
                assembled.stats.tokens_in / assembled.stats.tokens_out
                if assembled.stats.tokens_out > 0
                else 1.0
            )

            per_query.append(
                ContextEvalResult(
                    question=sample.question,
                    strategy=strategy_name,
                    context_precision=precision,
                    context_recall=recall,
                    token_efficiency=efficiency,
                    dedup_rate=dedup_rate,
                    budget_utilization=assembled.stats.budget_utilization,
                    source_diversity=len(sources),
                    compression_ratio=compression_ratio,
                    chunks_in=assembled.stats.chunks_in,
                    chunks_out=assembled.stats.chunks_selected,
                    tokens_out=assembled.stats.tokens_out,
                    latency_ms=assembled.latency_ms,
                    has_relevant_content=recall > 0 or precision > 0,
                )
            )

        n = len(per_query) or 1
        return ContextBenchmarkResult(
            dataset_name=self.dataset.name,
            strategy=strategy_name,
            max_tokens=max_tokens,
            num_queries=len(per_query),
            avg_context_precision=sum(r.context_precision for r in per_query) / n,
            avg_context_recall=sum(r.context_recall for r in per_query) / n,
            avg_token_efficiency=sum(r.token_efficiency for r in per_query) / n,
            avg_dedup_rate=sum(r.dedup_rate for r in per_query) / n,
            avg_budget_utilization=sum(r.budget_utilization for r in per_query) / n,
            avg_source_diversity=sum(r.source_diversity for r in per_query) / n,
            avg_compression_ratio=sum(r.compression_ratio for r in per_query) / n,
            avg_latency_ms=sum(r.latency_ms for r in per_query) / n,
            relevant_content_rate=sum(1 for r in per_query if r.has_relevant_content) / n,
            per_query=per_query,
        )

    def run_strategy_comparison(
        self,
        assembly_service,
        chunks_provider: Callable[[str], list],
        strategies: Optional[List[str]] = None,
        max_tokens: int = 2048,
    ) -> ContextComparisonReport:
        """Compare multiple assembly strategies."""
        if strategies is None:
            strategies = [
                "top_k",
                "dedup_only",
                "mmr",
                "budget",
                "full",
                "full_compressed",
            ]

        results: List[ContextBenchmarkResult] = []

        for strategy in strategies:
            logger.info(f"Evaluating assembly strategy: {strategy}")

            config = ContextAssemblyConfig(
                strategy=strategy,
                max_tokens=max_tokens,
            )
            if strategy == "full_compressed":
                config.enable_compression = True

            def assemble_fn(q, chunks, cfg=config):
                return assembly_service.assemble(q, chunks, config_override=cfg)

            result = self.evaluate_strategy(
                assemble_fn=assemble_fn,
                chunks_provider=chunks_provider,
                strategy_name=strategy,
                max_tokens=max_tokens,
            )
            results.append(result)

            logger.info(
                f"  {strategy}: precision={result.avg_context_precision:.4f}, "
                f"recall={result.avg_context_recall:.4f}, "
                f"efficiency={result.avg_token_efficiency:.4f}"
            )

        return ContextComparisonReport(
            dataset_name=self.dataset.name,
            results=results,
        )

    def run_budget_sweep(
        self,
        assembly_service,
        chunks_provider: Callable[[str], list],
        budgets: Optional[List[int]] = None,
        strategy: str = "full",
    ) -> Dict[int, ContextBenchmarkResult]:
        """Sweep token budgets to find optimal budget point."""
        if budgets is None:
            budgets = [256, 512, 1024, 2048, 4096]

        results = {}
        for budget in budgets:
            config = ContextAssemblyConfig(strategy=strategy, max_tokens=budget)

            def assemble_fn(q, chunks, cfg=config):
                return assembly_service.assemble(q, chunks, config_override=cfg)

            result = self.evaluate_strategy(
                assemble_fn=assemble_fn,
                chunks_provider=chunks_provider,
                strategy_name=f"{strategy}@{budget}",
                max_tokens=budget,
            )
            results[budget] = result
            logger.info(
                f"  budget={budget}: efficiency={result.avg_token_efficiency:.4f}, "
                f"recall={result.avg_context_recall:.4f}"
            )

        return results
