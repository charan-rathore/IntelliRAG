"""Tests for RecursiveChunker."""

import unittest
from uuid import uuid4

from libs.rag.chunking.base import ChunkerConfig
from libs.rag.chunking.recursive import RecursiveChunker
from libs.shared.models.chunk import ChunkMetadata
from libs.shared.models.lifecycle import IngestionSource


class TestRecursiveChunkerBasics(unittest.TestCase):
    """Basic functionality tests for RecursiveChunker."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=100,
            chunk_overlap=10,
            min_chunk_size=10,
            max_chunk_size=200,
        )
        self.chunker = RecursiveChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(
            source_type=IngestionSource.MARKDOWN_DOC,
            source_uri="https://example.com/doc",
            tenant_id="test-tenant",
        )

    def test_strategy_name(self) -> None:
        self.assertEqual(self.chunker.strategy_name, "recursive")

    def test_empty_text_raises_error(self) -> None:
        with self.assertRaises(ValueError):
            self.chunker.chunk("", self.doc_id, self.version_id, self.metadata)

    def test_whitespace_only_raises_error(self) -> None:
        with self.assertRaises(ValueError):
            self.chunker.chunk("   \n\n  ", self.doc_id, self.version_id, self.metadata)

    def test_short_text_single_chunk(self) -> None:
        text = "This is a short text."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertEqual(result.total_chunks, 1)
        self.assertEqual(result.chunks[0].chunk_text, text)

    def test_chunks_have_correct_document_references(self) -> None:
        text = "Short text for testing."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        for chunk in result.chunks:
            self.assertEqual(chunk.document_id, self.doc_id)
            self.assertEqual(chunk.version_id, self.version_id)

    def test_chunks_have_sequential_indices(self) -> None:
        text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        indices = [c.chunk_index for c in result.chunks]
        self.assertEqual(indices, list(range(len(indices))))

    def test_chunks_have_valid_hashes(self) -> None:
        text = "Text for hash testing."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        for chunk in result.chunks:
            self.assertEqual(len(chunk.chunk_hash), 64)
            self.assertTrue(all(c in "0123456789abcdef" for c in chunk.chunk_hash))


class TestRecursiveChunkerSplitting(unittest.TestCase):
    """Tests for splitting behavior."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=50,
            chunk_overlap=5,
            min_chunk_size=5,
            max_chunk_size=100,
        )
        self.chunker = RecursiveChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(
            source_type=IngestionSource.MARKDOWN_DOC,
        )

    def test_splits_on_paragraphs(self) -> None:
        text = "First paragraph with some content.\n\nSecond paragraph with more content."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreaterEqual(result.total_chunks, 1)

    def test_splits_on_headers(self) -> None:
        text = "## Header One\n\nContent one.\n\n## Header Two\n\nContent two."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreaterEqual(result.total_chunks, 1)

    def test_long_text_creates_multiple_chunks(self) -> None:
        text = " ".join(["word"] * 500)
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 1)

    def test_result_statistics_are_correct(self) -> None:
        text = "Test content.\n\nMore test content."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertEqual(result.total_chunks, len(result.chunks))
        self.assertEqual(result.total_tokens, sum(c.token_count for c in result.chunks))
        self.assertEqual(result.total_chars, sum(c.char_count for c in result.chunks))


class TestRecursiveChunkerOverlap(unittest.TestCase):
    """Tests for chunk overlap behavior."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=30,
            chunk_overlap=10,
            min_chunk_size=5,
            max_chunk_size=60,
        )
        self.chunker = RecursiveChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)

    def test_overlap_is_applied(self) -> None:
        text = "First part content here.\n\nSecond part content here.\n\nThird part content here."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        if result.total_chunks > 1:
            first_end = result.chunks[0].chunk_text[-20:]
            has_overlap = any(
                first_end[-10:] in chunk.chunk_text[:50]
                for chunk in result.chunks[1:]
            )
            self.assertTrue(has_overlap or result.total_chunks == 1)


class TestRecursiveChunkerEdgeCases(unittest.TestCase):
    """Edge case tests to ensure no infinite loops or crashes."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(chunk_size=50, chunk_overlap=5)
        self.chunker = RecursiveChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)

    def test_single_very_long_word(self) -> None:
        text = "a" * 1000
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)
        total_text = "".join(c.chunk_text for c in result.chunks)
        self.assertGreater(len(total_text), 0)

    def test_only_separators(self) -> None:
        text = "   \n\n   content   \n\n   "
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertEqual(result.total_chunks, 1)

    def test_repeated_separators(self) -> None:
        text = "word1\n\n\n\n\n\nword2\n\n\n\n\n\nword3"
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)

    def test_unicode_content(self) -> None:
        text = "Hello 世界! Émoji test 🚀 café résumé"
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertEqual(result.total_chunks, 1)
        self.assertIn("世界", result.chunks[0].chunk_text)

    def test_code_block_content(self) -> None:
        text = "Text before.\n\n```python\ndef foo():\n    return 42\n```\n\nText after."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)

    def test_very_small_chunk_size_config(self) -> None:
        small_config = ChunkerConfig(
            chunk_size=10,
            chunk_overlap=2,
            min_chunk_size=2,
            max_chunk_size=20,
        )
        chunker = RecursiveChunker(small_config)
        text = "This is a test with multiple words."
        result = chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)

    def test_no_infinite_loop_on_pathological_input(self) -> None:
        """Ensure we don't get stuck on inputs that resist splitting."""
        text = "x" * 10000
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)
        self.assertLess(result.total_chunks, 1000)


class TestChunkerConfigValidation(unittest.TestCase):
    """Tests for configuration validation."""

    def test_negative_chunk_size_raises(self) -> None:
        with self.assertRaises(ValueError):
            ChunkerConfig(chunk_size=-1)

    def test_zero_chunk_size_raises(self) -> None:
        with self.assertRaises(ValueError):
            ChunkerConfig(chunk_size=0)

    def test_negative_overlap_raises(self) -> None:
        with self.assertRaises(ValueError):
            ChunkerConfig(chunk_overlap=-1)

    def test_overlap_greater_than_size_raises(self) -> None:
        with self.assertRaises(ValueError):
            ChunkerConfig(chunk_size=100, chunk_overlap=150)

    def test_max_smaller_than_size_raises(self) -> None:
        with self.assertRaises(ValueError):
            ChunkerConfig(chunk_size=200, max_chunk_size=100)


if __name__ == "__main__":
    unittest.main()
