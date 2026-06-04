"""Postgres persistence for ingestion run tracking."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Optional
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


class IngestionRunRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    @contextmanager
    def _conn(self):
        with psycopg.connect(self._dsn, row_factory=dict_row) as conn:
            yield conn

    def create_run(
        self,
        run_id: UUID,
        source_type: str,
        status: str,
        started_at: datetime,
        source_uri: Optional[str] = None,
        external_id: Optional[str] = None,
        document_id: Optional[UUID] = None,
        payload_hash: Optional[str] = None,
        conn: Optional[psycopg.Connection] = None,
    ) -> None:
        query = """
        INSERT INTO ingestion_runs (
            run_id, source_type, source_uri, external_id, document_id,
            payload_hash, status, started_at
        ) VALUES (
            %(run_id)s, %(source_type)s, %(source_uri)s, %(external_id)s, %(document_id)s,
            %(payload_hash)s, %(status)s, %(started_at)s
        )
        """
        params = {
            "run_id": str(run_id),
            "source_type": source_type,
            "source_uri": source_uri,
            "external_id": external_id,
            "document_id": str(document_id) if document_id else None,
            "payload_hash": payload_hash,
            "status": status,
            "started_at": started_at,
        }
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, params)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(query, params)

    def update_status(
        self,
        run_id: UUID,
        status: str,
        finished_at: Optional[datetime] = None,
        error_message: Optional[str] = None,
        document_id: Optional[UUID] = None,
        payload_hash: Optional[str] = None,
        conn: Optional[psycopg.Connection] = None,
    ) -> None:
        query = """
        UPDATE ingestion_runs
        SET status = %(status)s,
            finished_at = COALESCE(%(finished_at)s, finished_at),
            error_message = COALESCE(%(error_message)s, error_message),
            document_id = COALESCE(%(document_id)s, document_id),
            payload_hash = COALESCE(%(payload_hash)s, payload_hash)
        WHERE run_id = %(run_id)s
        """
        params = {
            "run_id": str(run_id),
            "status": status,
            "finished_at": finished_at,
            "error_message": error_message,
            "document_id": str(document_id) if document_id else None,
            "payload_hash": payload_hash,
        }
        if conn is None:
            with self._conn() as owned_conn:
                with owned_conn.cursor() as cur:
                    cur.execute(query, params)
                    owned_conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute(query, params)

    def get_run(self, run_id: UUID) -> Optional[dict]:
        query = """
        SELECT run_id, source_type, source_uri, external_id, document_id, payload_hash,
               status, error_message, started_at, finished_at
        FROM ingestion_runs
        WHERE run_id = %(run_id)s
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, {"run_id": str(run_id)})
                return cur.fetchone()

    def list_runs(
        self,
        status: Optional[str] = None,
        source_type: Optional[str] = None,
        document_id: Optional[UUID] = None,
        external_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        conditions = []
        params = {"limit": limit, "offset": offset}
        if status:
            conditions.append("status = %(status)s")
            params["status"] = status
        if source_type:
            conditions.append("source_type = %(source_type)s")
            params["source_type"] = source_type
        if document_id:
            conditions.append("document_id = %(document_id)s")
            params["document_id"] = str(document_id)
        if external_id:
            conditions.append("external_id = %(external_id)s")
            params["external_id"] = external_id

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        query = f"""
        SELECT run_id, source_type, source_uri, external_id, document_id, payload_hash,
               status, error_message, started_at, finished_at
        FROM ingestion_runs
        {where_clause}
        ORDER BY started_at DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                return cur.fetchall() or []
