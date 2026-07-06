"""Extractive context compression."""

from __future__ import annotations

import re
from typing import List, Tuple

from libs.rag.chunking.utils import estimate_token_count
from libs.rag.retrieval.keyword import tokenize


def compress_extractive(
    text: str,
    query: str,
    max_tokens: int,
    preserve_headers: bool = True,
) -> Tuple[str, bool]:
    """Compress text extractively while preserving query-relevant sentences.

    Strategy:
    1. Always keep markdown headers
    2. Keep sentences containing query terms
    3. Fill remaining budget with leading sentences

    Args:
        text: Chunk text to compress.
        query: User query for relevance-guided extraction.
        max_tokens: Target maximum tokens.
        preserve_headers: Whether to always keep markdown headers.

    Returns:
        Tuple of (compressed text, was_compressed).
    """
    current_tokens = estimate_token_count(text)
    if current_tokens <= max_tokens:
        return text, False

    query_tokens = set(tokenize(query))
    lines = text.split("\n")
    header_lines: List[str] = []
    content_lines: List[str] = []

    for line in lines:
        if preserve_headers and re.match(r"^#{1,6}\s+", line.strip()):
            header_lines.append(line)
        else:
            content_lines.append(line)

    content_text = "\n".join(content_lines)
    sentences = re.split(r"(?<=[.!?])\s+", content_text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        header_text = "\n".join(header_lines)
        if estimate_token_count(header_text) <= max_tokens:
            return header_text, True
        return text[:max_tokens * 4], True

    scored_sentences = []
    for i, sentence in enumerate(sentences):
        sent_tokens = set(tokenize(sentence))
        overlap = len(query_tokens & sent_tokens) if query_tokens else 0
        has_query_term = overlap > 0
        scored_sentences.append((has_query_term, overlap, i, sentence))

    scored_sentences.sort(key=lambda x: (-int(x[0]), -x[1], x[2]))

    selected: List[str] = []
    used_tokens = estimate_token_count("\n".join(header_lines))

    for _, _, orig_idx, sentence in scored_sentences:
        sent_tokens_count = estimate_token_count(sentence)
        if used_tokens + sent_tokens_count <= max_tokens:
            selected.append((orig_idx, sentence))
            used_tokens += sent_tokens_count

    if not selected:
        return text[:max_tokens * 4], True

    selected.sort(key=lambda x: x[0])
    body = " ".join(s for _, s in selected)
    result = "\n".join(header_lines + [body]) if header_lines else body

    return result.strip(), True
