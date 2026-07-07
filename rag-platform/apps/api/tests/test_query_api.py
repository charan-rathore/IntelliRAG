"""Tests for Query API."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.app.api.v1.query import router as query_router

app = FastAPI()
app.include_router(query_router)
client = TestClient(app)


def test_query_endpoint_returns_answer():
    response = client.post(
        "/query",
        json={"question": "What caused the Kubernetes pod scheduling failures?"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["query"]
    assert data["answer"]
    assert data["trace_id"]
    assert "retrieval" in data["layer_latencies_ms"]


def test_query_health():
    response = client.get("/query/health")
    assert response.status_code == 200
    assert response.json()["status"] in ("ready", "degraded")
