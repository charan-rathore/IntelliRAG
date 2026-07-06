"""Parse and validate generation-time citations."""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

from libs.rag.context.models import AssembledContext, ContextChunk

from .models import ParsedCitation

_CITATION_PATTERN = re.compile(r"\[Source\s+(\d+)\]", re.IGNORECASE)


def build_source_index(chunks: List[ContextChunk]) -> Dict[int, ContextChunk]:
    """Map 1-based source index to context chunk."""
    return {chunk.rank: chunk for chunk in chunks}


def parse_citations(
    answer: str,
    context: AssembledContext,
    citation_prefix: str = "Source",
) -> List[ParsedCitation]:
    """Extract citations from generated answer and map to source chunks."""
    pattern = re.compile(
        rf"\[{re.escape(citation_prefix)}\s+(\d+)\]",
        re.IGNORECASE,
    )
    source_index = build_source_index(context.chunks)
    citations: List[ParsedCitation] = []
    seen: set[Tuple[str, int]] = set()

    for match in pattern.finditer(answer):
        source_num = int(match.group(1))
        chunk = source_index.get(source_num)
        if chunk is None:
            continue

        label = match.group(0)
        key = (label, source_num)
        if key in seen:
            continue
        seen.add(key)

        citations.append(
            ParsedCitation(
                label=label,
                source_index=source_num,
                chunk_id=chunk.chunk_id,
                source_text=chunk.text,
                position=match.start(),
            )
        )

    return citations


def extract_claims(answer: str) -> List[str]:
    """Split answer into atomic claim sentences for faithfulness evaluation."""
    cleaned = re.sub(r"\[Source\s+\d+\]", "", answer, flags=re.IGNORECASE)
    cleaned = cleaned.strip()
    if not cleaned:
        return []

    if cleaned.lower().startswith("i cannot answer"):
        return []

    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    claims = []
    for sentence in sentences:
        sentence = re.sub(r"\s+", " ", sentence).strip()
        if len(sentence) < 10:
            continue
        claims.append(sentence)
    return claims


def _sentence_claim_text(sentence: str, citation_prefix: str = "Source") -> str:
    """Normalize a sentence to claim text without citations."""
    text = re.sub(
        rf"\[{re.escape(citation_prefix)}\s+\d+\]",
        "",
        sentence,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", text).strip().rstrip(".")


def citations_for_claim(
    answer: str,
    claim: str,
    context: AssembledContext,
    citation_prefix: str = "Source",
) -> List[ParsedCitation]:
    """Find citations associated with a specific claim in the answer."""
    claim_normalized = re.sub(r"\s+", " ", claim).strip().rstrip(".")
    sentences = re.split(r"(?<=[.!?])\s+", answer)

    target_sentence = None
    for sentence in sentences:
        sentence_claim = _sentence_claim_text(sentence, citation_prefix)
        if (
            claim_normalized == sentence_claim
            or claim_normalized in sentence_claim
            or sentence_claim in claim_normalized
        ):
            target_sentence = sentence
            break

    if target_sentence is None:
        return []

    pattern = re.compile(
        rf"\[{re.escape(citation_prefix)}\s+(\d+)\]",
        re.IGNORECASE,
    )
    source_index = build_source_index(context.chunks)
    matched: List[ParsedCitation] = []

    for match in pattern.finditer(target_sentence):
        source_num = int(match.group(1))
        chunk = source_index.get(source_num)
        if chunk is None:
            continue
        matched.append(
            ParsedCitation(
                label=match.group(0),
                source_index=source_num,
                chunk_id=chunk.chunk_id,
                source_text=chunk.text,
                position=match.start(),
            )
        )

    return matched
