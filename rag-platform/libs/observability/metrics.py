"""In-memory metrics registry (Prometheus-compatible export).

Local-first: no external Prometheus/Grafana required at current scale.
Tracks counters, gauges, and histograms for RAG pipeline operations.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class MetricSample:
    """A single metric observation."""

    name: str
    value: float
    labels: Dict[str, str] = field(default_factory=dict)
    metric_type: str = "counter"
    timestamp: float = field(default_factory=time.time)


class Counter:
    """Monotonically increasing counter."""

    def __init__(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None):
        self.name = name
        self.description = description
        self._labels = labels or {}
        self._value = 0.0
        self._lock = threading.Lock()

    def inc(self, amount: float = 1.0) -> None:
        with self._lock:
            self._value += amount

    @property
    def value(self) -> float:
        return self._value

    def to_sample(self) -> MetricSample:
        return MetricSample(
            name=self.name,
            value=self._value,
            labels=self._labels,
            metric_type="counter",
        )


class Gauge:
    """Value that can go up and down."""

    def __init__(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None):
        self.name = name
        self.description = description
        self._labels = labels or {}
        self._value = 0.0
        self._lock = threading.Lock()

    def set(self, value: float) -> None:
        with self._lock:
            self._value = value

    def inc(self, amount: float = 1.0) -> None:
        with self._lock:
            self._value += amount

    def dec(self, amount: float = 1.0) -> None:
        with self._lock:
            self._value -= amount

    @property
    def value(self) -> float:
        return self._value

    def to_sample(self) -> MetricSample:
        return MetricSample(
            name=self.name,
            value=self._value,
            labels=self._labels,
            metric_type="gauge",
        )


class Histogram:
    """Latency/duration distribution tracker with percentile computation."""

    DEFAULT_BUCKETS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)

    def __init__(
        self,
        name: str,
        description: str = "",
        labels: Optional[Dict[str, str]] = None,
        buckets: Tuple[float, ...] = DEFAULT_BUCKETS,
    ):
        self.name = name
        self.description = description
        self._labels = labels or {}
        self._buckets = buckets
        self._observations: List[float] = []
        self._sum = 0.0
        self._count = 0
        self._lock = threading.Lock()

    def observe(self, value: float) -> None:
        with self._lock:
            self._observations.append(value)
            self._sum += value
            self._count += 1

    @property
    def count(self) -> int:
        return self._count

    @property
    def sum(self) -> float:
        return self._sum

    def percentile(self, p: float) -> float:
        with self._lock:
            if not self._observations:
                return 0.0
            sorted_obs = sorted(self._observations)
            k = (len(sorted_obs) - 1) * p / 100.0
            f = math.floor(k)
            c = math.ceil(k)
            if f == c:
                return sorted_obs[int(k)]
            return sorted_obs[f] * (c - k) + sorted_obs[c] * (k - f)

    def to_sample(self) -> MetricSample:
        return MetricSample(
            name=self.name,
            value=self.percentile(50),
            labels={**self._labels, "stat": "p50"},
            metric_type="histogram",
        )


class MetricsRegistry:
    """Central registry for all platform metrics."""

    def __init__(self) -> None:
        self._counters: Dict[str, Counter] = {}
        self._gauges: Dict[str, Gauge] = {}
        self._histograms: Dict[str, Histogram] = {}
        self._lock = threading.Lock()

    def counter(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None) -> Counter:
        key = self._key(name, labels)
        with self._lock:
            if key not in self._counters:
                self._counters[key] = Counter(name, description, labels)
            return self._counters[key]

    def gauge(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None) -> Gauge:
        key = self._key(name, labels)
        with self._lock:
            if key not in self._gauges:
                self._gauges[key] = Gauge(name, description, labels)
            return self._gauges[key]

    def histogram(
        self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None
    ) -> Histogram:
        key = self._key(name, labels)
        with self._lock:
            if key not in self._histograms:
                self._histograms[key] = Histogram(name, description, labels)
            return self._histograms[key]

    def all_samples(self) -> List[MetricSample]:
        samples = []
        with self._lock:
            for c in self._counters.values():
                samples.append(c.to_sample())
            for g in self._gauges.values():
                samples.append(g.to_sample())
            for h in self._histograms.values():
                samples.append(h.to_sample())
                samples.append(MetricSample(
                    name=h.name, value=h.percentile(95),
                    labels={**h._labels, "stat": "p95"}, metric_type="histogram",
                ))
                samples.append(MetricSample(
                    name=h.name, value=h.count,
                    labels={**h._labels, "stat": "count"}, metric_type="histogram",
                ))
        return samples

    def to_prometheus_text(self) -> str:
        lines = []
        for sample in self.all_samples():
            label_str = ""
            if sample.labels:
                parts = [f'{k}="{v}"' for k, v in sorted(sample.labels.items())]
                label_str = "{" + ",".join(parts) + "}"
            lines.append(f"{sample.name}{label_str} {sample.value}")
        return "\n".join(lines) + "\n"

    def to_dict(self) -> Dict:
        return {
            "counters": {k: c.value for k, c in self._counters.items()},
            "gauges": {k: g.value for k, g in self._gauges.items()},
            "histograms": {
                k: {
                    "p50": h.percentile(50),
                    "p95": h.percentile(95),
                    "count": h.count,
                    "sum": h.sum,
                }
                for k, h in self._histograms.items()
            },
        }

    @staticmethod
    def _key(name: str, labels: Optional[Dict[str, str]]) -> str:
        if not labels:
            return name
        label_part = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_part}}}"


# Global singleton for the platform
_global_registry = MetricsRegistry()


def get_registry() -> MetricsRegistry:
    return _global_registry


def reset_registry() -> None:
    global _global_registry
    _global_registry = MetricsRegistry()
