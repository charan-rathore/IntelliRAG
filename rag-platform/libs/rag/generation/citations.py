"""Parse and validate generation-time citations."""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

from libs.rag.context.models import AssembledContext, ContextChunk

from .models import ParsedCitation

_CITATION_PATTERN = re.compile(r"\[Source\s+(\d+)\]", re.IGNORECASE)
_BARE_CITATION_PATTERN = re.compile(r"\[(\d+)\]")


def normalize_answer_citations(answer: str) -> str:
    """Normalize model citation quirks into ``[Source N]`` and drop heading dumps.

    Local models often emit ``[1]`` footnotes or paste ``# Title`` after a marker.
    """
    if not answer:
        return answer

    protected: list[tuple[str, str]] = []

    def _protect(match: re.Match[str]) -> str:
        token = f"@@SRC{len(protected)}@@"
        protected.append((token, f"[Source {match.group(1)}]"))
        return token

    text = _CITATION_PATTERN.sub(_protect, answer)
    text = _BARE_CITATION_PATTERN.sub(r"[Source \1]", text)
    for token, label in protected:
        text = text.replace(token, label)

    # Drop trailing footnote lines that are just markdown headings / labels.
    text = re.sub(
        r"(?:\n|^)\s*\[Source\s+\d+\]\s*#+\s*[^\n]*\s*$",
        "",
        text,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_source_index(chunks: List[ContextChunk]) -> Dict[int, ContextChunk]:
    """Map 1-based source index to context chunk."""
    return {chunk.rank: chunk for chunk in chunks}


def parse_citations(
    answer: str,
    context: AssembledContext,
    citation_prefix: str = "Source",
) -> List[ParsedCitation]:
    """Extract citations from generated answer and map to source chunks."""
    normalized = normalize_answer_citations(answer)
    pattern = re.compile(
        rf"\[{re.escape(citation_prefix)}\s+(\d+)\]",
        re.IGNORECASE,
    )
    source_index = build_source_index(context.chunks)
    citations: List[ParsedCitation] = []
    seen: set[Tuple[str, int]] = set()

    for match in pattern.finditer(normalized):
        source_num = int(match.group(1))
        chunk = source_index.get(source_num)
        if chunk is None:
            # ranks may be 0-based in some paths — try 1-based positional fallback
            if 1 <= source_num <= len(context.chunks):
                chunk = context.chunks[source_num - 1]
            else:
                continue

        label = f"[Source {source_num}]"
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


def _sentences_keeping_trailing_citations(answer: str) -> List[str]:
    """Split into sentences, keeping orphaned [Source N] tails with the prior sentence.

    Models often emit: ``Claim text. [Source 1]`` which naive split turns into a
    claim sentence and a citation-only fragment — breaking claim→citation linkage.
    """
    parts = re.split(r"(?<=[.!?])\s+", answer.strip())
    merged: List[str] = []
    citation_only = re.compile(r"^(\[Source\s+\d+\]\s*)+$", re.IGNORECASE)
    for part in parts:
        stripped = part.strip()
        if not stripped:
            continue
        if merged and citation_only.fullmatch(stripped):
            merged[-1] = f"{merged[-1].rstrip()} {stripped}"
        else:
            merged.append(part)
    return merged


def citations_for_claim(
    answer: str,
    claim: str,
    context: AssembledContext,
    citation_prefix: str = "Source",
) -> List[ParsedCitation]:
    """Find citations associated with a specific claim in the answer."""
    claim_normalized = re.sub(r"\s+", " ", claim).strip().rstrip(".")
    sentences = _sentences_keeping_trailing_citations(answer)

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
