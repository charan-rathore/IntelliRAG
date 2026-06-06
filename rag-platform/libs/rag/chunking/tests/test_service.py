"""Tests for ChunkingService."""

import unittest
from datetime import datetime, timezone
from uuid import uuid4

from libs.rag.chunking.service import (
    ChunkingJobResult,
    ChunkingService,
    ChunkingServiceConfig,
    chunk_registered_document,
)
from libs.shared.models.chunk import ChunkMetadata
from libs.shared.models.document import (
    CanonicalDocument,
    DocumentMetadata,
    DocumentVersion,
)
from libs.shared.models.lifecycle import IngestionSource, IngestionState


def create_test_document(
    source_type: IngestionSource = IngestionSource.GITHUB_ISSUE,
    title: str = "Test Issue Title",
) -> CanonicalDocument:
    """Create a test document for chunking tests."""
    doc_id = uuid4()
    return CanonicalDocument(
        document_id=doc_id,
        external_id="12345",
        title=title,
        metadata=DocumentMetadata(
            source_type=source_type,
            source_uri="https://github.com/org/repo/issues/123",
            tenant_id="test-tenant",
            tags=["bug", "urgent"],
            labels=["backend"],
            service="api-service",
        ),
        hash_content="abc123",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        ingested_at=datetime.now(timezone.utc),
        lifecycle_state=IngestionState.REGISTERED,
    )


def create_test_version(document_id, body_text: str) -> DocumentVersion:
    """Create a test document version."""
    return DocumentVersion(
        document_id=document_id,
        version_id=uuid4(),
        version_index=1,
        body_text=body_text,
        hash_payload="def456",
        valid_from=datetime.now(timezone.utc),
        is_active=True,
    )


class TestChunkingService(unittest.TestCase):
    """Tests for ChunkingService class."""

    def setUp(self) -> None:
        self.config = ChunkingServiceConfig(
            chunk_size=200,
            chunk_overlap=20,
        )
        self.service = ChunkingService(self.config)

    def test_chunk_simple_document(self) -> None:
        document = create_test_document()
        version = create_test_version(
            document.document_id,
            "This is a simple issue body with some content.",
        )
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertTrue(result.success)
        self.assertGreater(result.chunks_created, 0)
        self.assertEqual(len(chunks), result.chunks_created)

    def test_chunk_github_issue_with_title(self) -> None:
        document = create_test_document(
            source_type=IngestionSource.GITHUB_ISSUE,
            title="API returns 500 error on login",
        )
        version = create_test_version(
            document.document_id,
            "When clicking login button, the system crashes with error 500.",
        )
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertTrue(result.success)
        self.assertGreater(len(chunks), 0)
        
        first_chunk = chunks[0]
        self.assertIn("500", first_chunk.chunk_text)
        self.assertTrue(first_chunk.metadata.is_summary_chunk)

    def test_chunk_markdown_document(self) -> None:
        document = create_test_document(source_type=IngestionSource.MARKDOWN_DOC)
        version = create_test_version(
            document.document_id,
            """## Introduction

This is the intro section.

## Steps

1. First step
2. Second step
3. Third step
""",
        )
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertTrue(result.success)
        all_text = " ".join(c.chunk_text for c in chunks)
        self.assertIn("First step", all_text)

    def test_chunk_empty_body_fails(self) -> None:
        document = create_test_document()
        version = create_test_version(document.document_id, "")
        version.body_text = None
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertFalse(result.success)
        self.assertEqual(len(chunks), 0)
        self.assertIn("no body_text", result.error_message)

    def test_chunks_have_correct_metadata(self) -> None:
        document = create_test_document()
        version = create_test_version(
            document.document_id,
            "Issue body content here.",
        )
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertTrue(result.success)
        for chunk in chunks:
            self.assertEqual(chunk.metadata.source_type, IngestionSource.GITHUB_ISSUE)
            self.assertEqual(chunk.metadata.tenant_id, "test-tenant")
            self.assertEqual(chunk.metadata.service, "api-service")
            self.assertIn("bug", chunk.metadata.tags)

    def test_chunks_have_correct_document_references(self) -> None:
        document = create_test_document()
        version = create_test_version(
            document.document_id,
            "Issue body content here.",
        )
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertTrue(result.success)
        for chunk in chunks:
            self.assertEqual(chunk.document_id, document.document_id)
            self.assertEqual(chunk.version_id, version.version_id)


class TestChunkingJobResult(unittest.TestCase):
    """Tests for ChunkingJobResult class."""

    def test_success_result(self) -> None:
        doc_id = uuid4()
        version_id = uuid4()
        result = ChunkingJobResult.success_result(
            document_id=doc_id,
            version_id=version_id,
            chunks_created=5,
            total_tokens=250,
        )
        
        self.assertTrue(result.success)
        self.assertEqual(result.chunks_created, 5)
        self.assertEqual(result.total_tokens, 250)
        self.assertIsNone(result.error_message)

    def test_failure_result(self) -> None:
        doc_id = uuid4()
        version_id = uuid4()
        result = ChunkingJobResult.failure_result(
            document_id=doc_id,
            version_id=version_id,
            error_message="Something went wrong",
        )
        
        self.assertFalse(result.success)
        self.assertEqual(result.chunks_created, 0)
        self.assertEqual(result.error_message, "Something went wrong")


class TestChunkRegisteredDocument(unittest.TestCase):
    """Tests for the convenience function."""

    def test_convenience_function_works(self) -> None:
        document = create_test_document()
        version = create_test_version(
            document.document_id,
            "Simple body content for testing.",
        )
        
        result, chunks = chunk_registered_document(document, version)
        
        self.assertTrue(result.success)
        self.assertGreater(len(chunks), 0)

    def test_with_custom_config(self) -> None:
        document = create_test_document()
        version = create_test_version(
            document.document_id,
            "Body content for custom config test.",
        )
        
        config = ChunkingServiceConfig(chunk_size=100, chunk_overlap=10)
        result, chunks = chunk_registered_document(document, version, config)
        
        self.assertTrue(result.success)


class TestLongDocumentChunking(unittest.TestCase):
    """Tests for chunking longer documents."""

    def setUp(self) -> None:
        self.config = ChunkingServiceConfig(
            chunk_size=100,
            chunk_overlap=10,
        )
        self.service = ChunkingService(self.config)

    def test_long_document_creates_multiple_chunks(self) -> None:
        document = create_test_document()
        long_body = "\n\n".join([f"Paragraph {i} with some content." for i in range(20)])
        version = create_test_version(document.document_id, long_body)
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertTrue(result.success)
        self.assertGreater(result.chunks_created, 1)

    def test_code_blocks_preserved(self) -> None:
        document = create_test_document()
        body = """## Error Description

I see this error:

```python
def broken():
    raise ValueError("oops")
```

Please help!"""
        version = create_test_version(document.document_id, body)
        
        result, chunks = self.service.chunk_document(document, version)
        
        self.assertTrue(result.success)
        all_text = " ".join(c.chunk_text for c in chunks)
        self.assertIn("def broken():", all_text)


if __name__ == "__main__":
    unittest.main()
