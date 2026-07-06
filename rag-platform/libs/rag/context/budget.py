"""Token budget packing for context assembly."""

from __future__ import annotations

from typing import List, Tuple

from libs.rag.chunking.utils import estimate_token_count


def pack_by_budget(
    chunks: List[Tuple[str, str, float, dict]],
    max_tokens: int,
    min_chunk_tokens: int = 20,
) -> Tuple[List[Tuple[str, str, float, dict]], int]:
    """Pack chunks into token budget using greedy score-per-token ordering.

    Prioritizes high-relevance chunks that are token-efficient.
    Preserves input order among chunks with equal efficiency.

    Args:
        chunks: List of (chunk_id, text, score, metadata) tuples.
        max_tokens: Maximum total tokens allowed.
        min_chunk_tokens: Skip chunks smaller than this (noise filter).

    Returns:
        Tuple of (packed chunks, count dropped due to budget).
    """
    if not chunks or max_tokens <= 0:
        return [], len(chunks)

    scored = []
    for chunk_id, text, score, metadata in chunks:
        tokens = estimate_token_count(text)
        if tokens < min_chunk_tokens:
            continue
        efficiency = score / tokens if tokens > 0 else score
        scored.append((efficiency, chunk_id, text, score, metadata, tokens))

    scored.sort(key=lambda x: x[0], reverse=True)

    packed: List[Tuple[str, str, float, dict]] = []
    used_tokens = 0
    dropped = 0

    for _, chunk_id, text, score, metadata, tokens in scored:
        if used_tokens + tokens <= max_tokens:
            packed.append((chunk_id, text, score, metadata))
            used_tokens += tokens
        else:
            dropped += 1

    remaining_budget = max_tokens - used_tokens
    for _, chunk_id, text, score, metadata, tokens in scored:
        if (chunk_id, text, score, metadata) in packed:
            continue
        if tokens <= remaining_budget and tokens >= min_chunk_tokens:
            packed.append((chunk_id, text, score, metadata))
            used_tokens += tokens
            remaining_budget -= tokens
            dropped -= 1

    return packed, dropped
