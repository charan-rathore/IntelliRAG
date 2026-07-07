"""Content-aware embedding backends for offline CI and local evaluation."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import List

import numpy as np


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall(text.lower())


class TfidfEmbedder:
    """Deterministic TF-IDF vectors for mock/offline retrieval benchmarks."""

    def __init__(self, dimensions: int = 768) -> None:
        self.dimensions = dimensions
        self._idf: dict[str, float] = {}
        self._vocab: dict[str, int] = {}

    def fit(self, texts: List[str]) -> None:
        doc_freq: Counter[str] = Counter()
        tokenized = [_tokenize(t) for t in texts]
        for tokens in tokenized:
            doc_freq.update(set(tokens))

        n_docs = max(len(texts), 1)
        sorted_terms = sorted(doc_freq.keys())
        self._vocab = {term: idx % self.dimensions for idx, term in enumerate(sorted_terms)}
        self._idf = {
            term: math.log((1 + n_docs) / (1 + freq)) + 1.0
            for term, freq in doc_freq.items()
        }

    def _vectorize(self, text: str) -> np.ndarray:
        tokens = _tokenize(text)
        if not tokens:
            return np.zeros(self.dimensions, dtype=np.float32)

        tf = Counter(tokens)
        vec = np.zeros(self.dimensions, dtype=np.float32)
        for term, count in tf.items():
            idx = self._vocab.get(term)
            if idx is None:
                idx = hash(term) % self.dimensions
            vec[idx] += count * self._idf.get(term, 1.0)

        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec

    def embed_batch(self, texts: List[str], **kwargs) -> np.ndarray:
        return np.vstack([self._vectorize(t) for t in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._vectorize(text)
