"""Postgres persistence for canonical documents (V1)."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Iterable
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from libs.shared.models.document import CanonicalDocument, DocumentVersion


class PostgresDocumentRepository:
    """Minimal repository for CanonicalDocument persistence."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    @contextmanager
    def _conn(self):
        with psycopg.connect(self._dsn, row_factory=dict_row) as conn:
            yield conn

    def upsert_document(
        self,
        document: CanonicalDocument,
        conn: psycopg.Connection | None = None,
    ) -> None:
        query = """
        INSERT INTO documents (
            document_id, external_id, title, source_type, source_uri, tenant_id,
            owners, tags, labels, environment, service, component, access_policy,
            hash_content, created_at, updated_at, ingested_at, lifecycle_state
        ) VALUES (
            %(document_id)s, %(external_id)s, %(title)s, %(source_type)s, %(source_uri)s, %(tenant_id)s,
            %(owners)s, %(tags)s, %(labels)s, %(environment)s, %(service)s, %(component)s, %(access_policy)s,
            %(hash_content)s, %(created_at)s, %(updated_at)s, %(ingested_at)s, %(lifecycle_state)s
        )
        ON CONFLICT (document_id) DO UPDATE SET
            title = EXCLUDED.title,
            source_uri = EXCLUDED.source_uri,
            tenant_id = EXCLUDED.tenant_id,
            owners = EXCLUDED.owners,
            tags = EXCLUDED.tags,
            labels = EXCLUDED.labels,
            environment = EXCLUDED.environment,
            service = EXCLUDED.service,
            component = EXCLUDED.component,
            access_policy = EXCLUDED.access_policy,
            hash_content = EXCLUDED.hash_content,
            updated_at = EXCLUDED.updated_at,
            ingested_at = EXCLUDED.ingested_at,
            lifecycle_state = EXCLUDED.lifecycle_state
        """
        metadata = document.metadata
        params = {
            "document_id": str(document.document_id),
            "external_id": document.external_id,
            "title": document.title,
            "source_type": metadata.source_type.value,
            "source_uri": metadata.source_uri,
            "tenant_id": metadata.tenant_id,
            "owners": metadata.owners,
            "tags": metadata.tags,
            "labels": metadata.labels,
            "environment": metadata.environment,
            "service": metadata.service,
            "component": metadata.component,
            "access_policy": metadata.access_policy,
            "hash_content": document.hash_content,
            "created_at": document.created_at,
            "updated_at": document.updated_at,
            "ingested_at": document.ingested_at,
            "lifecycle_state": document.lifecycle_state.value,
        }
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, params)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(query, params)

    def insert_versions(
        self,
        versions: Iterable[DocumentVersion],
        conn: psycopg.Connection | None = None,
    ) -> None:
        query = """
        INSERT INTO document_versions (
            version_id, document_id, version_index, body_raw_uri, body_text,
            source_payload_uri, hash_payload, valid_from, valid_to, is_active
        ) VALUES (
            %(version_id)s, %(document_id)s, %(version_index)s, %(body_raw_uri)s, %(body_text)s,
            %(source_payload_uri)s, %(hash_payload)s, %(valid_from)s, %(valid_to)s, %(is_active)s
        )
        ON CONFLICT (document_id, hash_payload) DO NOTHING
        """
        rows = []
        for version in versions:
            rows.append(
                {
                    "version_id": str(version.version_id),
                    "document_id": str(version.document_id),
                    "version_index": version.version_index,
                    "body_raw_uri": version.body_raw_uri,
                    "body_text": version.body_text,
                    "source_payload_uri": version.source_payload_uri,
                    "hash_payload": version.hash_payload,
                    "valid_from": version.valid_from,
                    "valid_to": version.valid_to,
                    "is_active": version.is_active,
                }
            )
        if not rows:
            return
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.executemany(query, rows)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.executemany(query, rows)

    def get_active_version(
        self,
        document_id: UUID,
        conn: psycopg.Connection | None = None,
    ) -> dict | None:
        query = """
        SELECT * FROM document_versions
        WHERE document_id = %(document_id)s AND is_active = TRUE
        ORDER BY version_index DESC
        LIMIT 1
        """
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, {"document_id": str(document_id)})
                    return cur.fetchone()
        with conn.cursor() as cur:
            cur.execute(query, {"document_id": str(document_id)})
            return cur.fetchone()

    def get_document_id_by_source_uri(
        self,
        source_uri: str,
        conn: psycopg.Connection | None = None,
    ) -> UUID | None:
        query = """
        SELECT document_id
        FROM documents
        WHERE source_uri = %(source_uri)s
        LIMIT 1
        """
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, {"source_uri": source_uri})
                    row = cur.fetchone()
                    if not row:
                        return None
                    return row["document_id"]
        with conn.cursor() as cur:
            cur.execute(query, {"source_uri": source_uri})
            row = cur.fetchone()
            if not row:
                return None
            return row["document_id"]

    def update_lifecycle_state(
        self,
        document_id: UUID,
        lifecycle_state: str,
        conn: psycopg.Connection | None = None,
    ) -> None:
        """Update document lifecycle state."""
        query = """
        UPDATE documents
        SET lifecycle_state = %(lifecycle_state)s,
            updated_at = %(updated_at)s
        WHERE document_id = %(document_id)s
        """
        params = {
            "document_id": str(document_id),
            "lifecycle_state": lifecycle_state,
            "updated_at": datetime.now(),
        }
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, params)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(query, params)

    def get_document(
        self,
        document_id: UUID,
        conn: psycopg.Connection | None = None,
    ) -> dict | None:
        """Fetch a document row by ID."""
        query = """
        SELECT document_id, external_id, title, source_type, source_uri, tenant_id,
               owners, tags, labels, environment, service, component, access_policy,
               hash_content, created_at, updated_at, ingested_at, lifecycle_state
        FROM documents
        WHERE document_id = %(document_id)s
        LIMIT 1
        """
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, {"document_id": str(document_id)})
                    return cur.fetchone()
        with conn.cursor() as cur:
            cur.execute(query, {"document_id": str(document_id)})
            return cur.fetchone()

    def deactivate_active_version(
        self,
        document_id: UUID,
        valid_to: datetime,
        conn: psycopg.Connection | None = None,
    ) -> None:
        query = """
        UPDATE document_versions
        SET is_active = FALSE, valid_to = %(valid_to)s
        WHERE document_id = %(document_id)s AND is_active = TRUE
        """
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(
                        query,
                        {"document_id": str(document_id), "valid_to": valid_to},
                    )
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(
                    query,
                    {"document_id": str(document_id), "valid_to": valid_to},
                )
