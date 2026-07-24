"""Tests for interactive intent routing."""

from __future__ import annotations

from apps.api.app.services.query.intents import QueryIntent, classify_intent


def test_greetings():
    for q in ("hi", "Hey!", "good morning", "thanks"):
        assert classify_intent(q) is QueryIntent.GREETING


def test_capability_phrases():
    for q in (
        "what can you do for me",
        "hey what can you do for me",
        "what else can you do for me",
        "what else can you do",
        "how can you help",
        "what topics do you cover",
        "what more should I ask",
        "help",
        "anything else you can do",
    ):
        assert classify_intent(q) is QueryIntent.CAPABILITY, q


def test_off_topic():
    assert classify_intent("what's the weather") is QueryIntent.OFF_TOPIC
    assert classify_intent("tell me a joke") is QueryIntent.OFF_TOPIC


def test_rag_questions_untouched():
    assert (
        classify_intent("What caused the Kubernetes pod scheduling failures?")
        is QueryIntent.RAG
    )
    assert (
        classify_intent("What else caused the pod scheduling failures?")
        is QueryIntent.RAG
    )
