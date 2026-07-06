# Phase 11: Observability Platform Architecture

## Problem Statement

Phases 1-10 built ingestion logging and evaluation gates, but production RAG requires unified operational visibility: per-layer latency, success rates, distributed tracing across the query pipeline, and span-attached eval scores wired from Phase 10 rubrics.

## Functional Requirements

1. Structured JSON logging with trace correlation (extends existing `libs/shared/logging`)
2. Metrics: success rates, failures, latency histograms per layer
3. Distributed tracing across retrieval → reranking → context → generation → eval
4. Operational dashboard with layer latency, eval scores, health, and recent traces
5. Health checks for Ollama, metrics registry, and system components
6. FastAPI endpoints: `/health`, `/metrics`, `/dashboard`, `/traces`
7. Span-attached eval scoring (same rubrics as Phase 10 CI gate)

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Overhead | <5ms observability tax per layer |
| Storage | In-memory (last 1000 traces); no external TSDB at current scale |
| Dependencies | Zero new required deps (uses existing FastAPI/uvicorn) |
| Dashboard refresh | 30s auto-refresh |

## Design Options

| Component | Options | Chosen | Rationale |
|---|---|---|---|
| Metrics backend | Prometheus, StatsD, in-memory | In-memory registry | Local-first; Prometheus text export ready |
| Tracing | OpenTelemetry, Jaeger, custom spans | Custom spans + trace_context | Zero deps; integrates with existing logging |
| Dashboard | Grafana, custom HTML, React SPA | Self-contained HTML | No infra; renders from live snapshot |
| Eval bridge | Separate monitoring, span-attached | Span-attached eval scores | Same rubric offline (CI) and online (prod) |

## Architecture

```
RAG Query
    │
    ▼
ObservedRAGPipeline
    │
    ├── Tracer (spans per layer)
    │     ├── retrieval span
    │     ├── reranking span
    │     ├── context_assembly span
    │     ├── generation span
    │     └── faithfulness_eval span (eval scores attached)
    │
    ├── MetricsRegistry
    │     ├── rag_queries_total (counter)
    │     ├── rag_errors_total (counter)
    │     ├── rag_layer_latency_ms (histogram per layer)
    │     ├── rag_e2e_latency_ms (histogram)
    │     └── rag_eval_{metric} (gauge)
    │
    ├── Structured JSON Logs (trace_id correlation)
    │
    └── ObservabilityCollector → Dashboard / API
```

## API Endpoints

| Endpoint | Format | Purpose |
|---|---|---|
| `GET /health` | JSON | Component health aggregation |
| `GET /metrics` | Prometheus text | Metrics scrape endpoint |
| `GET /metrics/json` | JSON | Metrics for dashboard |
| `GET /dashboard` | HTML | Operational dashboard |
| `GET /dashboard/json` | JSON | Dashboard panel data |
| `GET /traces` | JSON | Recent trace list |
| `GET /traces/{id}` | JSON | Single trace with all spans |
| `GET /observability/snapshot` | JSON | Full observability snapshot |

## Span-Attached Eval Scoring (Phase 10 Bridge)

Every production RAG query runs the same faithfulness rubric as CI:

```python
eval_scores = {
    "faithfulness": 0.85,
    "citation_precision": 0.80,
    "hallucination_rate": 0.15,
    "answer_relevancy": 0.72,
}
# Attached to generation span AND root trace span
span.set_eval_score("faithfulness", 0.85)
```

Low-scoring production traces can be fed to `FailureFeed` (Phase 10) for golden dataset growth.

## Metrics Catalog

| Metric | Type | Labels | Description |
|---|---|---|---|
| `rag_queries_total` | Counter | — | Total queries processed |
| `rag_errors_total` | Counter | — | Failed queries |
| `rag_success_rate` | Gauge | — | Rolling success rate |
| `rag_layer_latency_ms` | Histogram | layer | Per-layer latency distribution |
| `rag_e2e_latency_ms` | Histogram | — | End-to-end query latency |
| `rag_eval_{metric}` | Gauge | metric | Latest eval score per rubric |

## Failure Modes

| Failure | Mitigation |
|---|---|
| Trace memory growth | Cap at 1000 traces, FIFO eviction |
| Metrics cardinality explosion | Fixed label set per layer |
| Dashboard stale data | 30s auto-refresh; live snapshot on each request |
| Ollama health check timeout | 5s timeout; degraded (not unhealthy) status |

## Production Gap

| Local | Production | Upgrade Trigger |
|---|---|---|
| In-memory metrics | Prometheus + Grafana | >1000 QPS or multi-instance |
| In-memory traces | Jaeger/Tempo | Need cross-service tracing |
| Static HTML dashboard | Grafana dashboards | Team needs custom alerts |
| Sample-all eval scoring | 5-20% sampling | Eval cost too high at scale |

## Run Commands

```bash
# Demo instrumented queries
PYTHONPATH=rag-platform python scripts/observability/demo_observed_query.py

# Serve live dashboard
PYTHONPATH=rag-platform python scripts/observability/serve_dashboard.py --port 8080

# Run tests
PYTHONPATH=rag-platform python -m pytest libs/observability/tests/ -v
```
