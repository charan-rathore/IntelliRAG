"""Tests for ChunkerFactory."""

import unittest

from libs.rag.chunking.base import BaseChunker, ChunkerConfig
from libs.rag.chunking.factory import (
    ChunkerFactory,
    get_chunker,
    get_chunker_for_strategy,
    register_chunker,
)
from libs.rag.chunking.github_chunker import GitHubIssueChunker
from libs.rag.chunking.recursive import RecursiveChunker
from libs.rag.chunking.structure_aware import StructureAwareChunker
from libs.shared.models.lifecycle import IngestionSource


class TestGetChunker(unittest.TestCase):
    """Tests for get_chunker function."""

    def test_github_issue_returns_github_chunker(self) -> None:
        chunker = get_chunker(IngestionSource.GITHUB_ISSUE)
        self.assertIsInstance(chunker, GitHubIssueChunker)

    def test_github_comment_returns_github_chunker(self) -> None:
        chunker = get_chunker(IngestionSource.GITHUB_ISSUE_COMMENT)
        self.assertIsInstance(chunker, GitHubIssueChunker)

    def test_markdown_doc_returns_structure_aware(self) -> None:
        chunker = get_chunker(IngestionSource.MARKDOWN_DOC)
        self.assertIsInstance(chunker, StructureAwareChunker)

    def test_custom_config_applied(self) -> None:
        config = ChunkerConfig(chunk_size=256, chunk_overlap=32)
        chunker = get_chunker(IngestionSource.GITHUB_ISSUE, config)
        self.assertEqual(chunker.config.chunk_size, 256)
        self.assertEqual(chunker.config.chunk_overlap, 32)

    def test_default_config_when_none_provided(self) -> None:
        chunker = get_chunker(IngestionSource.MARKDOWN_DOC)
        self.assertIsNotNone(chunker.config)
        self.assertEqual(chunker.config.chunk_size, 512)


class TestGetChunkerForStrategy(unittest.TestCase):
    """Tests for get_chunker_for_strategy function."""

    def test_recursive_strategy(self) -> None:
        chunker = get_chunker_for_strategy("recursive")
        self.assertIsInstance(chunker, RecursiveChunker)

    def test_structure_aware_strategy(self) -> None:
        chunker = get_chunker_for_strategy("structure_aware")
        self.assertIsInstance(chunker, StructureAwareChunker)

    def test_github_issue_strategy(self) -> None:
        chunker = get_chunker_for_strategy("github_issue")
        self.assertIsInstance(chunker, GitHubIssueChunker)

    def test_unknown_strategy_raises_error(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            get_chunker_for_strategy("nonexistent")
        self.assertIn("Unknown strategy", str(ctx.exception))
        self.assertIn("recursive", str(ctx.exception))

    def test_custom_config_for_strategy(self) -> None:
        config = ChunkerConfig(chunk_size=128)
        chunker = get_chunker_for_strategy("recursive", config)
        self.assertEqual(chunker.config.chunk_size, 128)


class TestChunkerFactory(unittest.TestCase):
    """Tests for ChunkerFactory class."""

    def test_factory_creates_chunker(self) -> None:
        factory = ChunkerFactory()
        chunker = factory.get(IngestionSource.GITHUB_ISSUE)
        self.assertIsInstance(chunker, GitHubIssueChunker)

    def test_factory_caches_chunkers(self) -> None:
        factory = ChunkerFactory()
        chunker1 = factory.get(IngestionSource.GITHUB_ISSUE)
        chunker2 = factory.get(IngestionSource.GITHUB_ISSUE)
        self.assertIs(chunker1, chunker2)

    def test_factory_different_sources_different_chunkers(self) -> None:
        factory = ChunkerFactory()
        chunker1 = factory.get(IngestionSource.GITHUB_ISSUE)
        chunker2 = factory.get(IngestionSource.MARKDOWN_DOC)
        self.assertIsNot(chunker1, chunker2)

    def test_factory_clear_cache(self) -> None:
        factory = ChunkerFactory()
        chunker1 = factory.get(IngestionSource.GITHUB_ISSUE)
        factory.clear_cache()
        chunker2 = factory.get(IngestionSource.GITHUB_ISSUE)
        self.assertIsNot(chunker1, chunker2)

    def test_factory_default_config(self) -> None:
        default_config = ChunkerConfig(chunk_size=1024)
        factory = ChunkerFactory(default_config)
        chunker = factory.get(IngestionSource.MARKDOWN_DOC)
        self.assertEqual(chunker.config.chunk_size, 1024)

    def test_factory_config_override(self) -> None:
        default_config = ChunkerConfig(chunk_size=1024)
        override_config = ChunkerConfig(chunk_size=256)
        factory = ChunkerFactory(default_config)
        chunker = factory.get(IngestionSource.MARKDOWN_DOC, override_config)
        self.assertEqual(chunker.config.chunk_size, 256)


class TestRegisterChunker(unittest.TestCase):
    """Tests for custom chunker registration."""

    def test_register_custom_chunker(self) -> None:
        original_chunker = get_chunker(IngestionSource.MARKDOWN_DOC)
        self.assertIsInstance(original_chunker, StructureAwareChunker)
        
        register_chunker(IngestionSource.MARKDOWN_DOC, RecursiveChunker)
        
        new_chunker = get_chunker(IngestionSource.MARKDOWN_DOC)
        self.assertIsInstance(new_chunker, RecursiveChunker)
        
        register_chunker(IngestionSource.MARKDOWN_DOC, StructureAwareChunker)


if __name__ == "__main__":
    unittest.main()
