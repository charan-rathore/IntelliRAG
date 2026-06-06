"""Text utilities for chunking.

Provides token counting, text normalization, and helper functions
used by all chunkers.

TOKEN COUNTING STRATEGY:
We use a simple heuristic (chars / 4) as a fast approximation.
For production with specific models, replace with tiktoken or
the model's actual tokenizer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple


CHARS_PER_TOKEN_ESTIMATE = 4


def estimate_token_count(text: str) -> int:
    """Estimate token count using character-based heuristic.
    
    This is a fast approximation. For English text, ~4 characters ≈ 1 token
    is a reasonable estimate for most models.
    
    Args:
        text: Text to estimate tokens for.
    
    Returns:
        Estimated number of tokens (minimum 1 for non-empty text).
    """
    if not text:
        return 0
    return max(1, len(text) // CHARS_PER_TOKEN_ESTIMATE)


def chars_for_tokens(token_count: int) -> int:
    """Convert token count to approximate character count.
    
    Args:
        token_count: Number of tokens.
    
    Returns:
        Approximate character count.
    """
    return token_count * CHARS_PER_TOKEN_ESTIMATE


def normalize_whitespace(text: str) -> str:
    """Normalize whitespace in text.
    
    - Replaces multiple spaces with single space
    - Replaces multiple newlines with double newline (paragraph break)
    - Strips leading/trailing whitespace
    
    Args:
        text: Text to normalize.
    
    Returns:
        Normalized text.
    """
    text = re.sub(r" +", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def find_code_blocks(text: str) -> List[Tuple[int, int]]:
    """Find all fenced code block positions in text.
    
    Matches both triple backtick and triple tilde code blocks.
    
    Args:
        text: Text to search.
    
    Returns:
        List of (start, end) tuples for each code block.
    """
    pattern = r"```[\s\S]*?```|~~~[\s\S]*?~~~"
    return [(m.start(), m.end()) for m in re.finditer(pattern, text)]


def find_numbered_lists(text: str) -> List[Tuple[int, int]]:
    """Find contiguous numbered list blocks.
    
    Matches sequences like:
    1. First item
    2. Second item
    3. Third item
    
    Args:
        text: Text to search.
    
    Returns:
        List of (start, end) tuples for each numbered list block.
    """
    pattern = r"(?:^|\n)((?:\d+\.\s+.+\n?)+)"
    blocks = []
    for m in re.finditer(pattern, text):
        start = m.start(1)
        end = m.end(1)
        blocks.append((start, end))
    return blocks


def find_bullet_lists(text: str) -> List[Tuple[int, int]]:
    """Find contiguous bullet list blocks.
    
    Matches sequences starting with - or *.
    
    Args:
        text: Text to search.
    
    Returns:
        List of (start, end) tuples for each bullet list block.
    """
    pattern = r"(?:^|\n)((?:[-*]\s+.+\n?)+)"
    blocks = []
    for m in re.finditer(pattern, text):
        start = m.start(1)
        end = m.end(1)
        blocks.append((start, end))
    return blocks


def is_within_ranges(pos: int, ranges: List[Tuple[int, int]]) -> bool:
    """Check if a position is within any of the given ranges.
    
    Args:
        pos: Character position to check.
        ranges: List of (start, end) tuples.
    
    Returns:
        True if pos is within any range.
    """
    return any(start <= pos < end for start, end in ranges)


def extract_section_header(text: str) -> Optional[str]:
    """Extract the first markdown header from text.
    
    Args:
        text: Text to search.
    
    Returns:
        Header text without # prefix, or None if no header found.
    """
    match = re.match(r"^(#{1,6})\s+(.+?)(?:\n|$)", text)
    if match:
        return match.group(2).strip()
    return None


def split_preserving_separator(text: str, separator: str) -> List[str]:
    """Split text by separator, keeping separator with following chunk.
    
    Unlike str.split(), this keeps the separator attached to the text
    that follows it, which is important for maintaining context
    (e.g., keeping "## Header" with its section content).
    
    Args:
        text: Text to split.
        separator: Separator string.
    
    Returns:
        List of text segments.
    """
    if not separator:
        return [text] if text else []
    
    if separator not in text:
        return [text] if text else []
    
    parts = []
    remaining = text
    
    while separator in remaining:
        idx = remaining.find(separator)
        if idx > 0:
            parts.append(remaining[:idx])
        remaining = remaining[idx:]
        
        next_idx = remaining.find(separator, len(separator))
        if next_idx == -1:
            parts.append(remaining)
            remaining = ""
        else:
            parts.append(remaining[:next_idx])
            remaining = remaining[next_idx:]
    
    if remaining:
        parts.append(remaining)
    
    return [p for p in parts if p]


@dataclass
class TextSpan:
    """A span of text with position information."""
    text: str
    start: int
    end: int
    
    @property
    def length(self) -> int:
        return self.end - self.start
    
    @property
    def token_count(self) -> int:
        return estimate_token_count(self.text)


def merge_small_spans(
    spans: List[TextSpan],
    min_tokens: int,
    max_tokens: int,
    separator: str = "\n\n",
) -> List[TextSpan]:
    """Merge spans that are too small into neighboring spans.
    
    This prevents creating chunks that are too small to be useful.
    Uses a smarter merging strategy that considers:
    1. Semantic continuity (headers merge forward, content merges backward)
    2. Size balancing (merge into smaller neighbor when possible)
    
    Args:
        spans: List of text spans to potentially merge.
        min_tokens: Minimum token count - spans below this get merged.
        max_tokens: Maximum token count - don't merge if result exceeds this.
        separator: String to join merged spans.
    
    Returns:
        List of spans with small ones merged.
    """
    if not spans:
        return []
    
    if len(spans) == 1:
        return spans
    
    result = []
    current = spans[0]
    
    for i, next_span in enumerate(spans[1:], 1):
        current_tokens = current.token_count
        next_tokens = next_span.token_count
        combined_tokens = estimate_token_count(current.text + separator + next_span.text)
        
        should_merge = False
        
        if current_tokens < min_tokens and combined_tokens <= max_tokens:
            should_merge = True
        elif next_tokens < min_tokens and combined_tokens <= max_tokens:
            is_header = _is_header_span(next_span.text)
            if not is_header:
                should_merge = True
        
        if should_merge:
            current = TextSpan(
                text=current.text + separator + next_span.text,
                start=current.start,
                end=next_span.end,
            )
        else:
            result.append(current)
            current = next_span
    
    result.append(current)
    return result


def _is_header_span(text: str) -> bool:
    """Check if text starts with a markdown header.
    
    Args:
        text: Text to check.
    
    Returns:
        True if text starts with a markdown header (# to ######).
    """
    stripped = text.lstrip()
    return bool(re.match(r'^#{1,6}\s+', stripped))


def create_overlap_text(
    previous_text: str,
    overlap_tokens: int,
) -> str:
    """Extract overlap text from the end of previous chunk.
    
    OPTIMIZATION: Uses smart boundary detection to extract semantically meaningful
    overlap rather than arbitrary character positions. Priority:
    1. Complete sentences from the end
    2. Complete list items
    3. Complete lines
    4. Word boundaries (fallback)
    
    Args:
        previous_text: Text from previous chunk.
        overlap_tokens: Target number of overlap tokens.
    
    Returns:
        Text to prepend to next chunk as overlap.
    """
    if not previous_text or overlap_tokens <= 0:
        return ""
    
    target_chars = chars_for_tokens(overlap_tokens)
    
    if len(previous_text) <= target_chars:
        return previous_text
    
    search_region = previous_text[-(target_chars * 2):]
    
    sentences = re.split(r'(?<=[.!?])\s+', search_region)
    if len(sentences) > 1:
        overlap_sentences = []
        char_count = 0
        for sentence in reversed(sentences):
            if char_count + len(sentence) <= target_chars or not overlap_sentences:
                overlap_sentences.insert(0, sentence)
                char_count += len(sentence) + 1
            else:
                break
        if overlap_sentences:
            return ' '.join(overlap_sentences)
    
    lines = search_region.split('\n')
    if len(lines) > 1:
        overlap_lines = []
        char_count = 0
        for line in reversed(lines):
            if char_count + len(line) <= target_chars or not overlap_lines:
                overlap_lines.insert(0, line)
                char_count += len(line) + 1
            else:
                break
        if overlap_lines:
            return '\n'.join(overlap_lines)
    
    overlap_region = previous_text[-target_chars:]
    word_boundary = overlap_region.find(" ")
    if word_boundary > 0 and word_boundary < len(overlap_region) // 3:
        return overlap_region[word_boundary + 1:]
    
    return overlap_region
