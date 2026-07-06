"""Retrieval layer for the RAG platform.

Provides dense, keyword, and hybrid retrieval with benchmark evaluation.
"""

from .models import RetrievedChunk, RetrievalResult
from .dense import DenseRetriever
from .keyword import KeywordRetriever, BM25Index, tokenize
from .hybrid import HybridRetriever
from .service import RetrievalService

__all__ = [
    "RetrievedChunk",
    "RetrievalResult",
    "DenseRetriever",
    "KeywordRetriever",
    "BM25Index",
    "tokenize",
    "HybridRetriever",
    "RetrievalService",
]
