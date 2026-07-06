"""Tests for observability platform."""

from __future__ import annotations

import tempfile
from pathlib import Path

from libs.observability.collector import ObservabilityCollector
from libs.observability.dashboard import Dashboard
from libs.observability.health import HealthChecker, HealthStatus
from libs.observability.metrics import MetricsRegistry, reset_registry
from libs.observability.pipeline import ObservedRAGPipeline
from libs.observability.tracing import Tracer, SpanContext, clear_traces, get_recent_traces
from libs.rag.generation.ollama import MockLLMClient
from libs.rag.generation.service import GenerationService


class TestMetrics:
    def setup_method(self):
        reset_registry()

    def test_counter_increments(self):
        registry = MetricsRegistry()
        c = registry.counter("test_total")
        c.inc()
        c.inc(5)
        assert c.value == 6

    def test_histogram_percentiles(self):
        registry = MetricsRegistry()
        h = registry.histogram("latency_ms")
        for v in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]:
            h.observe(v)
        assert h.percentile(50) == 55.0
        assert h.count == 10

    def test_prometheus_export(self):
        registry = MetricsRegistry()
        registry.counter("queries_total").inc(42)
        text = registry.to_prometheus_text()
        assert "queries_total" in text
        assert "42" in text


class TestTracing:
    def setup_method(self):
        clear_traces()

    def test_root_trace(self):
        tracer = Tracer("test")
        with SpanContext(tracer, "test_query", is_root=True) as span:
            assert span.trace_id
            with SpanContext(tracer, "retrieval") as child:
                child.set_attribute("chunks", 5)

        traces = get_recent_traces()
        assert len(traces) == 1
        assert len(traces[0].spans) == 2

    def test_eval_scores_on_span(self):
        tracer = Tracer("test")
        with SpanContext(tracer, "rag_query", is_root=True) as root:
            root.set_eval_score("faithfulness", 0.85)
            root.set_eval_score("hallucination_rate", 0.1)

        trace = get_recent_traces()[-1]
        root_span = trace.spans[0]
        assert root_span.eval_scores["faithfulness"] == 0.85

    def test_error_span_status(self):
        tracer = Tracer("test")
        try:
            with SpanContext(tracer, "failing_op", is_root=True):
                raise ValueError("test error")
        except ValueError:
            pass
        trace = get_recent_traces()[-1]
        assert trace.status == "error"


class TestHealth:
    def test_health_checker(self):
        checker = HealthChecker()
        checker.register("test", lambda: __import__(
            "libs.observability.health", fromlist=["ComponentHealth"]
        ).ComponentHealth(name="test", status=HealthStatus.HEALTHY))
        result = checker.check_all()
        assert result.status == HealthStatus.HEALTHY
        assert len(result.components) == 1

    def test_metrics_health(self):
        registry = MetricsRegistry()
        registry.counter("test").inc()
        health = HealthChecker.check_metrics_registry(registry)
        assert health.status == HealthStatus.HEALTHY


class TestCollector:
    def setup_method(self):
        reset_registry()
        clear_traces()

    def test_snapshot(self):
        collector = ObservabilityCollector()
        collector.record_query(success=True)
        collector.record_layer_latency("retrieval", 15.0)
        collector.record_eval_score("faithfulness", 0.9)

        snap = collector.snapshot()
        assert snap.summary["total_queries"] == 1
        assert snap.summary["success_rate"] == 1.0
        assert "faithfulness" in str(snap.metrics)


class TestDashboard:
    def setup_method(self):
        reset_registry()

    def test_build_panels(self):
        collector = ObservabilityCollector()
        collector.record_query(success=True)
        dashboard = Dashboard(collector)
        panels = dashboard.build_panels()
        assert "panels" in panels
        assert len(panels["panels"]) >= 4

    def test_html_generation(self):
        collector = ObservabilityCollector()
        dashboard = Dashboard(collector)
        html = dashboard.to_html()
        assert "RAG Platform Dashboard" in html
        assert "<html" in html


class TestObservabilityAPI:
    def test_fastapi_endpoints(self):
        from libs.observability.api import create_observability_app
        from fastapi.testclient import TestClient

        reset_registry()
        clear_traces()
        app = create_observability_app()
        client = TestClient(app)

        resp = client.get("/health")
        assert resp.status_code == 200
        assert "status" in resp.json()

        resp = client.get("/metrics")
        assert resp.status_code == 200

        resp = client.get("/dashboard")
        assert resp.status_code == 200
        assert "RAG Platform Dashboard" in resp.text

        resp = client.get("/dashboard/json")
        assert resp.status_code == 200
        assert "panels" in resp.json()


class TestObservedPipeline:
    def setup_method(self):
        reset_registry()
        clear_traces()

    def test_instrumented_query(self):
        from scripts.eval.pipeline_builder import build_eval_pipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            handles = build_eval_pipeline(tmpdir)
            handles.generation_service = GenerationService(llm_client=MockLLMClient())

            pipeline = ObservedRAGPipeline(
                retrieval_service=handles.retrieval_service,
                reranking_service=handles.reranking_service,
                context_service=handles.context_service,
                generation_service=handles.generation_service,
                faithfulness_evaluator=handles.faithfulness_evaluator,
            )

            result = pipeline.query(
                "What caused the Kubernetes pod scheduling failures?"
            )

            assert result.answer
            assert result.trace_id
            assert result.total_latency_ms > 0
            assert "retrieval" in result.layer_latencies
            assert "generation" in result.layer_latencies
            assert "faithfulness" in result.eval_scores

            traces = get_recent_traces()
            assert len(traces) >= 1
            assert traces[-1].spans[-1].name in (
                "faithfulness_eval", "generation", "rag_query",
            )
