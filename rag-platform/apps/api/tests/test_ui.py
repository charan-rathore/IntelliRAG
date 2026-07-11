"""Tests for IntelliRAG query console static UI."""

from __future__ import annotations

from fastapi.testclient import TestClient

from apps.api.app.main import app

client = TestClient(app)


def test_ui_index_served():
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "IntelliRAG" in response.text


def test_ui_assets_served():
    css = client.get("/assets/styles.css")
    js = client.get("/assets/app.js")
    assert css.status_code == 200
    assert "text/css" in css.headers["content-type"]
    assert js.status_code == 200
    assert "Ask" in js.text or "query" in js.text
