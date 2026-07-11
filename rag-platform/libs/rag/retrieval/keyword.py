"""Keyword retrieval using BM25 scoring."""

from __future__ import annotations

import logging
import math
import re
import time
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from .models import RetrievedChunk, RetrievalResult

logger = logging.getLogger(__name__)

TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> List[str]:
    """Lowercase alphanumeric tokenization."""
    return TOKEN_PATTERN.findall(text.lower())


class BM25Index:
    """In-memory BM25 index for keyword retrieval."""

    def __init__(
        self,
        chunks: List[Tuple[str, str]],
        k1: float = 1.5,
        b: float = 0.75,
    ) -> None:
        self.k1 = k1
        self.b = b
        self.chunk_ids: List[str] = []
        self.texts: List[str] = []
        self.tokenized_docs: List[List[str]] = []
        self.doc_lengths: List[int] = []
        self.avg_doc_length = 0.0
        self.doc_freq: Dict[str, int] = {}
        self.total_docs = 0

        for chunk_id, text in chunks:
            tokens = tokenize(text)
            if not tokens:
                continue
            self.chunk_ids.append(chunk_id)
            self.texts.append(text)
            self.tokenized_docs.append(tokens)
            self.doc_lengths.append(len(tokens))

        self.total_docs = len(self.tokenized_docs)
        if self.total_docs == 0:
            return

        self.avg_doc_length = sum(self.doc_lengths) / self.total_docs
        for tokens in self.tokenized_docs:
            for term in set(tokens):
                self.doc_freq[term] = self.doc_freq.get(term, 0) + 1

    def search(self, query: str, top_k: int = 10) -> List[Tuple[str, str, float]]:
        """Return top-k (chunk_id, text, score) tuples."""
        if self.total_docs == 0:
            return []

        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        scores: List[Tuple[int, float]] = []
        for doc_idx, doc_tokens in enumerate(self.tokenized_docs):
            score = self._score_document(query_tokens, doc_tokens, self.doc_lengths[doc_idx])
            if score > 0:
                scores.append((doc_idx, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        results = []
        for doc_idx, score in scores[:top_k]:
            results.append((self.chunk_ids[doc_idx], self.texts[doc_idx], score))
        return results

    def _score_document(
        self,
        query_tokens: List[str],
        doc_tokens: List[str],
        doc_length: int,
    ) -> float:
        term_counts = Counter(doc_tokens)
        score = 0.0
        for term in query_tokens:
            if term not in self.doc_freq:
                continue
            tf = term_counts.get(term, 0)
            if tf == 0:
                continue
            idf = math.log(
                1 + (self.total_docs - self.doc_freq[term] + 0.5)
                / (self.doc_freq[term] + 0.5)
            )
            numerator = tf * (self.k1 + 1)
            denominator = tf + self.k1 * (
                1 - self.b + self.b * doc_length / self.avg_doc_length
            )
            score += idf * numerator / denominator
        return score


class KeywordRetriever:
    """BM25 keyword retriever backed by an in-memory index."""

    def __init__(
        self,
        chunks: List[Tuple[str, str]],
        chunk_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        self._index = BM25Index(chunks)
        self._chunk_metadata = chunk_metadata or {}

    @classmethod
    def from_chunk_rows(cls, rows: List[dict]) -> "KeywordRetriever":
        """Build retriever from Postgres chunk rows."""
        chunks = [(str(row["chunk_id"]), row["chunk_text"]) for row in rows]
        return cls(chunks)

    def retrieve(
        self,
        query: str,
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> RetrievalResult:
        """Retrieve top-k chunks by BM25 score."""
        start = time.time()
        results = self._index.search(query, top_k=top_k * 4 if filter_metadata else top_k)
        if filter_metadata:
            results = [
                item for item in results
                if self._matches_filter(item[0], filter_metadata)
            ][:top_k]
        latency_ms = (time.time() - start) * 1000

        retrieved = [
            RetrievedChunk(
                chunk_id=chunk_id,
                text=text,
                score=score,
                rank=i + 1,
                retriever="keyword",
                metadata=self._chunk_metadata.get(chunk_id, {}),
            )
            for i, (chunk_id, text, score) in enumerate(results)
        ]

        return RetrievalResult(
            query=query,
            chunks=retrieved,
            retriever="keyword",
            latency_ms=latency_ms,
            total_candidates=len(retrieved),
        )

    def _matches_filter(self, chunk_id: str, filter_metadata: Dict[str, Any]) -> bool:
        meta = self._chunk_metadata.get(chunk_id, {})
        return all(meta.get(k) == v for k, v in filter_metadata.items())

    def refresh(
        self,
        chunks: List[Tuple[str, str]],
        chunk_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        """Rebuild the index with new chunks."""
        self._index = BM25Index(chunks)
        if chunk_metadata is not None:
            self._chunk_metadata = chunk_metadata
