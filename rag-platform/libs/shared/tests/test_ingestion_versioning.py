"""Unit tests for ingestion versioning behavior."""

import unittest
from datetime import datetime, timezone

from apps.workers.app.tasks.ingestion.github.pipeline import _prepare_version_transition


class TestIngestionVersioning(unittest.TestCase):
    def test_first_version(self) -> None:
        now = datetime.now(timezone.utc)
        version_index, should_deactivate = _prepare_version_transition(None, now)
        self.assertEqual(version_index, 1)
        self.assertFalse(should_deactivate)

    def test_update_version_increments(self) -> None:
        now = datetime.now(timezone.utc)
        active = {"version_index": 3}
        version_index, should_deactivate = _prepare_version_transition(active, now)
        self.assertEqual(version_index, 4)
        self.assertTrue(should_deactivate)


if __name__ == "__main__":
    unittest.main()
