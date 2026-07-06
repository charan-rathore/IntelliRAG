"""Baseline storage and delta comparison for regression detection."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class BaselineMetrics:
    """Stored baseline metric values from a known-good run."""

    name: str
    version: str
    timestamp: str
    metrics: Dict[str, float] = field(default_factory=dict)
    distributions: Dict[str, Dict[str, float]] = field(default_factory=dict)
    parameters: Dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "version": self.version,
            "timestamp": self.timestamp,
            "metrics": self.metrics,
            "distributions": self.distributions,
            "parameters": self.parameters,
        }

    def to_json(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def from_json(cls, path: str | Path) -> "BaselineMetrics":
        with open(path) as f:
            data = json.load(f)
        return cls(
            name=data["name"],
            version=data["version"],
            timestamp=data["timestamp"],
            metrics=data.get("metrics", {}),
            distributions=data.get("distributions", {}),
            parameters=data.get("parameters", {}),
        )


@dataclass
class DeltaResult:
    """Comparison of current metrics against baseline."""

    metric: str
    current: float
    baseline: float
    delta: float
    delta_pct: float
    significant: bool
    direction: str  # "improved", "degraded", "stable"

    def to_dict(self) -> Dict:
        return {
            "metric": self.metric,
            "current": round(self.current, 4),
            "baseline": round(self.baseline, 4),
            "delta": round(self.delta, 4),
            "delta_pct": round(self.delta_pct, 2),
            "significant": self.significant,
            "direction": self.direction,
        }


def welch_t_test(sample_a: List[float], sample_b: List[float]) -> tuple[float, bool]:
    """Welch's t-test for delta significance. Returns (t_stat, is_significant at p<0.05)."""
    if len(sample_a) < 2 or len(sample_b) < 2:
        return 0.0, False

    mean_a = sum(sample_a) / len(sample_a)
    mean_b = sum(sample_b) / len(sample_b)
    var_a = sum((x - mean_a) ** 2 for x in sample_a) / (len(sample_a) - 1)
    var_b = sum((x - mean_b) ** 2 for x in sample_b) / (len(sample_b) - 1)

    se = math.sqrt(var_a / len(sample_a) + var_b / len(sample_b))
    if se == 0:
        return 0.0, False

    t_stat = (mean_a - mean_b) / se

    # Approximate: |t| > 2.0 → significant at ~p<0.05 for reasonable sample sizes
    return t_stat, abs(t_stat) > 2.0


class BaselineStore:
    """Persist and compare evaluation baselines."""

    def __init__(self, baseline_dir: str | Path) -> None:
        self.baseline_dir = Path(baseline_dir)
        self.baseline_dir.mkdir(parents=True, exist_ok=True)

    def save(self, baseline: BaselineMetrics, filename: str = "latest.json") -> Path:
        path = self.baseline_dir / filename
        baseline.to_json(path)
        return path

    def load(self, filename: str = "latest.json") -> Optional[BaselineMetrics]:
        path = self.baseline_dir / filename
        if not path.exists():
            return None
        return BaselineMetrics.from_json(path)

    def compare(
        self,
        current_metrics: Dict[str, float],
        baseline: BaselineMetrics,
        current_samples: Optional[Dict[str, List[float]]] = None,
        baseline_samples: Optional[Dict[str, List[float]]] = None,
        significance_threshold: float = 0.05,
    ) -> List[DeltaResult]:
        """Compare current metrics against stored baseline."""
        results = []
        for metric, current_val in current_metrics.items():
            baseline_val = baseline.metrics.get(metric)
            if baseline_val is None:
                continue

            delta = current_val - baseline_val
            delta_pct = (delta / baseline_val * 100) if baseline_val != 0 else 0.0

            significant = False
            if current_samples and baseline_samples:
                if metric in current_samples and metric in baseline_samples:
                    _, significant = welch_t_test(
                        current_samples[metric], baseline_samples[metric]
                    )

            if abs(delta) < 0.01:
                direction = "stable"
            elif delta > 0:
                direction = "improved" if metric != "hallucination_rate" else "degraded"
            else:
                direction = "degraded" if metric != "hallucination_rate" else "improved"

            results.append(
                DeltaResult(
                    metric=metric,
                    current=current_val,
                    baseline=baseline_val,
                    delta=delta,
                    delta_pct=delta_pct,
                    significant=significant,
                    direction=direction,
                )
            )
        return results
