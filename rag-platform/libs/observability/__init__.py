"""RAG platform observability: metrics, tracing, health, and dashboards."""

from .metrics import (
    Counter, Gauge, Histogram, MetricsRegistry,
    get_registry, reset_registry,
)
from .tracing import Tracer, Span, Trace, SpanContext, get_recent_traces, clear_traces
from .health import HealthChecker, HealthStatus, SystemHealth, ComponentHealth
from .collector import ObservabilityCollector, ObservabilitySnapshot
from .pipeline import ObservedRAGPipeline, ObservedQueryResult
from .dashboard import Dashboard
from .api import create_observability_app

__all__ = [
    "Counter", "Gauge", "Histogram", "MetricsRegistry",
    "get_registry", "reset_registry",
    "Tracer", "Span", "Trace", "SpanContext",
    "get_recent_traces", "clear_traces",
    "HealthChecker", "HealthStatus", "SystemHealth", "ComponentHealth",
    "ObservabilityCollector", "ObservabilitySnapshot",
    "ObservedRAGPipeline", "ObservedQueryResult",
    "Dashboard",
    "create_observability_app",
]
