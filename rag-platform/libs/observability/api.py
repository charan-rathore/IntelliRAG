"""FastAPI endpoints for observability (metrics, health, dashboard)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, PlainTextResponse

from .collector import ObservabilityCollector
from .dashboard import Dashboard
from .health import HealthChecker
from .metrics import get_registry


def create_observability_app(
    collector: ObservabilityCollector | None = None,
) -> FastAPI:
    """Create FastAPI app with observability endpoints."""
    collector = collector or ObservabilityCollector()
    dashboard = Dashboard(collector)
    app = FastAPI(title="RAG Platform Observability", version="0.1.0")

    @app.get("/health")
    def health():
        return collector.health.check_all().to_dict()

    @app.get("/metrics", response_class=PlainTextResponse)
    def metrics():
        return get_registry().to_prometheus_text()

    @app.get("/metrics/json")
    def metrics_json():
        return get_registry().to_dict()

    @app.get("/observability/snapshot")
    def snapshot():
        return collector.snapshot().to_dict()

    @app.get("/dashboard", response_class=HTMLResponse)
    def dashboard_html():
        return dashboard.to_html()

    @app.get("/dashboard/json")
    def dashboard_json():
        return dashboard.build_panels()

    @app.get("/traces")
    def traces(limit: int = 20):
        from .tracing import get_recent_traces
        return [t.to_dict() for t in get_recent_traces(limit)]

    @app.get("/traces/{trace_id}")
    def trace_detail(trace_id: str):
        from .tracing import Tracer
        trace = Tracer().get_trace(trace_id)
        if trace is None:
            return {"error": "trace not found"}
        return trace.to_dict()

    return app
