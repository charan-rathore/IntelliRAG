"""Tests for chunk repository helpers."""

from __future__ import annotations

from uuid import uuid4

from libs.connectors.sinks.postgres.chunk_utils import chunk_to_row
from libs.shared.models.chunk import Chunk, ChunkMetadata
from libs.shared.models.lifecycle import IngestionSource


class TestChunkToRow:
    def test_converts_chunk_to_migration_005_schema(self):
        doc_id = uuid4()
        ver_id = uuid4()
        chunk = Chunk.create(
            document_id=doc_id,
            version_id=ver_id,
            chunk_index=0,
            chunk_text="Sample chunk text for testing.",
            token_count=8,
            metadata=ChunkMetadata(
                source_type=IngestionSource.GITHUB_ISSUE,
                source_uri="https://github.com/org/repo/issues/1",
                tenant_id="team-a",
                tags=["bug"],
                labels=["priority-high"],
                service="api",
                component="ingestion",
                section_header="Root Cause",
                has_code_block=True,
            ),
        )

        row = chunk_to_row(chunk)

        assert row["chunk_id"] == str(chunk.chunk_id)
        assert row["document_id"] == str(doc_id)
        assert row["version_id"] == str(ver_id)
        assert row["chunk_index"] == 0
        assert row["chunk_text"] == chunk.chunk_text
        assert row["source_type"] == "github_issue"
        assert row["tenant_id"] == "team-a"
        assert row["has_code_block"] is True
        assert row["tags"] == ["bug"]
        assert row["labels"] == ["priority-high"]
        assert row["service"] == "api"
        assert row["section_header"] == "Root Cause"
        assert "metadata" not in row
