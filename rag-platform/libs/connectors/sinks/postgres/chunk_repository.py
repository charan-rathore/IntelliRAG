"""PostgreSQL repository for chunk storage and retrieval.

Persists chunks as the system of record (migration 005 schema).
Tracks embedding and indexing status for pipeline orchestration.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from libs.shared.models.chunk import Chunk

from .chunk_utils import chunk_to_row


class ChunkRepository:
    """Repository for chunk persistence operations."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    def insert_chunks(
        self,
        chunks: List[Chunk],
        conn: Optional[psycopg.Connection] = None,
    ) -> int:
        """Insert multiple chunks in a batch."""
        if not chunks:
            return 0

        sql = """
            INSERT INTO chunks (
                chunk_id, document_id, version_id, chunk_index,
                chunk_text, chunk_hash, token_count, char_count,
                start_char_offset, end_char_offset,
                source_type, source_uri, tenant_id, section_header,
                has_code_block, is_summary_chunk, tags, labels,
                service, component, created_at
            ) VALUES (
                %(chunk_id)s, %(document_id)s, %(version_id)s, %(chunk_index)s,
                %(chunk_text)s, %(chunk_hash)s, %(token_count)s, %(char_count)s,
                %(start_char_offset)s, %(end_char_offset)s,
                %(source_type)s, %(source_uri)s, %(tenant_id)s, %(section_header)s,
                %(has_code_block)s, %(is_summary_chunk)s, %(tags)s, %(labels)s,
                %(service)s, %(component)s, %(created_at)s
            )
            ON CONFLICT (chunk_id) DO NOTHING
        """

        now = datetime.now(timezone.utc)

        def execute(c: psycopg.Connection) -> int:
            inserted = 0
            for chunk in chunks:
                params = chunk_to_row(chunk)
                params["created_at"] = now
                result = c.execute(sql, params)
                if result.rowcount > 0:
                    inserted += 1
            return inserted

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn) as c:
            result = execute(c)
            c.commit()
            return result

    def mark_embedded(
        self,
        chunk_ids: List[UUID],
        embedding_model: str,
        embedding_dimensions: int,
        conn: Optional[psycopg.Connection] = None,
    ) -> int:
        """Mark chunks as embedded after successful embedding generation."""
        if not chunk_ids:
            return 0

        sql = """
            UPDATE chunks
            SET is_embedded = TRUE,
                embedding_model = %(embedding_model)s,
                embedding_dimensions = %(embedding_dimensions)s,
                embedding_generated_at = %(generated_at)s
            WHERE chunk_id = ANY(%(chunk_ids)s)
        """
        params = {
            "chunk_ids": [str(cid) for cid in chunk_ids],
            "embedding_model": embedding_model,
            "embedding_dimensions": embedding_dimensions,
            "generated_at": datetime.now(timezone.utc),
        }

        def execute(c: psycopg.Connection) -> int:
            result = c.execute(sql, params)
            return result.rowcount

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn) as c:
            updated = execute(c)
            c.commit()
            return updated

    def mark_indexed(
        self,
        chunk_ids: List[UUID],
        collection_name: str,
        conn: Optional[psycopg.Connection] = None,
    ) -> int:
        """Mark chunks as indexed in the vector store."""
        if not chunk_ids:
            return 0

        sql = """
            UPDATE chunks
            SET is_indexed = TRUE,
                vector_store_collection = %(collection_name)s,
                indexed_at = %(indexed_at)s
            WHERE chunk_id = ANY(%(chunk_ids)s)
        """
        params = {
            "chunk_ids": [str(cid) for cid in chunk_ids],
            "collection_name": collection_name,
            "indexed_at": datetime.now(timezone.utc),
        }

        def execute(c: psycopg.Connection) -> int:
            result = c.execute(sql, params)
            return result.rowcount

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn) as c:
            updated = execute(c)
            c.commit()
            return updated

    def get_chunks_for_version(
        self,
        version_id: UUID,
        conn: Optional[psycopg.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Get all chunks for a document version."""
        sql = """
            SELECT chunk_id, document_id, version_id, chunk_index,
                   chunk_text, chunk_hash, token_count, char_count,
                   source_type, source_uri, tenant_id, section_header,
                   has_code_block, is_summary_chunk, tags, labels,
                   service, component,
                   is_embedded, is_indexed, embedding_model,
                   start_char_offset, end_char_offset, created_at
            FROM chunks
            WHERE version_id = %s
            ORDER BY chunk_index
        """

        def execute(c: psycopg.Connection) -> List[Dict[str, Any]]:
            with c.cursor(row_factory=dict_row) as cur:
                cur.execute(sql, (str(version_id),))
                return list(cur.fetchall())

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn, row_factory=dict_row) as c:
            return execute(c)

    def get_chunks_for_document(
        self,
        document_id: UUID,
        active_only: bool = True,
        conn: Optional[psycopg.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Get chunks for a document, optionally filtering to active version only."""
        if active_only:
            sql = """
                SELECT c.chunk_id, c.document_id, c.version_id, c.chunk_index,
                       c.chunk_text, c.chunk_hash, c.token_count, c.char_count,
                       c.source_type, c.source_uri, c.tenant_id, c.section_header,
                       c.has_code_block, c.is_summary_chunk, c.tags, c.labels,
                       c.service, c.component,
                       c.is_embedded, c.is_indexed, c.embedding_model,
                       c.start_char_offset, c.end_char_offset, c.created_at
                FROM chunks c
                JOIN document_versions dv ON c.version_id = dv.version_id
                WHERE c.document_id = %s AND dv.is_active = true
                ORDER BY c.chunk_index
            """
        else:
            sql = """
                SELECT chunk_id, document_id, version_id, chunk_index,
                       chunk_text, chunk_hash, token_count, char_count,
                       source_type, source_uri, tenant_id, section_header,
                       has_code_block, is_summary_chunk, tags, labels,
                       service, component,
                       is_embedded, is_indexed, embedding_model,
                       start_char_offset, end_char_offset, created_at
                FROM chunks
                WHERE document_id = %s
                ORDER BY version_id, chunk_index
            """

        def execute(c: psycopg.Connection) -> List[Dict[str, Any]]:
            with c.cursor(row_factory=dict_row) as cur:
                cur.execute(sql, (str(document_id),))
                return list(cur.fetchall())

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn, row_factory=dict_row) as c:
            return execute(c)

    def delete_chunks_for_version(
        self,
        version_id: UUID,
        conn: Optional[psycopg.Connection] = None,
    ) -> int:
        """Delete all chunks for a version."""
        sql = "DELETE FROM chunks WHERE version_id = %s"

        def execute(c: psycopg.Connection) -> int:
            result = c.execute(sql, (str(version_id),))
            return result.rowcount

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn) as c:
            deleted = execute(c)
            c.commit()
            return deleted

    def chunk_exists(
        self,
        chunk_id: UUID,
        conn: Optional[psycopg.Connection] = None,
    ) -> bool:
        """Check if a chunk exists by ID."""
        sql = "SELECT 1 FROM chunks WHERE chunk_id = %s LIMIT 1"

        def execute(c: psycopg.Connection) -> bool:
            with c.cursor() as cur:
                cur.execute(sql, (str(chunk_id),))
                return cur.fetchone() is not None

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn) as c:
            return execute(c)

    def count_chunks_for_document(
        self,
        document_id: UUID,
        conn: Optional[psycopg.Connection] = None,
    ) -> int:
        """Count total chunks for a document across all versions."""
        sql = "SELECT COUNT(*) FROM chunks WHERE document_id = %s"

        def execute(c: psycopg.Connection) -> int:
            with c.cursor() as cur:
                cur.execute(sql, (str(document_id),))
                row = cur.fetchone()
                return row[0] if row else 0

        if conn:
            return execute(conn)

        with psycopg.connect(self.dsn) as c:
            return execute(c)
