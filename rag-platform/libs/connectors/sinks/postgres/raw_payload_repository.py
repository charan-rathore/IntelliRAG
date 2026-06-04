"""Postgres persistence for raw payload metadata."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Optional
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


class RawPayloadRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    @contextmanager
    def _conn(self):
        with psycopg.connect(self._dsn, row_factory=dict_row) as conn:
            yield conn

    def insert_payload(
        self,
        payload_id: UUID,
        document_id: UUID,
        source_type: str,
        source_uri: Optional[str],
        storage_uri: str,
        hash_payload: str,
        received_at: datetime,
        conn: psycopg.Connection | None = None,
    ) -> None:
        query = """
        INSERT INTO raw_payloads (
            payload_id, document_id, source_type, source_uri,
            storage_uri, hash_payload, received_at
        ) VALUES (
            %(payload_id)s, %(document_id)s, %(source_type)s, %(source_uri)s,
            %(storage_uri)s, %(hash_payload)s, %(received_at)s
        )
        ON CONFLICT (document_id, hash_payload) DO NOTHING
        """
        params = {
            "payload_id": str(payload_id),
            "document_id": str(document_id),
            "source_type": source_type,
            "source_uri": source_uri,
            "storage_uri": storage_uri,
            "hash_payload": hash_payload,
            "received_at": received_at,
        }
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, params)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(query, params)

    def get_latest_payload_uri(
        self,
        document_id: UUID,
        conn: psycopg.Connection | None = None,
    ) -> Optional[str]:
        query = """
        SELECT storage_uri
        FROM raw_payloads
        WHERE document_id = %(document_id)s
        ORDER BY received_at DESC
        LIMIT 1
        """
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, {"document_id": str(document_id)})
                    row = cur.fetchone()
                    if not row:
                        return None
                    return row["storage_uri"]
        with conn.cursor() as cur:
            cur.execute(query, {"document_id": str(document_id)})
            row = cur.fetchone()
            if not row:
                return None
            return row["storage_uri"]

    def list_payloads_for_document(self, document_id: UUID) -> list[dict]:
        query = """
        SELECT payload_id, document_id, source_type, source_uri, storage_uri, hash_payload, received_at
        FROM raw_payloads
        WHERE document_id = %(document_id)s
        ORDER BY received_at DESC
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, {"document_id": str(document_id)})
                return cur.fetchall() or []
