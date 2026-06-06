"""Tests for chunking utility functions."""

import unittest

from libs.rag.chunking.utils import (
    TextSpan,
    chars_for_tokens,
    create_overlap_text,
    estimate_token_count,
    extract_section_header,
    find_bullet_lists,
    find_code_blocks,
    find_numbered_lists,
    is_within_ranges,
    merge_small_spans,
    normalize_whitespace,
    split_preserving_separator,
)


class TestTokenEstimation(unittest.TestCase):
    """Tests for token counting utilities."""

    def test_empty_string_returns_zero(self) -> None:
        self.assertEqual(estimate_token_count(""), 0)

    def test_short_text_returns_minimum_one(self) -> None:
        self.assertEqual(estimate_token_count("hi"), 1)

    def test_normal_text_estimation(self) -> None:
        text = "This is a test sentence with about twenty tokens or so."
        tokens = estimate_token_count(text)
        self.assertGreater(tokens, 5)
        self.assertLess(tokens, 30)

    def test_chars_for_tokens_round_trip(self) -> None:
        tokens = 100
        chars = chars_for_tokens(tokens)
        estimated_back = estimate_token_count("x" * chars)
        self.assertAlmostEqual(estimated_back, tokens, delta=5)


class TestNormalizeWhitespace(unittest.TestCase):
    """Tests for whitespace normalization."""

    def test_multiple_spaces_collapsed(self) -> None:
        result = normalize_whitespace("hello    world")
        self.assertEqual(result, "hello world")

    def test_multiple_newlines_collapsed_to_two(self) -> None:
        result = normalize_whitespace("para1\n\n\n\n\npara2")
        self.assertEqual(result, "para1\n\npara2")

    def test_strips_leading_trailing(self) -> None:
        result = normalize_whitespace("  text  ")
        self.assertEqual(result, "text")

    def test_empty_string(self) -> None:
        result = normalize_whitespace("")
        self.assertEqual(result, "")


class TestFindCodeBlocks(unittest.TestCase):
    """Tests for code block detection."""

    def test_finds_single_code_block(self) -> None:
        text = "before\n```python\ncode\n```\nafter"
        blocks = find_code_blocks(text)
        self.assertEqual(len(blocks), 1)
        self.assertIn("```python\ncode\n```", text[blocks[0][0]:blocks[0][1]])

    def test_finds_multiple_code_blocks(self) -> None:
        text = "```\nblock1\n```\ntext\n```\nblock2\n```"
        blocks = find_code_blocks(text)
        self.assertEqual(len(blocks), 2)

    def test_finds_tilde_code_blocks(self) -> None:
        text = "~~~\ncode\n~~~"
        blocks = find_code_blocks(text)
        self.assertEqual(len(blocks), 1)

    def test_no_code_blocks(self) -> None:
        text = "just regular text"
        blocks = find_code_blocks(text)
        self.assertEqual(len(blocks), 0)


class TestFindLists(unittest.TestCase):
    """Tests for list detection."""

    def test_finds_numbered_list(self) -> None:
        text = "intro\n1. first\n2. second\n3. third\nend"
        lists = find_numbered_lists(text)
        self.assertEqual(len(lists), 1)

    def test_finds_bullet_list_dash(self) -> None:
        text = "intro\n- item1\n- item2\nend"
        lists = find_bullet_lists(text)
        self.assertEqual(len(lists), 1)

    def test_finds_bullet_list_asterisk(self) -> None:
        text = "intro\n* item1\n* item2\nend"
        lists = find_bullet_lists(text)
        self.assertEqual(len(lists), 1)

    def test_no_lists(self) -> None:
        text = "regular paragraph text"
        self.assertEqual(len(find_numbered_lists(text)), 0)
        self.assertEqual(len(find_bullet_lists(text)), 0)


class TestIsWithinRanges(unittest.TestCase):
    """Tests for range checking."""

    def test_position_within_range(self) -> None:
        ranges = [(10, 20), (30, 40)]
        self.assertTrue(is_within_ranges(15, ranges))
        self.assertTrue(is_within_ranges(35, ranges))

    def test_position_outside_ranges(self) -> None:
        ranges = [(10, 20), (30, 40)]
        self.assertFalse(is_within_ranges(5, ranges))
        self.assertFalse(is_within_ranges(25, ranges))

    def test_position_at_boundary(self) -> None:
        ranges = [(10, 20)]
        self.assertTrue(is_within_ranges(10, ranges))
        self.assertFalse(is_within_ranges(20, ranges))

    def test_empty_ranges(self) -> None:
        self.assertFalse(is_within_ranges(5, []))


class TestExtractSectionHeader(unittest.TestCase):
    """Tests for header extraction."""

    def test_extracts_h1(self) -> None:
        text = "# Main Title\n\nContent"
        self.assertEqual(extract_section_header(text), "Main Title")

    def test_extracts_h2(self) -> None:
        text = "## Section Header\n\nContent"
        self.assertEqual(extract_section_header(text), "Section Header")

    def test_no_header_returns_none(self) -> None:
        text = "Just regular text"
        self.assertIsNone(extract_section_header(text))

    def test_header_not_at_start(self) -> None:
        text = "text\n## Header"
        self.assertIsNone(extract_section_header(text))


class TestSplitPreservingSeparator(unittest.TestCase):
    """Tests for split with separator preservation."""

    def test_basic_split(self) -> None:
        text = "part1\n\npart2\n\npart3"
        parts = split_preserving_separator(text, "\n\n")
        self.assertEqual(len(parts), 3)
        self.assertEqual(parts[0], "part1")

    def test_no_separator_present(self) -> None:
        text = "no separator here"
        parts = split_preserving_separator(text, "\n\n")
        self.assertEqual(parts, ["no separator here"])

    def test_empty_string(self) -> None:
        parts = split_preserving_separator("", "\n\n")
        self.assertEqual(parts, [])

    def test_empty_separator(self) -> None:
        parts = split_preserving_separator("text", "")
        self.assertEqual(parts, ["text"])


class TestMergeSmallSpans(unittest.TestCase):
    """Tests for span merging."""

    def test_merges_small_spans(self) -> None:
        spans = [
            TextSpan(text="tiny", start=0, end=4),
            TextSpan(text="also small", start=5, end=15),
        ]
        merged = merge_small_spans(spans, min_tokens=10, max_tokens=100)
        self.assertEqual(len(merged), 1)

    def test_does_not_merge_if_exceeds_max(self) -> None:
        spans = [
            TextSpan(text="a" * 200, start=0, end=200),
            TextSpan(text="b" * 200, start=201, end=401),
        ]
        merged = merge_small_spans(spans, min_tokens=10, max_tokens=50)
        self.assertEqual(len(merged), 2)

    def test_empty_list(self) -> None:
        merged = merge_small_spans([], min_tokens=10, max_tokens=100)
        self.assertEqual(merged, [])

    def test_single_span(self) -> None:
        spans = [TextSpan(text="single", start=0, end=6)]
        merged = merge_small_spans(spans, min_tokens=10, max_tokens=100)
        self.assertEqual(len(merged), 1)


class TestCreateOverlapText(unittest.TestCase):
    """Tests for overlap text creation."""

    def test_creates_overlap_from_end(self) -> None:
        text = "This is a sentence. This is another sentence."
        overlap = create_overlap_text(text, overlap_tokens=5)
        self.assertIn("sentence", overlap)

    def test_empty_text_returns_empty(self) -> None:
        self.assertEqual(create_overlap_text("", 10), "")

    def test_zero_overlap_returns_empty(self) -> None:
        self.assertEqual(create_overlap_text("some text", 0), "")

    def test_short_text_returns_all(self) -> None:
        text = "short"
        overlap = create_overlap_text(text, overlap_tokens=100)
        self.assertEqual(overlap, text)


if __name__ == "__main__":
    unittest.main()
