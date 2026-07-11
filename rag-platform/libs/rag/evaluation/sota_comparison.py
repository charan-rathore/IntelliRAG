"""SOTA baseline comparison for IntelliRAG task benchmark.

Compares production pipeline configs against established RAG baselines:
  - naive_dense: dense-only retrieval, no reranking
  - bm25_only: keyword retrieval only
  - hybrid_no_rerank: hybrid RRF without reranking
  - intellirag: hybrid + lexical rerank + full context (production config)

Push gate: IntelliRAG must beat all baselines on composite task score.
"""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional
from uuid import uuid4

from libs.rag.evaluation.models import EvaluationDataset
from libs.rag.evaluation.parameters import PipelineParameters
from libs.rag.evaluation.platform import EvaluationPlatform, PipelineHandles
from libs.rag.evaluation.report import EvalReport
from libs.rag.evaluation.task_eval import compute_task_composite_score
from libs.rag.evaluation.thresholds import QualityGateConfig
from libs.rag.generation.config import GenerationConfig
from libs.rag.generation.ollama import LLMClient, MockLLMClient
from libs.rag.generation.service import GenerationService
from libs.rag.pipeline.factory import PipelineBuildConfig
from scripts.eval.pipeline_builder import build_eval_pipeline

logger = logging.getLogger(__name__)


@dataclass
class SOTAConfig:
    """Named pipeline configuration for benchmark comparison."""

    name: str
    description: str
    retrieval_mode: str = "hybrid"
    reranker_type: str = "lexical"
    context_strategy: str = "full"
    context_max_chunks: int = 5
    context_max_tokens: int = 2048
    is_production: bool = False
    reference_source: str = "internal_ablation"

    def to_pipeline_config(self, persist_dir: str) -> PipelineBuildConfig:
        return PipelineBuildConfig(
            persist_dir=persist_dir,
            default_retrieval_mode=self.retrieval_mode,  # type: ignore[arg-type]
            reranker_type=self.reranker_type,
            context_strategy=self.context_strategy,
            context_max_chunks=self.context_max_chunks,
            context_max_tokens=self.context_max_tokens,
        )

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "description": self.description,
            "retrieval_mode": self.retrieval_mode,
            "reranker_type": self.reranker_type,
            "context_strategy": self.context_strategy,
            "is_production": self.is_production,
            "reference_source": self.reference_source,
        }


# Established baselines representing common RAG approaches in literature/production.
SOTA_BASELINES: List[SOTAConfig] = [
    SOTAConfig(
        name="naive_dense",
        description="Classic naive RAG: dense vector retrieval only, no reranking",
        retrieval_mode="dense",
        reranker_type="pass_through",
        context_strategy="top_k",
        reference_source="Lewis et al. 2020 RAG baseline pattern",
    ),
    SOTAConfig(
        name="bm25_only",
        description="Sparse retrieval only (BM25/keyword), common production baseline",
        retrieval_mode="keyword",
        reranker_type="pass_through",
        context_strategy="top_k",
        reference_source="Elasticsearch/OpenSearch default",
    ),
    SOTAConfig(
        name="hybrid_no_rerank",
        description="Hybrid dense+BM25 with RRF fusion, no reranking stage",
        retrieval_mode="hybrid",
        reranker_type="pass_through",
        context_strategy="full",
        reference_source="Hybrid search without cross-encoder (common mid-tier)",
    ),
    SOTAConfig(
        name="intellirag",
        description="Production config: hybrid RRF + lexical rerank + top-k context from reranked candidates",
        retrieval_mode="hybrid",
        reranker_type="lexical",
        context_strategy="top_k",
        context_max_chunks=5,
        is_production=True,
        reference_source="IntelliRAG Phase 12 production pipeline",
    ),
]


@dataclass
class SOTARunResult:
    """Single config evaluation result."""

    config: SOTAConfig
    composite_score: float
    aggregate_metrics: Dict[str, float] = field(default_factory=dict)
    duration_ms: float = 0.0
    report: Optional[EvalReport] = None

    def to_dict(self) -> Dict:
        return {
            **self.config.to_dict(),
            "composite_score": round(self.composite_score, 4),
            "aggregate_metrics": {
                k: round(v, 4) for k, v in self.aggregate_metrics.items()
            },
            "duration_ms": round(self.duration_ms, 2),
        }


@dataclass
class SOTAComparisonReport:
    """Side-by-side comparison of all SOTA configs."""

    dataset_name: str
    results: List[SOTARunResult]
    winner: str
    intellirag_beats_all: bool
    margin_over_best_baseline: float
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict:
        return {
            "dataset_name": self.dataset_name,
            "timestamp": self.timestamp.isoformat(),
            "winner": self.winner,
            "intellirag_beats_all": self.intellirag_beats_all,
            "margin_over_best_baseline": round(self.margin_over_best_baseline, 4),
            "rankings": [
                {
                    "rank": i + 1,
                    **r.to_dict(),
                }
                for i, r in enumerate(self.sorted_results())
            ],
        }

    def sorted_results(self) -> List[SOTARunResult]:
        return sorted(self.results, key=lambda r: r.composite_score, reverse=True)

    def to_summary(self) -> str:
        lines = [
            "=" * 72,
            "SOTA BASELINE COMPARISON — IntelliRAG Task Benchmark",
            "=" * 72,
            f"Dataset: {self.dataset_name}",
            f"Winner:  {self.winner}",
            f"IntelliRAG beats all baselines: {'YES' if self.intellirag_beats_all else 'NO'}",
            f"Margin over best baseline: {self.margin_over_best_baseline:+.4f}",
            "",
            f"{'Rank':<6}{'Config':<22}{'Composite':<12}{'MRR':<10}{'Faith':<10}{'Relev':<10}",
            "-" * 72,
        ]
        for i, result in enumerate(self.sorted_results(), start=1):
            m = result.aggregate_metrics
            marker = " *" if result.config.is_production else ""
            lines.append(
                f"{i:<6}{result.config.name:<22}"
                f"{result.composite_score:<12.4f}"
                f"{m.get('retrieval_mrr', 0):<10.4f}"
                f"{m.get('faithfulness', 0):<10.4f}"
                f"{m.get('answer_relevancy', 0):<10.4f}{marker}"
            )
        lines.extend(["", "* = IntelliRAG production config", "=" * 72])
        return "\n".join(lines)


class SOTAComparisonRunner:
    """Run multiple pipeline configs on the same dataset and rank results."""

    def __init__(
        self,
        configs: Optional[List[SOTAConfig]] = None,
        llm_client_factory: Optional[Callable[[], LLMClient]] = None,
    ) -> None:
        self.configs = configs or SOTA_BASELINES
        self.llm_client_factory = llm_client_factory or MockLLMClient

    def compare(
        self,
        dataset: EvaluationDataset,
        run_adversarial: bool = True,
    ) -> SOTAComparisonReport:
        enriched = dataset.with_task_types()
        results: List[SOTARunResult] = []

        for config in self.configs:
            logger.info("Running SOTA config: %s", config.name)
            start = time.time()
            result = self._run_config(enriched, config, run_adversarial)
            result.duration_ms = (time.time() - start) * 1000
            results.append(result)
            logger.info(
                "  %s: composite=%.4f (%.0fms)",
                config.name,
                result.composite_score,
                result.duration_ms,
            )

        sorted_results = sorted(results, key=lambda r: r.composite_score, reverse=True)
        winner = sorted_results[0].config.name if sorted_results else "none"

        intellirag_results = [r for r in results if r.config.is_production]
        baseline_results = [r for r in results if not r.config.is_production]

        intellirag_score = intellirag_results[0].composite_score if intellirag_results else 0.0
        best_baseline_score = (
            max(r.composite_score for r in baseline_results) if baseline_results else 0.0
        )

        intellirag_beats_all = bool(intellirag_results) and all(
            intellirag_score > r.composite_score + 0.0001 for r in baseline_results
        )
        margin = intellirag_score - best_baseline_score

        return SOTAComparisonReport(
            dataset_name=dataset.name,
            results=results,
            winner=winner,
            intellirag_beats_all=intellirag_beats_all,
            margin_over_best_baseline=margin,
        )

    def _run_config(
        self,
        dataset: EvaluationDataset,
        config: SOTAConfig,
        run_adversarial: bool,
    ) -> SOTARunResult:
        tmpdir = tempfile.mkdtemp(prefix=f"sota-{config.name}-")
        try:
            pipeline_cfg = config.to_pipeline_config(tmpdir)
            pipeline = build_eval_pipeline(config=pipeline_cfg)
            pipeline = self._attach_generation(pipeline, config)

            params = PipelineParameters(
                run_id=str(uuid4()),
                timestamp=datetime.now().isoformat(),
                dataset_name=dataset.name,
                dataset_version=dataset.version,
                num_samples=len(dataset),
                retrieval_mode=config.retrieval_mode,
                reranker=config.reranker_type,
                context_strategy=config.context_strategy,
                generation_model="mock",
            )

            platform = EvaluationPlatform(
                dataset=dataset,
                pipeline=pipeline,
                parameters=params,
                quality_gate_config=QualityGateConfig.lenient(),
            )

            report = platform.run(
                run_adversarial=run_adversarial,
                check_quality_gate=False,
                compare_baseline=False,
            )

            composite = compute_task_composite_score(report.aggregate_metrics)
            return SOTARunResult(
                config=config,
                composite_score=composite,
                aggregate_metrics=dict(report.aggregate_metrics),
                report=report,
            )
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    @staticmethod
    def _attach_generation(
        pipeline: PipelineHandles,
        config: SOTAConfig,
    ) -> PipelineHandles:
        gen_config = GenerationConfig.for_ollama(model="mock")
        pipeline.generation_service = GenerationService(
            config=gen_config,
            llm_client=MockLLMClient(),
        )
        return pipeline


def save_sota_baselines(
    report: SOTAComparisonReport,
    output_dir: str | Path,
) -> None:
    """Persist per-config metrics as versioned SOTA baseline files."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for result in report.results:
        path = output_dir / f"{result.config.name}.json"
        payload = {
            "name": result.config.name,
            "description": result.config.description,
            "timestamp": datetime.now().isoformat(),
            "composite_score": result.composite_score,
            "metrics": result.aggregate_metrics,
            "config": result.config.to_dict(),
        }
        path.write_text(json.dumps(payload, indent=2))

    summary_path = output_dir / "comparison_summary.json"
    summary_path.write_text(json.dumps(report.to_dict(), indent=2))
