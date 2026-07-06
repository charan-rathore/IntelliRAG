"""Chunk to database row conversion helpers (no database dependency)."""

from __future__ import annotations

from typing import Any, Dict

from libs.shared.models.chunk import Chunk


def chunk_to_row(chunk: Chunk) -> Dict[str, Any]:
    """Convert a Chunk model to a Postgres row dictionary."""
    meta = chunk.metadata
    return {
        "chunk_id": str(chunk.chunk_id),
        "document_id": str(chunk.document_id),
        "version_id": str(chunk.version_id),
        "chunk_index": chunk.chunk_index,
        "chunk_text": chunk.chunk_text,
        "chunk_hash": chunk.chunk_hash,
        "token_count": chunk.token_count,
        "char_count": chunk.char_count,
        "start_char_offset": chunk.start_char_offset,
        "end_char_offset": chunk.end_char_offset,
        "source_type": meta.source_type.value,
        "source_uri": meta.source_uri,
        "tenant_id": meta.tenant_id,
        "section_header": meta.section_header,
        "has_code_block": meta.has_code_block,
        "is_summary_chunk": meta.is_summary_chunk,
        "tags": meta.tags or [],
        "labels": meta.labels or [],
        "service": meta.service,
        "component": meta.component,
    }
