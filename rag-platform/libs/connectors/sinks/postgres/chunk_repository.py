"""PostgreSQL repository for chunk storage and retrieval.

This repository handles the persistence layer for document chunks,
providing CRUD operations and queries needed by the chunking pipeline.

SCHEMA DESIGN:
The chunks table stores the text and metadata for each chunk.
Chunks are linked to documents and versions via foreign keys.
The chunk_hash enables deduplication and change detection.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


class ChunkRepository:
    """Repository for chunk persistence operations.
    
    Provides methods to:
    - Insert chunks for a document version
    - Query chunks by document/version
    - Delete chunks when versions are superseded
    - Check for chunk existence (deduplication)
    """
    
    def __init__(self, dsn: str) -> None:
        """Initialize repository with database connection string.
        
        Args:
            dsn: PostgreSQL connection string.
        """
        self.dsn = dsn
    
    def insert_chunks(
        self,
        chunks: List[Dict[str, Any]],
        conn: Optional[psycopg.Connection] = None,
    ) -> int:
        """Insert multiple chunks in a batch.
        
        Args:
            chunks: List of chunk dictionaries with required fields:
                - chunk_id (UUID)
                - document_id (UUID)
                - version_id (UUID)
                - chunk_index (int)
                - chunk_text (str)
                - chunk_hash (str)
                - token_count (int)
                - char_count (int)
                - metadata (dict)
                - start_char_offset (int, optional)
                - end_char_offset (int, optional)
            conn: Optional existing connection for transaction support.
        
        Returns:
            Number of chunks inserted.
        """
        if not chunks:
            return 0
        
        sql = """
            INSERT INTO chunks (
                chunk_id, document_id, version_id, chunk_index,
                chunk_text, chunk_hash, token_count, char_count,
                metadata, start_char_offset, end_char_offset, created_at
            ) VALUES (
                %(chunk_id)s, %(document_id)s, %(version_id)s, %(chunk_index)s,
                %(chunk_text)s, %(chunk_hash)s, %(token_count)s, %(char_count)s,
                %(metadata)s, %(start_char_offset)s, %(end_char_offset)s, %(created_at)s
            )
            ON CONFLICT (chunk_id) DO NOTHING
        """
        
        now = datetime.now(timezone.utc)
        
        def execute(c: psycopg.Connection) -> int:
            inserted = 0
            for chunk in chunks:
                params = {
                    "chunk_id": str(chunk["chunk_id"]),
                    "document_id": str(chunk["document_id"]),
                    "version_id": str(chunk["version_id"]),
                    "chunk_index": chunk["chunk_index"],
                    "chunk_text": chunk["chunk_text"],
                    "chunk_hash": chunk["chunk_hash"],
                    "token_count": chunk["token_count"],
                    "char_count": chunk["char_count"],
                    "metadata": psycopg.types.json.Json(chunk.get("metadata", {})),
                    "start_char_offset": chunk.get("start_char_offset"),
                    "end_char_offset": chunk.get("end_char_offset"),
                    "created_at": now,
                }
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
    
    def get_chunks_for_version(
        self,
        version_id: UUID,
        conn: Optional[psycopg.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Get all chunks for a document version.
        
        Args:
            version_id: The version UUID.
            conn: Optional existing connection.
        
        Returns:
            List of chunk dictionaries ordered by chunk_index.
        """
        sql = """
            SELECT chunk_id, document_id, version_id, chunk_index,
                   chunk_text, chunk_hash, token_count, char_count,
                   metadata, start_char_offset, end_char_offset, created_at
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
        """Get chunks for a document, optionally filtering to active version only.
        
        Args:
            document_id: The document UUID.
            active_only: If True, only return chunks from active version.
            conn: Optional existing connection.
        
        Returns:
            List of chunk dictionaries.
        """
        if active_only:
            sql = """
                SELECT c.chunk_id, c.document_id, c.version_id, c.chunk_index,
                       c.chunk_text, c.chunk_hash, c.token_count, c.char_count,
                       c.metadata, c.start_char_offset, c.end_char_offset, c.created_at
                FROM chunks c
                JOIN document_versions dv ON c.version_id = dv.version_id
                WHERE c.document_id = %s AND dv.is_active = true
                ORDER BY c.chunk_index
            """
        else:
            sql = """
                SELECT chunk_id, document_id, version_id, chunk_index,
                       chunk_text, chunk_hash, token_count, char_count,
                       metadata, start_char_offset, end_char_offset, created_at
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
        """Delete all chunks for a version.
        
        Used when a version is superseded or deleted.
        
        Args:
            version_id: The version UUID.
            conn: Optional existing connection.
        
        Returns:
            Number of chunks deleted.
        """
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
        """Check if a chunk exists by ID.
        
        Args:
            chunk_id: The chunk UUID.
            conn: Optional existing connection.
        
        Returns:
            True if chunk exists.
        """
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
        """Count total chunks for a document across all versions.
        
        Args:
            document_id: The document UUID.
            conn: Optional existing connection.
        
        Returns:
            Total chunk count.
        """
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


# SQL for creating the chunks table (for reference/migrations)
CREATE_CHUNKS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(document_id),
    version_id UUID NOT NULL REFERENCES document_versions(version_id),
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_hash VARCHAR(64) NOT NULL,
    token_count INTEGER NOT NULL,
    char_count INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',
    start_char_offset INTEGER,
    end_char_offset INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_version_chunk_index UNIQUE (version_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_version_id ON chunks(version_id);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(chunk_hash);
"""
