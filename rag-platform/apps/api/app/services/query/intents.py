"""Lightweight intent routing for interactive console queries.

Keeps greetings / capability asks / chit-chat off the slow RAG+Ollama path.
"""

from __future__ import annotations

import re
from enum import Enum


class QueryIntent(str, Enum):
    GREETING = "greeting"
    CAPABILITY = "capability"
    OFF_TOPIC = "off_topic"
    RAG = "rag"


_GREETING_RE = re.compile(
    r"^\s*("
    r"hi|hello|hey|yo|howdy|hola|"
    r"good\s+(morning|afternoon|evening)|"
    r"thanks|thank\s+you|thx|"
    r"ok|okay|cool|great|nice"
    r")[\s!.?]*$",
    re.IGNORECASE,
)

_CAPABILITY_RE = re.compile(
    r"("
    # "what can you do", "what else can you do for me", "what more should I ask"
    r"what(?:\s+\w+){0,3}\s+(can|could|should)\s+(i|you)\s+(ask|do|help|query|offer|cover)|"
    r"what\s+are\s+the\s+things|"
    r"^\s*what\s+(else|more)[\s?!.]*$|"
    r"what\s+(topics?|things|docs?|documents?|subjects?)\b|"
    r"what\s+is\s+this\s+(for|about)|"
    r"what\s+do\s+you\s+(know|cover|contain|do|support)|"
    r"how\s+can\s+you\s+help|"
    r"\b(help|capabilities|who\s+are\s+you)\b|"
    r"hey\s+what\s+can|"
    r"tell\s+me\s+what\s+you|"
    r"anything\s+else\s+you\s+can"
    r")",
    re.IGNORECASE,
)

# Clearly outside the indexed corpus — refuse fast without calling the LLM.
_OFF_TOPIC_RE = re.compile(
    r"("
    r"\b(weather|stock|crypto|bitcoin|joke|poem|recipe|sports?|"
    r"movie|celebrity|dating|homework|write\s+(me\s+)?(code|essay)|"
    r"translate|who\s+won|latest\s+news)\b"
    r")",
    re.IGNORECASE,
)

_EXAMPLE_QUESTIONS = {
    "k8s-incident": [
        "What caused the Kubernetes pod scheduling failures?",
        "How were the scheduling failures resolved?",
    ],
    "python-async": [
        "How should you manage the Python asyncio event loop?",
        "What is the recommended approach for aiohttp connection pooling?",
    ],
}


def classify_intent(question: str) -> QueryIntent:
    text = (question or "").strip()
    if not text:
        return QueryIntent.CAPABILITY
    if _GREETING_RE.match(text):
        return QueryIntent.GREETING
    if _CAPABILITY_RE.search(text):
        return QueryIntent.CAPABILITY
    if _OFF_TOPIC_RE.search(text) and len(text.split()) < 16:
        return QueryIntent.OFF_TOPIC
    # Very short non-question chatter without RAG substance
    tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())
    if len(tokens) <= 2 and tokens and tokens[0] in {
        "hey", "hi", "hello", "sup", "yo", "thanks", "bye",
    }:
        return QueryIntent.GREETING
    return QueryIntent.RAG


def example_questions_for(doc_id: str) -> list[str]:
    return list(_EXAMPLE_QUESTIONS.get(doc_id, []))
