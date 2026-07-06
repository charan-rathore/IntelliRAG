"""Generation benchmark harness with faithfulness evaluation."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, List, Optional

from libs.rag.context.models import AssembledContext
from libs.rag.evaluation.faithfulness import FaithfulnessEvaluator, FaithfulnessResult
from libs.rag.evaluation.models import EvaluationDataset
from libs.rag.evaluation.ragas_wrapper import RagasEvaluator
from libs.rag.generation.config import GenerationConfig
from libs.rag.generation.models import GenerationResult
from libs.rag.generation.service import GenerationService

logger = logging.getLogger(__name__)


@dataclass
class GenerationEvalResult:
    """Metrics for a single query's generated answer."""

    question: str
    faithfulness: float
    citation_precision: float
    citation_recall: float
    hallucination_rate: float
    citation_coverage: float
    answer_relevancy: float
    refused: bool
    has_citations: bool
    generation_latency_ms: float
    eval_latency_ms: float
    ragas_faithfulness: Optional[float] = None
    ragas_answer_relevancy: Optional[float] = None


@dataclass
class GenerationBenchmarkResult:
    """Aggregated generation benchmark results."""

    dataset_name: str
    model: str
    prompt_style: str
    num_queries: int
    avg_faithfulness: float
    avg_citation_precision: float
    avg_citation_recall: float
    avg_hallucination_rate: float
    avg_citation_coverage: float
    avg_answer_relevancy: float
    refusal_rate: float
    citation_rate: float
    avg_generation_latency_ms: float
    avg_eval_latency_ms: float
    avg_ragas_faithfulness: Optional[float] = None
    avg_ragas_answer_relevancy: Optional[float] = None
    per_query: List[GenerationEvalResult] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)

    def to_summary(self) -> str:
        lines = [
            f"Generation Benchmark: {self.dataset_name}",
            f"Model: {self.model} | Style: {self.prompt_style} | queries={self.num_queries}",
            "-" * 65,
            f"Faithfulness:        {self.avg_faithfulness:.4f}",
            f"Citation Precision:  {self.avg_citation_precision:.4f}",
            f"Citation Recall:     {self.avg_citation_recall:.4f}",
            f"Hallucination Rate:  {self.avg_hallucination_rate:.4f}",
            f"Citation Coverage:   {self.avg_citation_coverage:.4f}",
            f"Answer Relevancy:    {self.avg_answer_relevancy:.4f}",
            f"Refusal Rate:        {self.refusal_rate:.1%}",
            f"Citation Rate:       {self.citation_rate:.1%}",
            f"Avg Gen Latency:     {self.avg_generation_latency_ms:.0f} ms",
        ]
        if self.avg_ragas_faithfulness is not None:
            lines.append(f"RAGAS Faithfulness:  {self.avg_ragas_faithfulness:.4f}")
        if self.avg_ragas_answer_relevancy is not None:
            lines.append(f"RAGAS Relevancy:     {self.avg_ragas_answer_relevancy:.4f}")
        return "\n".join(lines)


@dataclass
class GenerationComparisonReport:
    """Comparison across prompt styles or models."""

    dataset_name: str
    results: List[GenerationBenchmarkResult]
    timestamp: datetime = field(default_factory=datetime.now)

    def comparison_table(self) -> str:
        lines = [
            f"{'Config':<28} {'Faith':<8} {'CitPrec':<9} {'Halluc':<8} {'Relev':<8} {'Refuse':<8}",
            "-" * 70,
        ]
        for r in results:
            label = f"{r.model}/{r.prompt_style}"
            lines.append(
                f"{label:<28} {r.avg_faithfulness:<8.3f} "
                f"{r.avg_citation_precision:<9.3f} {r.avg_hallucination_rate:<8.3f} "
                f"{r.avg_answer_relevancy:<8.3f} {r.refusal_rate:<8.1%}"
            )
        return "\n".join(lines)


class GenerationBenchmark:
    """End-to-end generation evaluation harness."""

    def __init__(
        self,
        generation_service: GenerationService,
        faithfulness_evaluator: Optional[FaithfulnessEvaluator] = None,
        ragas_evaluator: Optional[RagasEvaluator] = None,
    ) -> None:
        self.generation_service = generation_service
        self.faithfulness_evaluator = (
            faithfulness_evaluator or FaithfulnessEvaluator(use_llm_judge=False)
        )
        self.ragas_evaluator = ragas_evaluator

    def run(
        self,
        dataset: EvaluationDataset,
        context_fn: Callable[[str], AssembledContext],
        config: Optional[GenerationConfig] = None,
    ) -> GenerationBenchmarkResult:
        """Run generation + faithfulness evaluation on a dataset."""
        per_query: List[GenerationEvalResult] = []
        cfg = config or self.generation_service.config

        for sample in dataset.samples:
            context = context_fn(sample.question)
            gen_start = time.time()
            generation = self.generation_service.generate(context, config_override=cfg)
            gen_latency = (time.time() - gen_start) * 1000

            eval_start = time.time()
            faith = self.faithfulness_evaluator.evaluate(generation, context)
            eval_latency = (time.time() - eval_start) * 1000

            ragas_faith, ragas_rel = self._ragas_scores(
                sample.question, generation, context, sample.ground_truth
            )

            per_query.append(
                GenerationEvalResult(
                    question=sample.question,
                    faithfulness=faith.faithfulness,
                    citation_precision=faith.citation_precision,
                    citation_recall=faith.citation_recall,
                    hallucination_rate=faith.hallucination_rate,
                    citation_coverage=faith.citation_coverage,
                    answer_relevancy=faith.answer_relevancy,
                    refused=generation.refused,
                    has_citations=generation.has_citations,
                    generation_latency_ms=gen_latency,
                    eval_latency_ms=eval_latency,
                    ragas_faithfulness=ragas_faith,
                    ragas_answer_relevancy=ragas_rel,
                )
            )

        return self._aggregate(dataset.name, cfg, per_query)

    def compare_prompt_styles(
        self,
        dataset: EvaluationDataset,
        context_fn: Callable[[str], AssembledContext],
        styles: Optional[List[str]] = None,
    ) -> GenerationComparisonReport:
        """Compare citation_aware vs concise vs detailed prompt styles."""
        styles = styles or ["citation_aware", "concise", "detailed"]
        results = []
        base_cfg = self.generation_service.config

        for style in styles:
            cfg = GenerationConfig(
                model=base_cfg.model,
                base_url=base_cfg.base_url,
                temperature=base_cfg.temperature,
                prompt_style=style,  # type: ignore[arg-type]
                citation_prefix=base_cfg.citation_prefix,
            )
            results.append(self.run(dataset, context_fn, config=cfg))

        return GenerationComparisonReport(
            dataset_name=dataset.name,
            results=results,
        )

    def _ragas_scores(
        self,
        question: str,
        generation: GenerationResult,
        context: AssembledContext,
        ground_truth: str,
    ) -> tuple[Optional[float], Optional[float]]:
        if self.ragas_evaluator is None:
            return None, None
        try:
            contexts = [c.text for c in context.chunks]
            scores = self.ragas_evaluator.evaluate_full(
                questions=[question],
                contexts=[contexts],
                ground_truths=[ground_truth],
                answers=[generation.answer],
            )
            return scores.get("faithfulness"), scores.get("answer_relevancy")
        except Exception as e:
            logger.warning(f"RAGAS eval skipped: {e}")
            return None, None

    def _aggregate(
        self,
        dataset_name: str,
        config: GenerationConfig,
        per_query: List[GenerationEvalResult],
    ) -> GenerationBenchmarkResult:
        n = len(per_query)
        if n == 0:
            return GenerationBenchmarkResult(
                dataset_name=dataset_name,
                model=config.model,
                prompt_style=config.prompt_style,
                num_queries=0,
                avg_faithfulness=0.0,
                avg_citation_precision=0.0,
                avg_citation_recall=0.0,
                avg_hallucination_rate=0.0,
                avg_citation_coverage=0.0,
                avg_answer_relevancy=0.0,
                refusal_rate=0.0,
                citation_rate=0.0,
                avg_generation_latency_ms=0.0,
                avg_eval_latency_ms=0.0,
            )

        ragas_faith = [q.ragas_faithfulness for q in per_query if q.ragas_faithfulness is not None]
        ragas_rel = [q.ragas_answer_relevancy for q in per_query if q.ragas_answer_relevancy is not None]

        return GenerationBenchmarkResult(
            dataset_name=dataset_name,
            model=config.model,
            prompt_style=config.prompt_style,
            num_queries=n,
            avg_faithfulness=sum(q.faithfulness for q in per_query) / n,
            avg_citation_precision=sum(q.citation_precision for q in per_query) / n,
            avg_citation_recall=sum(q.citation_recall for q in per_query) / n,
            avg_hallucination_rate=sum(q.hallucination_rate for q in per_query) / n,
            avg_citation_coverage=sum(q.citation_coverage for q in per_query) / n,
            avg_answer_relevancy=sum(q.answer_relevancy for q in per_query) / n,
            refusal_rate=sum(1 for q in per_query if q.refused) / n,
            citation_rate=sum(1 for q in per_query if q.has_citations) / n,
            avg_generation_latency_ms=sum(q.generation_latency_ms for q in per_query) / n,
            avg_eval_latency_ms=sum(q.eval_latency_ms for q in per_query) / n,
            avg_ragas_faithfulness=(
                sum(ragas_faith) / len(ragas_faith) if ragas_faith else None
            ),
            avg_ragas_answer_relevancy=(
                sum(ragas_rel) / len(ragas_rel) if ragas_rel else None
            ),
            per_query=per_query,
        )
