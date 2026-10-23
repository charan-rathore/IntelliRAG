"""Keyword retrieval using BM25 scoring."""

from __future__ import annotations

import logging
import math
import time
import unicodedata
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from .models import RetrievedChunk, RetrievalResult

logger = logging.getLogger(__name__)

# Scripts whose writing omits spaces between words (Han ideographs,
# Japanese kana, Thai, Lao, Khmer, Burmese): a run of them cannot rely on
# word boundaries, so they tokenize per character plus overlapping bigrams
# so multi-character queries still match adjacent characters.
_NGRAM_SCRIPTS = frozenset({"CJK", "HIRAGANA", "KATAKANA", "THAI", "LAO", "KHMER", "MYANMAR"})

# Kanji and kana mix inside single Japanese words ("食べる"), so contiguous
# segments of these scripts tokenize as one run - otherwise no bigram spans
# the boundary and a punctuated decoy scores the same as the real word.
_JAPANESE_SCRIPTS = frozenset({"CJK", "HIRAGANA", "KATAKANA"})

# Japanese iteration/prolonged marks whose Unicode names fall outside the
# script buckets ("IDEOGRAPHIC ITERATION MARK", "KATAKANA-HIRAGANA
# PROLONGED SOUND MARK"); they inherit the surrounding script so "人々" and
# "ユーザー" stay single segments. As tokens they only ever repeat the
# previous character, so the n-gram path keeps them inside bigrams but
# never emits them as standalone unigrams. U+3007 is deliberately absent:
# it is IDEOGRAPHIC NUMBER ZERO (a real character, classified CJK below),
# not a repetition mark.
_INHERIT_CODEPOINTS = frozenset(
    {"\u3005", "\u3006", "\u30fc", "\u309d", "\u309e", "\u30fd", "\u30fe"}
)


def _clusters(seg: str) -> List[str]:
    """Split into base+marks clusters so n-grams never detach a vowel sign
    or tone mark from its base (Thai "กิ" must not emit a bare "ิ")."""
    clusters: List[str] = []
    for ch in seg:
        if clusters and _is_mark(ch):
            clusters[-1] += ch
        else:
            clusters.append(ch)
    return clusters

# Characters that join the current token: letters and digits from any
# script, plus combining marks (Devanagari vowel signs, Arabic harakat,
# etc. - NFC leaves many of them decomposed, and dropping them collapses
# distinct words like "की" / "का" / "कि" onto one token).
def _is_mark(ch: str) -> bool:
    return unicodedata.category(ch).startswith("M")


def _script_of(ch: str) -> Optional[str]:
    """Script family of a character; None for script-neutral characters."""
    if ch == "\u3007":
        # IDEOGRAPHIC NUMBER ZERO is a real character, not a mark.
        return "CJK"
    if ch.isdigit() or _is_mark(ch) or ch in _INHERIT_CODEPOINTS:
        # Digits, combining marks, and Japanese iteration/prolonged marks
        # inherit the surrounding script.
        return None
    name = unicodedata.name(ch, "")
    return name.split(" ")[0] if name else None


def _emit_word(word: str, tokens: List[str]) -> None:
    """Emit a matched word, splitting at script boundaries.

    Each script segment tokenizes its own way: CJK segments emit each
    character (meaning is per-character and the text is not space-separated)
    plus overlapping bigrams so a multi-character query phrase matches
    adjacent characters in the document; every other script stays whole, so
    "Python東京" and "Python으로" both still yield "python".
    """
    segment = ""
    segment_script: Optional[str] = None
    segments: List[Tuple[str, str]] = []
    for ch in word:
        script = _script_of(ch)
        if script is None:
            # Digits and unattributed characters inherit the current script -
            # except digits beside (or opening a word before) a non-Latin
            # script, which form their own whole token so "إصدار2026" and
            # "2026東京" both keep a searchable "2026".
            if ch.isdigit() and segment_script not in ("LATIN", "DIGIT"):
                script = "DIGIT"
            else:
                segment += ch
                continue
        if segment_script is None:
            segment_script = script
        if script != segment_script:
            segments.append((segment, segment_script))
            segment = ch
            segment_script = script
        else:
            segment += ch
    if segment:
        segments.append((segment, segment_script or ""))
    # Merge contiguous Japanese-script segments so n-grams span kanji/kana
    # boundaries.
    runs: List[List[Any]] = []
    for seg, script in segments:
        if runs and script in _JAPANESE_SCRIPTS and runs[-1][1] in _JAPANESE_SCRIPTS:
            runs[-1][0] += seg
        else:
            runs.append([seg, script])
    for seg, script in runs:
        if script in _NGRAM_SCRIPTS:
            clusters = _clusters(seg)
            # Iteration/prolonged marks (々, ー) keep adjacency via bigrams
            # but are never standalone terms - every Japanese word shares
            # them, so as unigrams they false-match unrelated words.
            tokens.extend(c for c in clusters if c not in _INHERIT_CODEPOINTS)
            tokens.extend(
                clusters[k] + clusters[k + 1] for k in range(len(clusters) - 1)
            )
        else:
            tokens.append(seg)


def tokenize(text: str) -> List[str]:
    """Casefolded, NFKC-normalized, unicode-aware tokenization.

    NFKC first: extraction pipelines often produce decomposed or
    compatibility-form Unicode, and a precomposed plain query must still
    match ("Mu\u0308nchen" == "München", "Ｐｙｔｈｏｎ" == "Python").
    """
    tokens: List[str] = []
    # Unicode default caseless matching is NFKC(casefold(NFKC(s))): the
    # first pass turns compatibility forms into ordinary characters
    # (full-width Latin, half-width katakana, squared unit symbols like
    # "㎒" -> "MHz") so case folding reaches every letter, and the second
    # settles anything case folding decomposed.
    normalized = unicodedata.normalize("NFKC", unicodedata.normalize("NFKC", text).casefold())
    i = 0
    n = len(normalized)
    while i < n:
        if not normalized[i].isalnum():
            # Tokens start on letters/digits only: a detached combining mark
            # (e.g. an emoji variation selector) must not become a token, or
            # every emoji collapses onto one shared, meaningless token.
            i += 1
            continue
        j = i + 1
        while j < n and (normalized[j].isalnum() or _is_mark(normalized[j])):
            j += 1
        _emit_word(normalized[i:j], tokens)
        i = j
    return tokens


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
        if top_k:
            scores = scores[:top_k]
        results = []
        for doc_idx, score in scores:
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
        if filter_metadata:
            # Score every candidate before filtering: truncating to an
            # unfiltered top-k window first can drop all matching chunks
            # when they rank below it.
            results = self._index.search(query, top_k=0)
            results = [
                item for item in results
                if self._matches_filter(item[0], filter_metadata)
            ][:top_k]
        else:
            results = self._index.search(query, top_k=top_k)
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
