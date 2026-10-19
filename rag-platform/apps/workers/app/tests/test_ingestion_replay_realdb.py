"""Real-Postgres regression test: stale webhook replays must not corrupt versions.

Replaying an OLD payload after a newer version is active used to leave the
document with ZERO active versions behind a "success" result: the dedupe
check only looked at the ACTIVE row, the transition deactivated it, and
insert_versions' ON CONFLICT (document_id, hash_payload) DO NOTHING silently
dropped the duplicate-hash row.

These tests run the real `_ingest_single_payload` against a real Postgres
(pgserver, local binaries) with the real repositories. They skip cleanly
where pgserver/Postgres is unavailable.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

pgserver = pytest.importorskip("pgserver", reason="pgserver not installed")

from apps.workers.app.tasks.ingestion.github.pipeline import (  # noqa: E402
    AtomicRawPayloadStore,
    _ingest_single_payload,
)
from libs.connectors.sinks.postgres.document_repository import (  # noqa: E402
    PostgresDocumentRepository,
)
from libs.connectors.sinks.postgres.ingestion_run_repository import (  # noqa: E402
    IngestionRunRepository,
)
from libs.connectors.sinks.postgres.raw_payload_repository import (  # noqa: E402
    RawPayloadRepository,
)
from libs.connectors.sources.github.transformer import GitHubTransformer  # noqa: E402
from libs.shared.logging.structured import IngestionLogger  # noqa: E402
from libs.shared.models.lifecycle import IngestionSource  # noqa: E402

MIGRATIONS = sorted(
    (Path(__file__).resolve().parents[4] / "infra" / "db" / "migrations").glob("*.sql")
)


def _issue_payload(issue_id: int, body: str) -> dict:
    return {
        "id": issue_id,
        "number": 7,
        "title": "Replay test issue",
        "body": body,
        "state": "open",
        "html_url": f"https://github.com/acme/repo/issues/{issue_id}",
        "repository_url": "https://api.github.com/repos/acme/repo",
        "created_at": "2026-10-01T00:00:00Z",
        "updated_at": "2026-10-01T00:00:00Z",
        "labels": [],
        "user": {"login": "reporter"},
    }


class TestStaleReplayRealDb(unittest.TestCase):
    """Replay an older payload after a newer one is active."""

    _server = None
    _tmpdir = None

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls._server = pgserver.get_server(cls._tmpdir.name)
        cls.dsn = cls._server.get_uri()
        with psycopg.connect(cls.dsn) as conn, conn.cursor() as cur:
            for migration in MIGRATIONS:
                cur.execute(migration.read_text())
            conn.commit()

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._server is not None:
            cls._server.cleanup()
        if cls._tmpdir is not None:
            cls._tmpdir.cleanup()

    def setUp(self) -> None:
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            for table in ("document_versions", "raw_payloads", "documents", "ingestion_runs"):
                cur.execute(f"DELETE FROM {table}")
            conn.commit()
        self.repository = PostgresDocumentRepository(self.dsn)
        self.raw_payload_repo = RawPayloadRepository(self.dsn)
        self.run_repo = IngestionRunRepository(self.dsn)
        self.payload_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.payload_dir.cleanup)
        self.transformer = GitHubTransformer(tenant_id="test-tenant")

    def _ingest(self, payload: dict):
        return _ingest_single_payload(
            payload=payload,
            source_type=IngestionSource.GITHUB_ISSUE,
            transformer=self.transformer,
            repository=self.repository,
            raw_payload_repo=self.raw_payload_repo,
            payload_store=AtomicRawPayloadStore(self.payload_dir.name),
            ingestion_run_repo=self.run_repo,
            ing_logger=IngestionLogger(run_id=uuid4()),
        )

    def _active_hashes(self) -> list[str]:
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT hash_payload FROM document_versions WHERE is_active = TRUE"
            )
            return [row[0] for row in cur.fetchall()]

    def test_stale_replay_never_leaves_zero_active_versions(self) -> None:
        first = _issue_payload(101, "original body")
        second = _issue_payload(101, "updated body")

        r1 = self._ingest(first)
        self.assertTrue(r1.success, "first ingest should register v1")
        r2 = self._ingest(second)
        self.assertTrue(r2.success, "update should register v2")
        self.assertEqual(len(self._active_hashes()), 1)

        # The stale replay: same bytes as v1, delivered again AFTER v2.
        replay = self._ingest(first)

        # At-least-once delivery must be idempotent: the replay is a
        # duplicate, not a new version, and must not disturb the active one.
        self.assertTrue(replay.success, "a duplicate replay still reports success")
        active = self._active_hashes()
        self.assertEqual(len(active), 1, "document must keep exactly one active version")
        hash_v2 = self.transformer.issue_to_document(second)[1].hash_payload
        self.assertEqual(active[0], hash_v2, "the NEWER version must stay active")

    def test_reingest_of_current_payload_still_skips(self) -> None:
        payload = _issue_payload(202, "only body")
        self.assertTrue(self._ingest(payload).success)
        result = self._ingest(payload)
        self.assertTrue(result.success)
        self.assertEqual(len(self._active_hashes()), 1)


if __name__ == "__main__":
    unittest.main()
