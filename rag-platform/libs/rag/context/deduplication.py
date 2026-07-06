"""Deduplication strategies for context assembly."""

from __future__ import annotations

from typing import List, Set, Tuple

from libs.rag.retrieval.keyword import tokenize


def jaccard_similarity(text_a: str, text_b: str) -> float:
    """Compute Jaccard similarity between two texts."""
    tokens_a = set(tokenize(text_a))
    tokens_b = set(tokenize(text_b))
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = len(tokens_a & tokens_b)
    union = len(tokens_a | tokens_b)
    return intersection / union if union else 0.0


def deduplicate_by_similarity(
    chunks: List[Tuple[str, str, float, dict]],
    threshold: float = 0.85,
) -> Tuple[List[Tuple[str, str, float, dict]], int]:
    """Remove near-duplicate chunks by Jaccard similarity.

    Keeps the highest-scored chunk when duplicates are found.
    Processes in score order so best version is retained.

    Args:
        chunks: List of (chunk_id, text, score, metadata) tuples.
        threshold: Jaccard similarity above which chunks are considered duplicates.

    Returns:
        Tuple of (deduplicated chunks, count removed).
    """
    if not chunks:
        return [], 0

    sorted_chunks = sorted(chunks, key=lambda x: x[2], reverse=True)
    kept: List[Tuple[str, str, float, dict]] = []
    removed = 0

    for chunk_id, text, score, metadata in sorted_chunks:
        is_duplicate = False
        for _, kept_text, _, _ in kept:
            if jaccard_similarity(text, kept_text) >= threshold:
                is_duplicate = True
                break
        if is_duplicate:
            removed += 1
        else:
            kept.append((chunk_id, text, score, metadata))

    return kept, removed


def deduplicate_exact(
    chunks: List[Tuple[str, str, float, dict]],
) -> Tuple[List[Tuple[str, str, float, dict]], int]:
    """Remove exact text duplicates, keeping highest score."""
    seen_texts: Set[str] = set()
    kept: List[Tuple[str, str, float, dict]] = []
    removed = 0

    sorted_chunks = sorted(chunks, key=lambda x: x[2], reverse=True)
    for chunk_id, text, score, metadata in sorted_chunks:
        normalized = text.strip().lower()
        if normalized in seen_texts:
            removed += 1
            continue
        seen_texts.add(normalized)
        kept.append((chunk_id, text, score, metadata))

    return kept, removed
