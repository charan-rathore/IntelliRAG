"""Observability collector: aggregates metrics, traces, and health."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

from .health import HealthChecker, SystemHealth
from .metrics import MetricsRegistry, get_registry
from .tracing import Trace, Tracer, get_recent_traces


@dataclass
class ObservabilitySnapshot:
    """Point-in-time snapshot of all observability data."""

    timestamp: str
    metrics: Dict
    traces: List[Dict]
    health: Optional[Dict] = None
    summary: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "timestamp": self.timestamp,
            "metrics": self.metrics,
            "traces": self.traces,
            "health": self.health,
            "summary": self.summary,
        }


class ObservabilityCollector:
    """Central collector for metrics, traces, and health checks."""

    def __init__(
        self,
        registry: Optional[MetricsRegistry] = None,
        tracer: Optional[Tracer] = None,
        health_checker: Optional[HealthChecker] = None,
    ) -> None:
        self.registry = registry or get_registry()
        self.tracer = tracer or Tracer()
        self.health = health_checker or HealthChecker()
        self._query_count = 0
        self._error_count = 0

        self.health.register("metrics", lambda: HealthChecker.check_metrics_registry(self.registry))

    def record_query(self, success: bool = True) -> None:
        self._query_count += 1
        if not success:
            self._error_count += 1
        self.registry.counter("rag_queries_total").inc()
        if not success:
            self.registry.counter("rag_errors_total").inc()
        self.registry.gauge("rag_success_rate").set(
            (self._query_count - self._error_count) / max(self._query_count, 1)
        )

    def record_layer_latency(self, layer: str, latency_ms: float, success: bool = True) -> None:
        labels = {"layer": layer}
        self.registry.histogram(
            "rag_layer_latency_ms", "Layer latency in milliseconds", labels
        ).observe(latency_ms)
        self.registry.counter(
            "rag_layer_requests_total", labels={**labels, "status": "ok" if success else "error"}
        ).inc()

    def record_eval_score(self, metric: str, value: float) -> None:
        self.registry.gauge(
            f"rag_eval_{metric}", labels={"metric": metric}
        ).set(value)

    def snapshot(self, include_health: bool = True) -> ObservabilitySnapshot:
        traces = [t.to_dict() for t in get_recent_traces(20)]
        health_data = self.health.check_all().to_dict() if include_health else None

        metrics_dict = self.registry.to_dict()
        summary = self._build_summary(metrics_dict, traces)

        return ObservabilitySnapshot(
            timestamp=datetime.now(timezone.utc).isoformat(),
            metrics=metrics_dict,
            traces=traces,
            health=health_data,
            summary=summary,
        )

    def _build_summary(self, metrics: Dict, traces: List[Dict]) -> Dict:
        histograms = metrics.get("histograms", {})
        layer_latencies = {}
        for key, data in histograms.items():
            if "rag_layer_latency_ms" in key:
                layer = key.split("layer=")[-1].rstrip("}") if "layer=" in key else "unknown"
                layer_latencies[layer] = data

        error_traces = [t for t in traces if t.get("status") == "error"]
        return {
            "total_queries": self._query_count,
            "total_errors": self._error_count,
            "success_rate": round(
                (self._query_count - self._error_count) / max(self._query_count, 1), 4
            ),
            "recent_trace_count": len(traces),
            "error_trace_count": len(error_traces),
            "layer_latencies": layer_latencies,
        }
