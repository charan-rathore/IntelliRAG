"""Tests for Query API."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.app.api.v1.query import router as query_router
from apps.api.app.services.query.intents import QueryIntent, classify_intent
from apps.api.app.services.query.service import QueryService

app = FastAPI()
app.include_router(query_router)
client = TestClient(app)


def setup_function() -> None:
    QueryService.reset()


def test_intent_routing_variants():
    assert classify_intent("hey") is QueryIntent.GREETING
    assert classify_intent("hey what can you do for me") is QueryIntent.CAPABILITY
    assert classify_intent("what can you do") is QueryIntent.CAPABILITY
    assert classify_intent("tell me a joke") is QueryIntent.OFF_TOPIC
    assert (
        classify_intent("What caused the Kubernetes pod scheduling failures?")
        is QueryIntent.RAG
    )


def test_query_endpoint_returns_answer(monkeypatch):
    monkeypatch.setenv("RAG_USE_OLLAMA", "false")
    QueryService.reset()
    response = client.post(
        "/query",
        json={
            "question": "What caused the Kubernetes pod scheduling failures?",
            "include_eval_scores": True,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["query"]
    assert data["answer"]
    assert data["trace_id"]
    assert "retrieval" in data["layer_latencies_ms"]
    assert data["citations"]
    assert data["citations"][0].get("url")


def test_greeting_is_instant_and_distinct(monkeypatch):
    monkeypatch.setenv("RAG_USE_OLLAMA", "false")
    QueryService.reset()
    response = client.post("/query", json={"question": "hey"})
    assert response.status_code == 200
    data = response.json()
    assert data["model"] == "console-guide"
    assert data["total_latency_ms"] == 0.0
    assert "IntelliRAG" in data["answer"]


def test_capability_question_lists_topics(monkeypatch):
    monkeypatch.setenv("RAG_USE_OLLAMA", "false")
    QueryService.reset()
    response = client.post(
        "/query",
        json={"question": "hey what can you do for me"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["model"] == "console-guide"
    assert "/sources/k8s-incident" in data["answer"]
    assert "asyncio" in data["answer"].lower()
    assert data["total_latency_ms"] == 0.0


def test_query_health(monkeypatch):
    monkeypatch.setenv("RAG_USE_OLLAMA", "false")
    QueryService.reset()
    response = client.get("/query/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in ("ready", "degraded")
    assert "llm_backend" in body
    assert "sources" in body


def test_stream_capability_is_instant(monkeypatch):
    monkeypatch.setenv("RAG_USE_OLLAMA", "false")
    QueryService.reset()
    with client.stream(
        "POST",
        "/query/stream",
        json={"question": "what else can you do for me"},
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())
    assert "event: done" in body
    assert "console-guide" in body
    assert "/sources/k8s-incident" in body


def test_stream_rag_emits_tokens(monkeypatch):
    monkeypatch.setenv("RAG_USE_OLLAMA", "false")
    QueryService.reset()
    with client.stream(
        "POST",
        "/query/stream",
        json={"question": "What caused the Kubernetes pod scheduling failures?"},
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())
    assert "event: stage" in body
    assert "event: token" in body or "event: done" in body
    assert "event: done" in body
    assert "Source" in body or "fragmentation" in body.lower()
