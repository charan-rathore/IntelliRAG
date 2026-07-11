"""Task-specific evaluation for enterprise technical-doc RAG.

Slices the golden benchmark by task type (incident RCA, resolution, how-to)
and applies task-appropriate quality thresholds.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional

from libs.rag.evaluation.metrics import compute_distribution
from libs.rag.evaluation.models import EvaluationDataset
from libs.rag.evaluation.platform import EvaluationPlatform, PipelineHandles
from libs.rag.evaluation.parameters import PipelineParameters
from libs.rag.evaluation.report import EvalReport
from libs.rag.evaluation.task_taxonomy import TASK_DESCRIPTIONS, TaskType, resolve_task_type
from libs.rag.evaluation.thresholds import QualityGateConfig

logger = logging.getLogger(__name__)


@dataclass
class TaskThresholds:
    """Minimum acceptable metrics per task type."""

    retrieval_mrr: float = 0.50
    faithfulness: float = 0.50
    answer_relevancy: float = 0.15
    context_recall: float = 0.90
    adversarial_pass_rate: float = 1.0


DEFAULT_TASK_THRESHOLDS: Dict[TaskType, TaskThresholds] = {
    TaskType.INCIDENT_RCA: TaskThresholds(
        retrieval_mrr=0.60,
        faithfulness=0.25,
        answer_relevancy=0.20,
    ),
    TaskType.INCIDENT_RESOLUTION: TaskThresholds(
        retrieval_mrr=0.60,
        faithfulness=0.25,
        answer_relevancy=0.15,
    ),
    TaskType.HOW_TO: TaskThresholds(
        retrieval_mrr=0.50,
        faithfulness=0.15,
        answer_relevancy=0.15,
    ),
    TaskType.RUNBOOK_PROCEDURE: TaskThresholds(
        retrieval_mrr=0.55,
        faithfulness=0.55,
        answer_relevancy=0.18,
    ),
    TaskType.CONCEPTUAL: TaskThresholds(
        retrieval_mrr=0.50,
        faithfulness=0.50,
        answer_relevancy=0.15,
    ),
}


@dataclass
class TaskEvalResult:
    """Evaluation result for a single task type."""

    task_type: TaskType
    num_samples: int
    description: str
    aggregate_metrics: Dict[str, float] = field(default_factory=dict)
    passed: bool = True
    failures: List[str] = field(default_factory=list)
    report: Optional[EvalReport] = None

    def to_dict(self) -> Dict:
        return {
            "task_type": self.task_type.value,
            "description": self.description,
            "num_samples": self.num_samples,
            "aggregate_metrics": {
                k: round(v, 4) for k, v in self.aggregate_metrics.items()
            },
            "passed": self.passed,
            "failures": self.failures,
        }


@dataclass
class TaskEvalReport:
    """Aggregated task-specific evaluation across all task types."""

    dataset_name: str
    task_results: List[TaskEvalResult]
    all_passed: bool
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict:
        return {
            "dataset_name": self.dataset_name,
            "timestamp": self.timestamp.isoformat(),
            "all_passed": self.all_passed,
            "task_results": [r.to_dict() for r in self.task_results],
        }

    def to_summary(self) -> str:
        lines = [
            "=" * 70,
            "TASK-SPECIFIC EVALUATION REPORT",
            "=" * 70,
            f"Dataset: {self.dataset_name}",
            f"Overall: {'PASS' if self.all_passed else 'FAIL'}",
            "",
        ]
        for result in self.task_results:
            status = "PASS" if result.passed else "FAIL"
            lines.append(f"[{status}] {result.task_type.value} ({result.num_samples} samples)")
            lines.append(f"  {result.description}")
            for key in (
                "retrieval_mrr",
                "retrieval_recall",
                "faithfulness",
                "answer_relevancy",
                "context_precision",
            ):
                val = result.aggregate_metrics.get(key)
                if val is not None:
                    lines.append(f"  {key:<22} {val:.4f}")
            if result.failures:
                for failure in result.failures:
                    lines.append(f"  ! {failure}")
            lines.append("")
        lines.append("=" * 70)
        return "\n".join(lines)


class TaskEvaluator:
    """Run evaluation sliced by task type with task-specific thresholds."""

    def __init__(
        self,
        thresholds: Optional[Dict[TaskType, TaskThresholds]] = None,
    ) -> None:
        self.thresholds = thresholds or DEFAULT_TASK_THRESHOLDS

    def evaluate(
        self,
        dataset: EvaluationDataset,
        pipeline: PipelineHandles,
        parameters: PipelineParameters,
        quality_gate_config: Optional[QualityGateConfig] = None,
        run_adversarial: bool = True,
    ) -> TaskEvalReport:
        enriched = dataset.with_task_types()
        groups = enriched.group_by("task_type")
        task_results: List[TaskEvalResult] = []

        for task_key, task_dataset in sorted(groups.items()):
            if not task_dataset.samples:
                continue

            try:
                task_type = TaskType.from_str(task_key)
            except ValueError:
                logger.warning("Skipping unknown task type: %s", task_key)
                continue

            logger.info(
                "Evaluating task type %s (%d samples)",
                task_type.value,
                len(task_dataset),
            )

            platform = EvaluationPlatform(
                dataset=task_dataset,
                pipeline=pipeline,
                parameters=parameters,
                quality_gate_config=quality_gate_config or QualityGateConfig.lenient(),
            )
            report = platform.run(
                run_adversarial=run_adversarial,
                check_quality_gate=False,
                compare_baseline=False,
            )

            thresholds = self.thresholds.get(task_type, TaskThresholds())
            failures = self._check_thresholds(report.aggregate_metrics, thresholds)
            task_results.append(
                TaskEvalResult(
                    task_type=task_type,
                    num_samples=len(task_dataset),
                    description=TASK_DESCRIPTIONS.get(task_type, task_type.value),
                    aggregate_metrics=dict(report.aggregate_metrics),
                    passed=len(failures) == 0,
                    failures=failures,
                    report=report,
                )
            )

        all_passed = all(r.passed for r in task_results) if task_results else False
        return TaskEvalReport(
            dataset_name=dataset.name,
            task_results=task_results,
            all_passed=all_passed,
        )

    @staticmethod
    def _check_thresholds(
        metrics: Dict[str, float],
        thresholds: TaskThresholds,
    ) -> List[str]:
        failures = []
        checks = [
            ("retrieval_mrr", thresholds.retrieval_mrr, True),
            ("faithfulness", thresholds.faithfulness, True),
            ("answer_relevancy", thresholds.answer_relevancy, True),
            ("context_recall", thresholds.context_recall, True),
        ]
        for metric, floor, higher_is_better in checks:
            value = metrics.get(metric)
            if value is None:
                continue
            if higher_is_better and value < floor - 0.001:
                failures.append(f"{metric}={value:.4f} < {floor:.4f}")
        return failures


def compute_task_composite_score(metrics: Dict[str, float]) -> float:
    """Weighted composite score for task-specific RAG quality."""
    weights = {
        "retrieval_mrr": 0.14,
        "retrieval_ndcg": 0.10,
        "retrieval_recall": 0.06,
        "rerank_mrr": 0.10,
        "rerank_ndcg": 0.08,
        "rerank_ndcg_lift": 0.06,
        "rerank_mrr_lift": 0.04,
        "top1_change_rate": 0.04,
        "context_precision": 0.16,
        "context_recall": 0.04,
        "faithfulness": 0.10,
        "answer_relevancy": 0.06,
        "citation_precision": 0.02,
    }
    score = 0.0
    total_weight = 0.0
    for metric, weight in weights.items():
        value = metrics.get(metric)
        if value is None:
            if metric == "rerank_mrr":
                value = metrics.get("retrieval_mrr")
            elif metric == "rerank_ndcg":
                value = metrics.get("retrieval_ndcg")
        if value is None:
            continue
        score += weight * value
        total_weight += weight
    return score / total_weight if total_weight > 0 else 0.0
