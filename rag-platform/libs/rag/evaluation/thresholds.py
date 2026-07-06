"""Quality gate thresholds for RAG evaluation.

Based on 2026 CI/CD best practices:
- Absolute floors catch catastrophic regressions
- Warning levels flag degradation before critical
- Delta gates compare against rolling baseline (in quality_gate.py)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class ThresholdLevel(str, Enum):
    GOOD = "good"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class MetricThreshold:
    """Three-tier threshold for a single metric."""

    name: str
    good: float
    warning: float
    critical: float
    higher_is_better: bool = True

    def evaluate(self, value: float) -> ThresholdLevel:
        if self.higher_is_better:
            if value >= self.good:
                return ThresholdLevel.GOOD
            if value >= self.warning:
                return ThresholdLevel.WARNING
            return ThresholdLevel.CRITICAL
        else:
            if value <= self.good:
                return ThresholdLevel.GOOD
            if value <= self.warning:
                return ThresholdLevel.WARNING
            return ThresholdLevel.CRITICAL

    def floor(self) -> float:
        """Minimum acceptable value for CI gate (warning level)."""
        return self.warning if self.higher_is_better else self.warning


@dataclass
class QualityGateConfig:
    """Complete threshold configuration for the RAG pipeline."""

    retrieval_mrr: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("retrieval_mrr", 0.70, 0.50, 0.30)
    )
    retrieval_recall: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("retrieval_recall", 0.80, 0.60, 0.40)
    )
    retrieval_precision: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("retrieval_precision", 0.70, 0.50, 0.30)
    )
    rerank_mrr_lift: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("rerank_mrr_lift", 0.05, 0.0, -0.10)
    )
    context_precision: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("context_precision", 0.70, 0.50, 0.30)
    )
    context_recall: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("context_recall", 0.70, 0.50, 0.30)
    )
    faithfulness: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("faithfulness", 0.85, 0.70, 0.50)
    )
    citation_precision: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("citation_precision", 0.80, 0.60, 0.40)
    )
    hallucination_rate: MetricThreshold = field(
        default_factory=lambda: MetricThreshold(
            "hallucination_rate", 0.15, 0.30, 0.50, higher_is_better=False
        )
    )
    answer_relevancy: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("answer_relevancy", 0.70, 0.50, 0.30)
    )
    adversarial_pass_rate: MetricThreshold = field(
        default_factory=lambda: MetricThreshold("adversarial_pass_rate", 0.90, 0.70, 0.50)
    )
    e2e_latency_p95_ms: MetricThreshold = field(
        default_factory=lambda: MetricThreshold(
            "e2e_latency_p95_ms", 5000, 10000, 30000, higher_is_better=False
        )
    )

    def all_thresholds(self) -> Dict[str, MetricThreshold]:
        return {
            "retrieval_mrr": self.retrieval_mrr,
            "retrieval_recall": self.retrieval_recall,
            "retrieval_precision": self.retrieval_precision,
            "rerank_mrr_lift": self.rerank_mrr_lift,
            "context_precision": self.context_precision,
            "context_recall": self.context_recall,
            "faithfulness": self.faithfulness,
            "citation_precision": self.citation_precision,
            "hallucination_rate": self.hallucination_rate,
            "answer_relevancy": self.answer_relevancy,
            "adversarial_pass_rate": self.adversarial_pass_rate,
            "e2e_latency_p95_ms": self.e2e_latency_p95_ms,
        }

    @classmethod
    def strict(cls) -> "QualityGateConfig":
        """Stricter thresholds for production deployment gates."""
        return cls(
            faithfulness=MetricThreshold("faithfulness", 0.90, 0.80, 0.70),
            hallucination_rate=MetricThreshold(
                "hallucination_rate", 0.10, 0.20, 0.35, higher_is_better=False
            ),
            adversarial_pass_rate=MetricThreshold("adversarial_pass_rate", 0.95, 0.85, 0.70),
        )

    @classmethod
    def lenient(cls) -> "QualityGateConfig":
        """Lenient thresholds for development/CI smoke tests."""
        return cls(
            faithfulness=MetricThreshold("faithfulness", 0.50, 0.30, 0.10),
            hallucination_rate=MetricThreshold(
                "hallucination_rate", 0.50, 0.70, 0.90, higher_is_better=False
            ),
            adversarial_pass_rate=MetricThreshold("adversarial_pass_rate", 0.50, 0.30, 0.10),
        )
