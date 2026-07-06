"""Unified evaluation report with JSON and text output."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .adversarial import AdversarialReport
from .baseline import BaselineMetrics, DeltaResult
from .metrics import DistributionStats, LayerMetrics
from .parameters import PipelineParameters
from .quality_gate import QualityGateResult


@dataclass
class EvalReport:
    """Complete evaluation report across all pipeline layers."""

    run_id: str
    timestamp: datetime
    parameters: PipelineParameters
    layer_metrics: Dict[str, LayerMetrics] = field(default_factory=dict)
    aggregate_metrics: Dict[str, float] = field(default_factory=dict)
    distributions: Dict[str, DistributionStats] = field(default_factory=dict)
    per_sample_metrics: Dict[str, List[float]] = field(default_factory=dict)
    quality_gate: Optional[QualityGateResult] = None
    adversarial: Optional[AdversarialReport] = None
    baseline_deltas: List[DeltaResult] = field(default_factory=list)
    operational: Dict[str, float] = field(default_factory=dict)
    duration_ms: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "run_id": self.run_id,
            "timestamp": self.timestamp.isoformat(),
            "parameters": self.parameters.to_dict(),
            "aggregate_metrics": {
                k: round(v, 4) for k, v in self.aggregate_metrics.items()
            },
            "distributions": {
                k: v.to_dict() for k, v in self.distributions.items()
            },
            "layer_metrics": {
                k: v.to_dict() for k, v in self.layer_metrics.items()
            },
            "operational": {
                k: round(v, 2) for k, v in self.operational.items()
            },
            "quality_gate": {
                "verdict": self.quality_gate.verdict.value,
                "failures": self.quality_gate.failures,
                "warnings": self.quality_gate.warnings,
            } if self.quality_gate else None,
            "adversarial": {
                "pass_rate": self.adversarial.pass_rate,
                "pass_count": self.adversarial.pass_count,
                "num_probes": self.adversarial.num_probes,
            } if self.adversarial else None,
            "baseline_deltas": [d.to_dict() for d in self.baseline_deltas],
            "duration_ms": round(self.duration_ms, 2),
        }

    def to_json(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

    def to_summary(self) -> str:
        lines = [
            "=" * 70,
            "RAG EVALUATION PLATFORM REPORT",
            "=" * 70,
            f"Run ID:    {self.run_id}",
            f"Timestamp: {self.timestamp.isoformat()}",
            f"Dataset:   {self.parameters.dataset_name} v{self.parameters.dataset_version}",
            f"Samples:   {self.parameters.num_samples}",
            f"Duration:  {self.duration_ms:.0f} ms",
            "",
            "PIPELINE PARAMETERS",
            "-" * 40,
            f"  Retrieval:  {self.parameters.retrieval_mode} top_k={self.parameters.retrieval_top_k}",
            f"  Reranker:   {self.parameters.reranker}",
            f"  Context:    {self.parameters.context_strategy} max_tokens={self.parameters.context_max_tokens}",
            f"  Generation: {self.parameters.generation_model} style={self.parameters.generation_prompt_style}",
            f"  Judge:      {self.parameters.judge_model}",
            "",
            "AGGREGATE METRICS (RAG Triad + IR)",
            "-" * 40,
        ]

        metric_order = [
            ("retrieval_mrr", "Retrieval MRR"),
            ("retrieval_recall", "Retrieval Recall@K"),
            ("retrieval_precision", "Retrieval Precision@K"),
            ("rerank_mrr_lift", "Rerank MRR Lift"),
            ("context_precision", "Context Precision"),
            ("context_recall", "Context Recall"),
            ("faithfulness", "Faithfulness"),
            ("citation_precision", "Citation Precision"),
            ("hallucination_rate", "Hallucination Rate"),
            ("answer_relevancy", "Answer Relevancy"),
            ("adversarial_pass_rate", "Adversarial Pass Rate"),
        ]

        for key, label in metric_order:
            val = self.aggregate_metrics.get(key)
            if val is not None:
                dist = self.distributions.get(key)
                p10_str = f"  P10={dist.p10:.3f} P90={dist.p90:.3f}" if dist else ""
                lines.append(f"  {label:<25} {val:.4f}{p10_str}")

        if self.operational:
            lines.extend(["", "OPERATIONAL METRICS", "-" * 40])
            for key, val in sorted(self.operational.items()):
                lines.append(f"  {key:<30} {val:.1f}")

        if self.adversarial:
            lines.extend(["", "ADVERSARIAL PROBES", "-" * 40])
            lines.append(self.adversarial.to_summary())

        if self.quality_gate:
            lines.extend(["", "QUALITY GATE", "-" * 40])
            lines.append(self.quality_gate.to_summary())

        if self.baseline_deltas:
            lines.extend(["", "BASELINE COMPARISON", "-" * 40])
            for d in self.baseline_deltas:
                sig = " *" if d.significant else ""
                lines.append(
                    f"  {d.metric}: {d.current:.4f} → {d.baseline:.4f} "
                    f"({d.direction}, {d.delta_pct:+.1f}%){sig}"
                )

        lines.append("=" * 70)
        return "\n".join(lines)

    def to_baseline(self) -> BaselineMetrics:
        """Convert report to storable baseline."""
        return BaselineMetrics(
            name=self.parameters.dataset_name,
            version=self.parameters.dataset_version,
            timestamp=self.timestamp.isoformat(),
            metrics=self.aggregate_metrics,
            distributions={
                k: v.to_dict() for k, v in self.distributions.items()
            },
            parameters=self.parameters.to_dict(),
        )
