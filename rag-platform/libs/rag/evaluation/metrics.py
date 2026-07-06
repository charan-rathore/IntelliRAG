"""Distribution metrics for RAG evaluation.

Best practice: track distributions, not just averages.
A 0.85 faithfulness average with P10=0.20 means 10% of answers are severely unfaithful.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence


@dataclass
class DistributionStats:
    """Statistical summary of a metric across samples."""

    name: str
    count: int
    mean: float
    min: float
    max: float
    p10: float
    p50: float
    p90: float
    p95: float
    std: float
    pass_rate: float = 0.0
    pass_threshold: Optional[float] = None

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "count": self.count,
            "mean": round(self.mean, 4),
            "min": round(self.min, 4),
            "max": round(self.max, 4),
            "p10": round(self.p10, 4),
            "p50": round(self.p50, 4),
            "p90": round(self.p90, 4),
            "p95": round(self.p95, 4),
            "std": round(self.std, 4),
            "pass_rate": round(self.pass_rate, 4),
            "pass_threshold": self.pass_threshold,
        }


def _percentile(sorted_values: List[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    k = (len(sorted_values) - 1) * p / 100.0
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_values[int(k)]
    return sorted_values[f] * (c - k) + sorted_values[c] * (k - f)


def compute_distribution(
    values: Sequence[float],
    name: str,
    pass_threshold: Optional[float] = None,
    higher_is_better: bool = True,
) -> DistributionStats:
    """Compute distribution statistics for a metric."""
    if not values:
        return DistributionStats(
            name=name, count=0, mean=0.0, min=0.0, max=0.0,
            p10=0.0, p50=0.0, p90=0.0, p95=0.0, std=0.0,
            pass_rate=0.0, pass_threshold=pass_threshold,
        )

    sorted_vals = sorted(values)
    n = len(sorted_vals)
    mean = sum(sorted_vals) / n
    variance = sum((v - mean) ** 2 for v in sorted_vals) / n
    std = math.sqrt(variance)

    pass_rate = 0.0
    if pass_threshold is not None:
        if higher_is_better:
            pass_rate = sum(1 for v in sorted_vals if v >= pass_threshold) / n
        else:
            pass_rate = sum(1 for v in sorted_vals if v <= pass_threshold) / n

    return DistributionStats(
        name=name,
        count=n,
        mean=mean,
        min=sorted_vals[0],
        max=sorted_vals[-1],
        p10=_percentile(sorted_vals, 10),
        p50=_percentile(sorted_vals, 50),
        p90=_percentile(sorted_vals, 90),
        p95=_percentile(sorted_vals, 95),
        std=std,
        pass_rate=pass_rate,
        pass_threshold=pass_threshold,
    )


@dataclass
class LayerMetrics:
    """Metrics for a single pipeline layer."""

    layer: str
    distributions: Dict[str, DistributionStats] = field(default_factory=dict)
    avg_latency_ms: float = 0.0
    total_latency_ms: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "layer": self.layer,
            "distributions": {k: v.to_dict() for k, v in self.distributions.items()},
            "avg_latency_ms": round(self.avg_latency_ms, 2),
            "total_latency_ms": round(self.total_latency_ms, 2),
        }
