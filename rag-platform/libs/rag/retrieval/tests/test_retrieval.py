"""Tests for retrieval layer components."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock
from uuid import uuid4

import numpy as np
import pytest

from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.evaluation.retrieval_benchmark import (
    RetrievalBenchmark,
    RetrievalEvalSample,
    _is_relevant,
    mrr,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
)
from libs.rag.indexing.service import IndexingService
from libs.rag.indexing.vector_store import VectorSearchResult
from libs.rag.retrieval.dense import DenseRetriever
from libs.rag.retrieval.hybrid import HybridRetriever
from libs.rag.retrieval.keyword import BM25Index, KeywordRetriever, tokenize
from libs.rag.retrieval.models import RetrievedChunk, RetrievalResult
from libs.rag.retrieval.service import RetrievalService


class MockVectorStore:
    def __init__(self, data: Dict[str, Dict[str, Any]]):
        self._data = data

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filter_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[VectorSearchResult]:
        results = []
        for cid, entry in self._data.items():
            score = sum(a * b for a, b in zip(query_embedding, entry["embedding"]))
            results.append(VectorSearchResult(
                chunk_id=cid,
                score=score,
                metadata=entry.get("metadata", {}),
                text=entry.get("text"),
            ))
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]

    def add(self, *args, **kwargs):
        return 0

    def delete(self, *args, **kwargs):
        return 0

    def count(self):
        return len(self._data)

    def collection_exists(self):
        return True


CORPUS = [
    ("chunk-1", "Kubernetes pod scheduling failures in production cluster"),
    ("chunk-2", "Resource fragmentation on cluster nodes causes pending pods"),
    ("chunk-3", "Python asyncio event loop best practices for web servers"),
    ("chunk-4", "Node affinity rules spread workloads across availability zones"),
]


class TestTokenize:
    def test_basic(self):
        assert tokenize("Hello World 123") == ["hello", "world", "123"]




class TestTokenizeUnicode:
    def test_accented_word_stays_whole(self):
        assert tokenize("München") == ["münchen"]

    def test_casefold_maps_sharp_s(self):
        assert tokenize("Straße") == ["strasse"]

    def test_cjk_text_produces_tokens(self):
        tokens = tokenize("東京")
        assert "東" in tokens
        assert "京" in tokens
        assert "東京" in tokens

    def test_mixed_script_run_keeps_latin_token(self):
        tokens = tokenize("Python東京")
        assert "python" in tokens
        assert "東" in tokens
        assert "京" in tokens

    def test_mixed_script_cjk_first(self):
        tokens = tokenize("使用Python开发")
        assert "python" in tokens
        assert "使" in tokens and "用" in tokens

    def test_canonical_equivalence_matches(self):
        decomposed = tokenize("Mu\u0308nchen")
        precomposed = tokenize("München")
        assert decomposed == precomposed == ["münchen"]

    def test_mixed_latin_hangul_run_splits(self):
        tokens = tokenize("Python으로")
        assert "python" in tokens
        assert "으로" in tokens

    def test_combining_marks_stay_attached(self):
        # Devanagari vowel signs remain combining marks after NFC; dropping
        # them would collapse these distinct words onto one token.
        assert tokenize("की") == ["की"]
        tokens = set()
        for word in ("की", "का", "कि", "कु"):
            tokens.update(tokenize(word))
        assert tokens == {"की", "का", "कि", "कु"}

    def test_thai_ngrams_keep_marks_attached(self):
        tokens = tokenize("กิ")
        assert tokens == ["กิ"]
        # A bare vowel mark must never be a shared term.
        idx = BM25Index([("c1", "มิ")])
        assert idx.search("กิ") == []

    def test_japanese_iteration_marks_keep_adjacency(self):
        tokens = tokenize("人々")
        assert "人々" in tokens
        kana = tokenize("ユーザー")
        assert "ユー" in kana and "ザー" in kana

    def test_iteration_marks_are_not_standalone_unigrams(self):
        idx = BM25Index([("d", "スーパー")])
        assert idx.search("ユーザー") == []
        assert "々" not in tokenize("人々")
        assert "ー" not in tokenize("ユーザー")

    def test_digit_runs_beside_non_latin_scripts(self):
        tokens = tokenize("إصدار2026")
        assert "2026" in tokens
        idx = BM25Index([("d", "إصدار2026")])
        assert idx.search("2026") != []
        # Latin words keep their digits inside the token.
        assert "bm25" in tokenize("BM25")

    def test_kanji_kana_boundary_keeps_bigram(self):
        assert "食べ" in tokenize("食べる")
        assert "食べ" not in tokenize("食、べる")

    def test_compatibility_forms_match_plain_query(self):
        assert tokenize("Ｐｙｔｈｏｎ") == ["python"]
        idx = BM25Index([("d", "Ｐｙｔｈｏｎ ３")])
        assert idx.search("Python") != []

    def test_detached_combining_marks_form_no_token(self):
        # Emoji variation selectors are combining marks; unattached they must
        # not tokenize, or all emoji collapse onto one shared token.
        assert tokenize("❤️") == []
        assert tokenize("☀️") == []
        heart = set(tokenize("I ❤️ pizza"))
        sun = set(tokenize("☀️ beach"))
        assert heart.isdisjoint(sun & {"️"})

    def test_marks_inherit_script_inside_words(self):
        # A mark with no precomposed form must not split a Latin run.
        assert tokenize("a\u0330b") == ["a\u0330b"]

    def test_digit_runs_next_to_cjk_stay_whole(self):
        tokens = tokenize("東京2026年")
        assert "2026" in tokens

    def test_spaceless_thai_matches_via_ngrams(self):
        doc_tokens = set(tokenize("กรุงเทพมหานครเป็นเมืองหลวงของประเทศไทย"))
        query_tokens = set(tokenize("ประเทศไทย"))
        assert query_tokens <= doc_tokens

    def test_digits_stay_inside_words(self):
        assert tokenize("BM25 k1=1.5") == ["bm25", "k1", "1", "5"]

    def test_cjk_phrase_emits_bigram(self):
        assert "東京" in tokenize("東京は日本の首都です")
        # The same characters separated do NOT form the phrase token.
        assert "東京" not in tokenize("東と京")

    def test_bm25_finds_cjk_document(self):
        index = BM25Index([("doc-1", "東京は日本の首都です")])
        results = index.search("東京", top_k=1)
        assert [r[0] for r in results] == ["doc-1"]

    def test_bm25_finds_accented_document(self):
        index = BM25Index(
            [("doc-1", "München ist eine Stadt"), ("doc-2", "Berlin ist eine Stadt")]
        )
        results = index.search("München", top_k=1)
        assert results[0][0] == "doc-1"


class TestIsRelevantEmptyText:
    def test_missing_chunk_text_is_not_a_relevant_hit(self):
        sample = RetrievalEvalSample(
            question="q",
            relevant_chunk_ids=set(),
            relevant_texts=["alpha is the source context"],
        )
        assert _is_relevant("missing-text-chunk", "", sample) is False

    def test_missing_chunk_text_still_counts_by_id(self):
        sample = RetrievalEvalSample(question="q", relevant_chunk_ids={"c1"})
        assert _is_relevant("c1", "", sample) is True


class TestBM25Index:
    def test_search_returns_relevant(self):
        index = BM25Index(CORPUS)
        results = index.search("kubernetes pod scheduling", top_k=2)
        assert len(results) >= 1
        assert results[0][0] == "chunk-1"

    def test_empty_query(self):
        index = BM25Index(CORPUS)
        assert index.search("", top_k=5) == []


class TestKeywordRetriever:
    @pytest.mark.parametrize("metadata_filter", [None, {"lang": "en"}])
    def test_zero_limit_returns_no_matches(self, metadata_filter):
        retriever = KeywordRetriever(
            [("one", "alpha")], chunk_metadata={"one": {"lang": "en"}}
        )
        result = retriever.retrieve("alpha", top_k=0, filter_metadata=metadata_filter)
        assert result.chunks == []
        assert result.total_candidates == 0

    def test_index_zero_limit_is_not_unlimited(self):
        index = BM25Index([("one", "alpha")])
        assert index.search("alpha", top_k=0) == []

    def test_retrieve(self):
        retriever = KeywordRetriever(CORPUS)
        result = retriever.retrieve("resource fragmentation nodes", top_k=2)
        assert result.retriever == "keyword"
        assert len(result.chunks) >= 1
        assert result.chunks[0].chunk_id == "chunk-2"

    def test_filtered_retrieve_scans_beyond_unfiltered_window(self):
        # top_k * 4 = 8 unfiltered candidates; the two chunks matching the
        # filter rank below that window by BM25 (longer docs score lower),
        # so truncating before filtering would drop them entirely.
        chunks = [(f"short-{i}", "alpha") for i in range(8)]
        chunks += [
            ("long-1", "alpha " + " ".join(f"pad{i}" for i in range(30))),
            ("long-2", "alpha " + " ".join(f"extra{i}" for i in range(30))),
        ]
        metadata = {cid: {"lang": "en"} for cid, _ in chunks}
        metadata["long-1"] = {"lang": "de"}
        metadata["long-2"] = {"lang": "de"}
        retriever = KeywordRetriever(chunks, chunk_metadata=metadata)
        result = retriever.retrieve("alpha", top_k=2, filter_metadata={"lang": "de"})
        assert {c.chunk_id for c in result.chunks} == {"long-1", "long-2"}


class TestDenseRetriever:
    def test_retrieve(self):
        mock_store = MockVectorStore({
            "chunk-1": {
                "embedding": [1.0, 0.0, 0.0],
                "text": "kubernetes scheduling",
            },
            "chunk-2": {
                "embedding": [0.0, 1.0, 0.0],
                "text": "python asyncio",
            },
        })
        service = MagicMock(spec=IndexingService)
        service.search.return_value = mock_store.search([1.0, 0.0, 0.0], top_k=2)

        retriever = DenseRetriever(service)
        result = retriever.retrieve("kubernetes", top_k=2)
        assert result.retriever == "dense"
        assert len(result.chunks) == 2
        assert result.chunks[0].retriever == "dense"


class TestHybridRetriever:
    def test_fusion(self):
        mock_store = MockVectorStore({
            "chunk-1": {"embedding": [1.0, 0.0], "text": "kubernetes scheduling"},
            "chunk-2": {"embedding": [0.0, 1.0], "text": "resource fragmentation"},
        })
        service = MagicMock(spec=IndexingService)
        service.search.side_effect = lambda **kwargs: mock_store.search(
            [1.0, 0.0], top_k=kwargs.get("top_k", 5)
        )

        dense = DenseRetriever(service)
        keyword = KeywordRetriever(CORPUS)
        hybrid = HybridRetriever(dense, keyword)

        result = hybrid.retrieve("kubernetes scheduling", top_k=3)
        assert result.retriever == "hybrid"
        assert len(result.chunks) >= 1


class TestRetrievalService:
    def test_modes(self):
        service_mock = MagicMock(spec=IndexingService)
        service_mock.search.return_value = [
            VectorSearchResult(chunk_id="chunk-1", score=0.9, text="kubernetes"),
        ]
        svc = RetrievalService(service_mock, chunk_corpus=CORPUS)

        dense = svc.retrieve("kubernetes", mode="dense", top_k=1)
        assert dense.retriever == "dense"

        keyword = svc.retrieve("kubernetes", mode="keyword", top_k=1)
        assert keyword.retriever == "keyword"

        hybrid = svc.retrieve("kubernetes", mode="hybrid", top_k=1)
        assert hybrid.retriever == "hybrid"


class TestRetrievalMetrics:
    def test_recall_precision_mrr_ndcg(self):
        relevant = {"a", "b"}
        retrieved = ["a", "c", "b", "d"]

        assert recall_at_k(retrieved, relevant, 3) == 1.0
        assert precision_at_k(retrieved, relevant, 3) == pytest.approx(2 / 3)
        assert mrr(retrieved, relevant) == 1.0
        assert ndcg_at_k(retrieved, relevant, 3) > 0.9

    def test_empty_relevant(self):
        assert recall_at_k(["a"], set(), 1) == 0.0
        assert ndcg_at_k(["a"], set(), 1) == 0.0


class TestRetrievalBenchmark:
    def _make_mock_indexing_service(self):
        embeddings = {
            "chunk-1": [1.0, 0.0, 0.0],
            "chunk-2": [0.8, 0.2, 0.0],
            "chunk-3": [0.0, 1.0, 0.0],
            "chunk-4": [0.7, 0.3, 0.0],
        }
        texts = {cid: text for cid, text in CORPUS}

        store_data = {
            cid: {"embedding": emb, "text": texts[cid]}
            for cid, emb in embeddings.items()
        }
        mock_store = MockVectorStore(store_data)

        service = MagicMock(spec=IndexingService)

        def mock_search(query, top_k=10, filter_metadata=None):
            if "kubernetes" in query.lower() or "scheduling" in query.lower():
                q_emb = [1.0, 0.0, 0.0]
            elif "fragmentation" in query.lower():
                q_emb = [0.8, 0.2, 0.0]
            else:
                q_emb = [0.5, 0.5, 0.0]
            return mock_store.search(q_emb, top_k=top_k)

        service.search.side_effect = mock_search
        return service

    def test_benchmark_comparison(self):
        dataset = EvaluationDataset(
            name="test_retrieval",
            samples=[
                EvaluationSample(
                    question="What causes kubernetes pod scheduling failures?",
                    ground_truth="Resource fragmentation",
                    reference_context=["Kubernetes pod scheduling failures"],
                ),
                EvaluationSample(
                    question="What causes resource fragmentation on nodes?",
                    ground_truth="Fragmented CPU and memory",
                    reference_context=["Resource fragmentation on cluster nodes"],
                ),
            ],
        )

        service = self._make_mock_indexing_service()
        retrieval_svc = RetrievalService(service, chunk_corpus=CORPUS)

        benchmark = RetrievalBenchmark(dataset, corpus=CORPUS)
        results = benchmark.compare_retrievers(
            {
                "dense": lambda q, k: retrieval_svc.retrieve(q, mode="dense", top_k=k),
                "keyword": lambda q, k: retrieval_svc.retrieve(q, mode="keyword", top_k=k),
                "hybrid": lambda q, k: retrieval_svc.retrieve(q, mode="hybrid", top_k=k),
            },
            top_k=3,
        )

        assert len(results) == 3
        for name, result in results.items():
            assert result.num_queries == 2
            assert result.avg_mrr >= 0.0

        table = benchmark.comparison_table(results)
        assert "dense" in table
        assert "keyword" in table
        assert "hybrid" in table


def test_leading_digit_runs_before_non_latin_scripts():
    # Digits that OPEN a word beside a non-Latin script must also form their
    # own token: "2026إصدار" and "2026東京" stay searchable by "2026".
    assert "2026" in tokenize("2026إصدار")
    assert "2026" in tokenize("2026東京")
    # Latin-leading words keep their digits: "bm25" stays one token.
    assert "bm25" in tokenize("bm25")


def test_compatibility_forms_normalize_before_casefold():
    # NFKC after casefold leaves compatibility letters unfolded: ㎒
    # decomposes to "MHz" and must fold to the same token as "MHz".
    assert tokenize("㎒") == tokenize("MHz")
    assert tokenize("𝐀") == tokenize("a")


def test_ideographic_zero_is_a_searchable_unigram():
    # 〇 is IDEOGRAPHIC NUMBER ZERO, not an iteration mark: "二〇二六" must
    # answer a "〇" query.
    assert "〇" in tokenize("二〇二六")
    assert "二〇" in tokenize("二〇二六")


def test_kana_iteration_marks_are_not_standalone_unigrams():
    # ゝゞヽヾ repeat the previous kana; as shared unigrams they false-match
    # unrelated words ("さゝ" vs "くゝ").
    assert "ゝ" not in tokenize("さゝ")
    assert "ゞ" not in tokenize("さゞ")
    assert "ヽ" not in tokenize("サヽ")
    assert "ヾ" not in tokenize("サヾ")
    # Adjacency is still searchable via the bigram.
    assert "さゝ" in tokenize("さゝ")
