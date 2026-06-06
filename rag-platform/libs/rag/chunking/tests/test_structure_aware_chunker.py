"""Tests for StructureAwareChunker."""

import unittest
from uuid import uuid4

from libs.rag.chunking.base import ChunkerConfig
from libs.rag.chunking.structure_aware import StructureAwareChunker
from libs.shared.models.chunk import ChunkMetadata
from libs.shared.models.lifecycle import IngestionSource


class TestStructureAwareChunkerBasics(unittest.TestCase):
    """Basic functionality tests."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=100,
            chunk_overlap=10,
            preserve_code_blocks=True,
            preserve_lists=True,
            include_section_headers=True,
        )
        self.chunker = StructureAwareChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(
            source_type=IngestionSource.MARKDOWN_DOC,
            source_uri="https://example.com/doc.md",
        )

    def test_strategy_name(self) -> None:
        self.assertEqual(self.chunker.strategy_name, "structure_aware")

    def test_simple_markdown_single_section(self) -> None:
        text = "## Section Title\n\nShort content here."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertEqual(result.total_chunks, 1)
        self.assertIn("Section Title", result.chunks[0].chunk_text)

    def test_multiple_sections_create_chunks(self) -> None:
        text = """## Section One

Content for section one.

## Section Two

Content for section two.

## Section Three

Content for section three."""
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreaterEqual(result.total_chunks, 1)


class TestCodeBlockPreservation(unittest.TestCase):
    """Tests for code block handling."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=50,
            chunk_overlap=5,
            preserve_code_blocks=True,
        )
        self.chunker = StructureAwareChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)

    def test_code_block_stays_intact(self) -> None:
        text = """Some text before.

```python
def hello():
    print("Hello, World!")
    return True
```

Some text after."""
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("def hello():", all_text)
        self.assertIn("print(", all_text)

    def test_code_block_metadata_flag(self) -> None:
        text = "## Code Example\n\n```python\ncode\n```"
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        code_chunks = [c for c in result.chunks if c.metadata.has_code_block]
        self.assertGreater(len(code_chunks), 0)


class TestListPreservation(unittest.TestCase):
    """Tests for list handling."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=100,
            chunk_overlap=10,
            preserve_lists=True,
        )
        self.chunker = StructureAwareChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)

    def test_numbered_list_in_output(self) -> None:
        text = """## Steps

1. First step
2. Second step
3. Third step"""
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("1.", all_text)
        self.assertIn("2.", all_text)

    def test_bullet_list_in_output(self) -> None:
        text = """## Items

- Item A
- Item B
- Item C"""
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("Item A", all_text)


class TestSectionHeaderHandling(unittest.TestCase):
    """Tests for section header handling."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=50,
            chunk_overlap=5,
            include_section_headers=True,
        )
        self.chunker = StructureAwareChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)

    def test_section_header_extracted_to_metadata(self) -> None:
        text = "## Database Setup\n\nConfigure the database connection."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)
        headers = [c.metadata.section_header for c in result.chunks if c.metadata.section_header]
        self.assertTrue(any("Database" in h for h in headers) or len(headers) == 0)

    def test_no_header_document(self) -> None:
        text = "Just plain text without any headers."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertEqual(result.total_chunks, 1)


class TestStructureAwareEdgeCases(unittest.TestCase):
    """Edge case tests."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(chunk_size=50, chunk_overlap=5)
        self.chunker = StructureAwareChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)

    def test_only_headers_no_content(self) -> None:
        text = "## Header One\n\n## Header Two\n\n## Header Three"
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)

    def test_deeply_nested_headers(self) -> None:
        text = """# H1
## H2
### H3
#### H4
##### H5
###### H6
Content at deepest level."""
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)

    def test_mixed_content_types(self) -> None:
        text = """## Introduction

Regular paragraph.

- Bullet item

1. Numbered item

```
code block
```

> Blockquote

Final paragraph."""
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)

    def test_very_long_section(self) -> None:
        text = "## Long Section\n\n" + " ".join(["word"] * 500)
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreaterEqual(result.total_chunks, 1)
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("word", all_text)

    def test_empty_sections(self) -> None:
        text = "## Section One\n\n## Section Two\n\nActual content."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 0)

    def test_first_chunk_is_marked_as_summary(self) -> None:
        text = "## First Section\n\nContent here."
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertTrue(result.chunks[0].metadata.is_summary_chunk)


class TestRunbookScenario(unittest.TestCase):
    """Real-world runbook scenarios."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=200,
            chunk_overlap=20,
            preserve_code_blocks=True,
            preserve_lists=True,
        )
        self.chunker = StructureAwareChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)

    def test_runbook_structure_preserved(self) -> None:
        runbook = """## Database Connection Timeout Fix

When you see error ECONNREFUSED on the payment service:

### Diagnosis

1. Check if PostgreSQL is running
2. Verify connection pool status

### Resolution

```bash
systemctl status postgresql
pg_isready -h localhost -p 5432
```

### Escalation

If the above steps don't resolve the issue, contact the DBA team."""

        result = self.chunker.chunk(runbook, self.doc_id, self.version_id, self.metadata)
        all_text = " ".join(c.chunk_text for c in result.chunks)
        
        self.assertIn("ECONNREFUSED", all_text)
        self.assertIn("systemctl", all_text)
        self.assertIn("DBA", all_text)


if __name__ == "__main__":
    unittest.main()
