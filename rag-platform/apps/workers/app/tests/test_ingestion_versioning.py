"""Tests for ingestion versioning and hash-based update detection."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from apps.workers.app.tasks.ingestion.github.pipeline import _prepare_version_transition
from libs.connectors.sources.github.transformer import GitHubTransformer


class TestIngestionVersioning(unittest.TestCase):
    def test_prepare_version_transition_new(self) -> None:
        now = datetime.now(timezone.utc)
        version_index, should_deactivate = _prepare_version_transition(None, now)
        self.assertEqual(version_index, 1)
        self.assertFalse(should_deactivate)

    def test_prepare_version_transition_existing(self) -> None:
        now = datetime.now(timezone.utc)
        active = {"version_index": 3}
        version_index, should_deactivate = _prepare_version_transition(active, now)
        self.assertEqual(version_index, 4)
        self.assertTrue(should_deactivate)

    def test_payload_hash_changes_on_update(self) -> None:
        transformer = GitHubTransformer()
        base_payload = {
            "id": 100,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "Hello",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
            "labels": [],
            "repository_url": "https://api.github.com/repos/org/repo",
            "number": 1,
            "state": "open",
        }
        _, version_a = transformer.issue_to_document(base_payload)
        updated_payload = dict(base_payload)
        updated_payload["body"] = "Hello updated"
        _, version_b = transformer.issue_to_document(updated_payload)
        self.assertNotEqual(version_a.hash_payload, version_b.hash_payload)


if __name__ == "__main__":
    unittest.main()
