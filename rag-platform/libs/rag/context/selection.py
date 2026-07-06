"""Context selection strategies including MMR diversity."""

from __future__ import annotations

from typing import List, Tuple

from libs.rag.retrieval.keyword import tokenize

from .deduplication import jaccard_similarity


def maximal_marginal_relevance(
    chunks: List[Tuple[str, str, float, dict]],
    query: str,
    top_k: int,
    lambda_param: float = 0.7,
) -> List[Tuple[str, str, float, dict]]:
    """Select diverse chunks using Maximal Marginal Relevance (MMR).

    MMR = lambda * sim(query, chunk) - (1 - lambda) * max(sim(chunk, selected))

    Balances relevance to query with diversity among selected chunks.

    Args:
        chunks: List of (chunk_id, text, score, metadata) tuples.
        query: User query for relevance scoring.
        top_k: Number of chunks to select.
        lambda_param: Tradeoff between relevance (1.0) and diversity (0.0).

    Returns:
        Selected chunks in MMR order.
    """
    if not chunks or top_k <= 0:
        return []

    query_tokens = set(tokenize(query))
    remaining = list(chunks)
    selected: List[Tuple[str, str, float, dict]] = []

    def query_relevance(text: str) -> float:
        chunk_tokens = set(tokenize(text))
        if not chunk_tokens or not query_tokens:
            return 0.0
        return len(query_tokens & chunk_tokens) / len(query_tokens | chunk_tokens)

    while remaining and len(selected) < top_k:
        best_idx = -1
        best_mmr = float("-inf")

        for i, (cid, text, score, meta) in enumerate(remaining):
            relevance = 0.5 * score + 0.5 * query_relevance(text)

            max_sim_to_selected = 0.0
            for _, sel_text, _, _ in selected:
                sim = jaccard_similarity(text, sel_text)
                max_sim_to_selected = max(max_sim_to_selected, sim)

            mmr_score = (
                lambda_param * relevance
                - (1 - lambda_param) * max_sim_to_selected
            )

            if mmr_score > best_mmr:
                best_mmr = mmr_score
                best_idx = i

        if best_idx >= 0:
            selected.append(remaining.pop(best_idx))

    return selected


def select_top_k(
    chunks: List[Tuple[str, str, float, dict]],
    top_k: int,
) -> List[Tuple[str, str, float, dict]]:
    """Simple top-K selection by score."""
    sorted_chunks = sorted(chunks, key=lambda x: x[2], reverse=True)
    return sorted_chunks[:top_k]
