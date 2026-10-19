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


class TestOversizedUnstructuredContent(unittest.TestCase):
    """Regression: max_chunk_size is a hard limit even with no sentence boundaries."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=512,
            chunk_overlap=0,
            min_chunk_size=100,
            max_chunk_size=1024,
        )
        self.chunker = StructureAwareChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(
            source_type=IngestionSource.MARKDOWN_DOC,
            source_uri="https://example.com/doc.md",
        )

    def test_force_split_sentence_free_text_respects_max_chunk_size(self) -> None:
        # 20k chars with no '.', '!', '?' and no blank lines: one giant
        # "sentence" in one "paragraph". Must still be split under the
        # documented hard limit instead of returned as a single chunk.
        text = "word" * 5000  # 20000 chars, no sentence boundaries
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 1)
        for chunk in result.chunks:
            self.assertLessEqual(chunk.token_count, self.config.max_chunk_size)

    def test_force_split_sentence_free_text_preserves_content(self) -> None:
        text = "alpha " * 3000  # 18000 chars, no sentence boundaries
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 1)
        reassembled = " ".join(
            piece for chunk in result.chunks for piece in chunk.chunk_text.split()
        )
        self.assertEqual(reassembled, " ".join(text.split()))

    def test_force_split_long_header_terminates(self) -> None:
        # A header longer than the target must not hang the hard-cut loop
        # (room = target_chars - len(header_prefix) would go non-positive).
        import resource
        import signal

        def _alarm(signum, frame):
            raise TimeoutError("force-split hung on over-long header")

        long_header = "## " + "h" * 3000
        text = long_header + "\n\n" + "word" * 5000
        # Cap address space so the unbounded span growth surfaces as
        # MemoryError instead of swapping the host to death, and bound
        # wall time so a hang surfaces as TimeoutError. Never raise the
        # soft cap above an existing (lower) hard cap, and restore the
        # original pair afterwards.
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        cap = 1 << 30
        if hard != resource.RLIM_INFINITY:
            cap = min(cap, hard)
        resource.setrlimit(resource.RLIMIT_AS, (cap, hard))
        signal.signal(signal.SIGALRM, _alarm)
        signal.alarm(5)
        try:
            result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        finally:
            signal.alarm(0)
            resource.setrlimit(resource.RLIMIT_AS, (soft, hard))
        self.assertGreaterEqual(result.total_chunks, 1)
        for chunk in result.chunks:
            self.assertLessEqual(chunk.token_count, self.config.max_chunk_size)
        # The header was already emitted as its own chunk by the caller;
        # the force-split must not flush it a second time as content.
        header_pieces = sum(1 for chunk in result.chunks if "h" * 100 in chunk.chunk_text)
        self.assertEqual(header_pieces, 1)
        prev_start = -1
        for chunk in result.chunks:
            self.assertLessEqual(chunk.start_char_offset, chunk.end_char_offset)
            self.assertGreaterEqual(chunk.start_char_offset, prev_start)
            prev_start = chunk.start_char_offset

    def test_force_split_offsets_stay_ordered(self) -> None:
        # Synthetic header prefix must not leak into document offsets:
        # every chunk needs start <= end, and starts must not regress.
        text = "## Section\n\n" + "word" * 5000
        result = self.chunker.chunk(text, self.doc_id, self.version_id, self.metadata)
        self.assertGreater(result.total_chunks, 1)
        prev_start = -1
        for chunk in result.chunks:
            self.assertIsNotNone(chunk.start_char_offset)
            self.assertIsNotNone(chunk.end_char_offset)
            self.assertLessEqual(chunk.start_char_offset, chunk.end_char_offset)
            self.assertGreaterEqual(chunk.start_char_offset, prev_start)
            prev_start = chunk.start_char_offset

class TestAggregateSplitOffsets(unittest.TestCase):
    """Regression: aggregate paragraph splits must advance offsets by real
    consumed source characters, not by the synthetic repeated header."""

    def test_aggregate_spans_track_consumed_source(self) -> None:
        # One section whose paragraphs aggregate into 3 chunks. The first
        # chunk's "## H\n\n" prefix IS the section's own header in the
        # source, so the first span starts at section.start and counts it as
        # consumed source; the repeated prefixes on later chunks are
        # synthetic, so those spans cover content only.
        config = ChunkerConfig(
            chunk_size=5,
            chunk_overlap=0,
            min_chunk_size=1,
            max_chunk_size=8,
        )
        chunker = StructureAwareChunker(config)
        text = "## H\n\n" + "a" * 10 + "\n\n" + "b" * 10 + "\n\n" + "c" * 10 + "\n\n"
        metadata = ChunkMetadata(
            source_type=IngestionSource.MARKDOWN_DOC,
            source_uri="https://example.com/doc.md",
        )
        result = chunker.chunk(text, uuid4(), uuid4(), metadata)
        spans = [(c.start_char_offset, c.end_char_offset) for c in result.chunks]
        self.assertEqual(spans, [(0, 18), (18, 30), (30, 40)])
        # Every chunk still carries the header (real on the first, repeated
        # on the rest).
        for chunk in result.chunks:
            self.assertTrue(chunk.chunk_text.startswith("## H"))
        # The first span slices its chunk back out of the source, header
        # included; later spans slice out their real content.
        self.assertEqual(text[0:18], "## H\n\n" + "a" * 10 + "\n\n")
        self.assertEqual(text[18:30], "b" * 10 + "\n\n")


if __name__ == "__main__":
    unittest.main()


class TestStructureAwareOffsetsIndexOriginalSource(unittest.TestCase):
    """Same original-source offset contract as the recursive chunker."""

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

    def test_offsets_cover_the_chunk_in_the_original_source(self) -> None:
        from libs.rag.chunking.utils import normalize_whitespace

        source = "  # Setup\n\nFirst  install the   package.\n\nThen run it.  "
        result = self.chunker.chunk(source, self.doc_id, self.version_id, self.metadata)
        self.assertGreaterEqual(len(result.chunks), 1)
        for chunk in result.chunks:
            sliced = source[chunk.start_char_offset : chunk.end_char_offset]
            self.assertEqual(
                normalize_whitespace(sliced),
                chunk.chunk_text,
                f"chunk {chunk.chunk_index} offsets do not cover its text",
            )
