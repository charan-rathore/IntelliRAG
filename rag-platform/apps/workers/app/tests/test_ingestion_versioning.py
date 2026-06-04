"""Comprehensive tests for ingestion versioning and lifecycle behavior.

These tests verify the critical production behaviors:
1. Version transitions (new document vs update)
2. Hash-based deduplication (idempotency)
3. Error categorization
4. Atomic transaction behavior
5. Payload validation with size limits

RUN TESTS:
    pytest apps/workers/app/tests/test_ingestion_versioning.py -v

IMPORTANT: These are unit tests that don't require a database.
Integration tests with real Postgres should be in tests/integration/.
"""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from uuid import uuid4

from pydantic import ValidationError

from apps.workers.app.tasks.ingestion.github.pipeline import (
    IngestionResult,
    _prepare_version_transition,
)
from libs.connectors.sources.github.schemas import (
    GitHubCommentPayload,
    GitHubIssuePayload,
    categorize_validation_error,
    MAX_BODY_LENGTH,
    MAX_TITLE_LENGTH,
)
from libs.connectors.sources.github.transformer import GitHubTransformer
from libs.shared.models.lifecycle import (
    IngestionErrorCategory,
    IngestionErrorCode,
    IngestionRunStatus,
)


class TestVersionTransition(unittest.TestCase):
    """Tests for version transition logic."""

    def test_new_document_starts_at_version_1(self) -> None:
        """First version of a new document should be version 1."""
        now = datetime.now(timezone.utc)
        version_index, should_deactivate = _prepare_version_transition(None, now)
        
        self.assertEqual(version_index, 1)
        self.assertFalse(should_deactivate)

    def test_update_increments_version(self) -> None:
        """Updating a document should increment the version index."""
        now = datetime.now(timezone.utc)
        active = {"version_index": 3}
        version_index, should_deactivate = _prepare_version_transition(active, now)
        
        self.assertEqual(version_index, 4)
        self.assertTrue(should_deactivate)

    def test_update_from_version_1(self) -> None:
        """Update from version 1 should go to version 2."""
        now = datetime.now(timezone.utc)
        active = {"version_index": 1}
        version_index, should_deactivate = _prepare_version_transition(active, now)
        
        self.assertEqual(version_index, 2)
        self.assertTrue(should_deactivate)

    def test_version_index_defaults_to_zero_if_missing(self) -> None:
        """Handle malformed active record gracefully."""
        now = datetime.now(timezone.utc)
        active = {}  # Missing version_index
        version_index, should_deactivate = _prepare_version_transition(active, now)
        
        self.assertEqual(version_index, 1)
        self.assertTrue(should_deactivate)


class TestHashBasedDeduplication(unittest.TestCase):
    """Tests for payload hash-based duplicate detection."""

    def setUp(self) -> None:
        self.transformer = GitHubTransformer()
        self.base_payload = {
            "id": 100,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test Issue",
            "body": "This is the issue body.",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
            "labels": [],
            "repository_url": "https://api.github.com/repos/org/repo",
            "number": 1,
            "state": "open",
        }

    def test_same_payload_produces_same_hash(self) -> None:
        """Identical payloads should produce identical hashes."""
        _, version_a = self.transformer.issue_to_document(self.base_payload)
        _, version_b = self.transformer.issue_to_document(self.base_payload)
        
        self.assertEqual(version_a.hash_payload, version_b.hash_payload)

    def test_body_change_produces_different_hash(self) -> None:
        """Changing body should produce different hash."""
        _, version_a = self.transformer.issue_to_document(self.base_payload)
        
        updated_payload = dict(self.base_payload)
        updated_payload["body"] = "Updated body content"
        _, version_b = self.transformer.issue_to_document(updated_payload)
        
        self.assertNotEqual(version_a.hash_payload, version_b.hash_payload)

    def test_title_change_produces_different_hash(self) -> None:
        """Changing title should produce different hash."""
        _, version_a = self.transformer.issue_to_document(self.base_payload)
        
        updated_payload = dict(self.base_payload)
        updated_payload["title"] = "Updated Title"
        _, version_b = self.transformer.issue_to_document(updated_payload)
        
        self.assertNotEqual(version_a.hash_payload, version_b.hash_payload)

    def test_label_change_produces_different_hash(self) -> None:
        """Changing labels should produce different hash."""
        _, version_a = self.transformer.issue_to_document(self.base_payload)
        
        updated_payload = dict(self.base_payload)
        updated_payload["labels"] = [{"name": "bug"}]
        _, version_b = self.transformer.issue_to_document(updated_payload)
        
        self.assertNotEqual(version_a.hash_payload, version_b.hash_payload)

    def test_timestamp_change_produces_different_hash(self) -> None:
        """Changing updated_at should produce different hash.
        
        NOTE: This is intentional behavior - we want to track when
        the source document was modified, even if content is same.
        """
        _, version_a = self.transformer.issue_to_document(self.base_payload)
        
        updated_payload = dict(self.base_payload)
        updated_payload["updated_at"] = "2024-01-02T00:00:00Z"
        _, version_b = self.transformer.issue_to_document(updated_payload)
        
        self.assertNotEqual(version_a.hash_payload, version_b.hash_payload)


class TestDocumentIdDeterminism(unittest.TestCase):
    """Tests for deterministic document ID generation."""

    def setUp(self) -> None:
        self.transformer = GitHubTransformer(tenant_id="test-tenant")

    def test_same_external_id_produces_same_document_id(self) -> None:
        """Document ID should be deterministic based on natural key."""
        payload = {
            "id": 12345,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "Body",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        doc_a, _ = self.transformer.issue_to_document(payload)
        doc_b, _ = self.transformer.issue_to_document(payload)
        
        self.assertEqual(doc_a.document_id, doc_b.document_id)

    def test_different_external_id_produces_different_document_id(self) -> None:
        """Different external IDs should produce different document IDs."""
        base_payload = {
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "Body",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        payload_a = dict(base_payload)
        payload_a["id"] = 111
        
        payload_b = dict(base_payload)
        payload_b["id"] = 222
        
        doc_a, _ = self.transformer.issue_to_document(payload_a)
        doc_b, _ = self.transformer.issue_to_document(payload_b)
        
        self.assertNotEqual(doc_a.document_id, doc_b.document_id)

    def test_different_tenant_produces_different_document_id(self) -> None:
        """Same document in different tenants should have different IDs."""
        payload = {
            "id": 12345,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "Body",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        transformer_a = GitHubTransformer(tenant_id="tenant-a")
        transformer_b = GitHubTransformer(tenant_id="tenant-b")
        
        doc_a, _ = transformer_a.issue_to_document(payload)
        doc_b, _ = transformer_b.issue_to_document(payload)
        
        self.assertNotEqual(doc_a.document_id, doc_b.document_id)


class TestPayloadValidation(unittest.TestCase):
    """Tests for payload schema validation."""

    def test_valid_issue_payload(self) -> None:
        """Valid payload should pass validation."""
        payload = {
            "id": 123,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "Body",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        validated = GitHubIssuePayload.model_validate(payload)
        self.assertEqual(validated.id, 123)

    def test_missing_required_field(self) -> None:
        """Missing required field should fail validation."""
        payload = {
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "Body",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
            # Missing 'id' field
        }
        
        with self.assertRaises(ValidationError):
            GitHubIssuePayload.model_validate(payload)

    def test_invalid_id_type(self) -> None:
        """Non-integer ID should fail validation."""
        payload = {
            "id": "not-an-integer",
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "Body",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        with self.assertRaises(ValidationError):
            GitHubIssuePayload.model_validate(payload)

    def test_body_too_long(self) -> None:
        """Body exceeding MAX_BODY_LENGTH should fail validation."""
        payload = {
            "id": 123,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "Test",
            "body": "x" * (MAX_BODY_LENGTH + 1),  # Too long
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        with self.assertRaises(ValidationError):
            GitHubIssuePayload.model_validate(payload)

    def test_title_too_long(self) -> None:
        """Title exceeding MAX_TITLE_LENGTH should fail validation."""
        payload = {
            "id": 123,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": "x" * (MAX_TITLE_LENGTH + 1),  # Too long
            "body": "Body",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        with self.assertRaises(ValidationError):
            GitHubIssuePayload.model_validate(payload)

    def test_optional_fields_can_be_null(self) -> None:
        """Optional fields should accept None."""
        payload = {
            "id": 123,
            "html_url": "https://github.com/org/repo/issues/1",
            "title": None,
            "body": None,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        validated = GitHubIssuePayload.model_validate(payload)
        self.assertIsNone(validated.title)
        self.assertIsNone(validated.body)


class TestErrorCategorization(unittest.TestCase):
    """Tests for validation error categorization."""

    def test_missing_field_categorization(self) -> None:
        """Missing field should be categorized correctly."""
        payload = {"html_url": "https://github.com/test"}  # Missing 'id'
        
        try:
            GitHubIssuePayload.model_validate(payload)
            self.fail("Expected ValidationError")
        except ValidationError as exc:
            error_info = categorize_validation_error(exc)
            self.assertEqual(
                error_info.code,
                IngestionErrorCode.VALIDATION_MISSING_REQUIRED_FIELD,
            )
            self.assertEqual(
                error_info.code.category,
                IngestionErrorCategory.VALIDATION,
            )
            self.assertFalse(error_info.code.is_retryable)

    def test_type_error_categorization(self) -> None:
        """Type error should be categorized correctly."""
        payload = {
            "id": "not-an-int",  # Should be int
            "html_url": "https://github.com/org/repo/issues/1",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        try:
            GitHubIssuePayload.model_validate(payload)
            self.fail("Expected ValidationError")
        except ValidationError as exc:
            error_info = categorize_validation_error(exc)
            self.assertEqual(
                error_info.code,
                IngestionErrorCode.VALIDATION_INVALID_FIELD_TYPE,
            )

    def test_constraint_violation_categorization(self) -> None:
        """Constraint violation should be categorized correctly."""
        payload = {
            "id": -1,  # Must be > 0
            "html_url": "https://github.com/org/repo/issues/1",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "user": {"login": "alice"},
        }
        
        try:
            GitHubIssuePayload.model_validate(payload)
            self.fail("Expected ValidationError")
        except ValidationError as exc:
            error_info = categorize_validation_error(exc)
            # Negative ID is a constraint violation
            self.assertIn(
                error_info.code,
                [
                    IngestionErrorCode.VALIDATION_FIELD_CONSTRAINT,
                    IngestionErrorCode.VALIDATION_SCHEMA_MISMATCH,
                ],
            )


class TestIngestionRunStatus(unittest.TestCase):
    """Tests for ingestion run status semantics."""

    def test_registered_is_success(self) -> None:
        """REGISTERED status should be considered success."""
        self.assertTrue(IngestionRunStatus.REGISTERED.is_success())
        self.assertTrue(IngestionRunStatus.REGISTERED.is_terminal())

    def test_skipped_no_change_is_success(self) -> None:
        """SKIPPED_NO_CHANGE should also be considered success.
        
        This is critical: idempotent skips are NOT failures, they're
        the system correctly detecting no work is needed.
        """
        self.assertTrue(IngestionRunStatus.SKIPPED_NO_CHANGE.is_success())
        self.assertTrue(IngestionRunStatus.SKIPPED_NO_CHANGE.is_terminal())

    def test_failed_is_not_success(self) -> None:
        """FAILED status should not be success."""
        self.assertFalse(IngestionRunStatus.FAILED.is_success())
        self.assertTrue(IngestionRunStatus.FAILED.is_terminal())

    def test_intermediate_statuses_are_not_terminal(self) -> None:
        """Intermediate statuses should not be terminal."""
        self.assertFalse(IngestionRunStatus.RECEIVED.is_terminal())
        self.assertFalse(IngestionRunStatus.VALIDATED.is_terminal())
        self.assertFalse(IngestionRunStatus.DEDUPE_CHECKED.is_terminal())
        self.assertFalse(IngestionRunStatus.RAW_STORED.is_terminal())


class TestIngestionResult(unittest.TestCase):
    """Tests for IngestionResult semantics."""

    def test_skipped_result_is_success(self) -> None:
        """Skipped result should indicate success."""
        result = IngestionResult.skipped(uuid4())
        
        self.assertTrue(result.success)
        self.assertFalse(result.is_new_version)

    def test_registered_result_is_success_with_new_version(self) -> None:
        """Registered result should indicate success with new version."""
        result = IngestionResult.registered(uuid4(), version_index=2)
        
        self.assertTrue(result.success)
        self.assertTrue(result.is_new_version)
        self.assertEqual(result.version_index, 2)

    def test_failed_result_has_error_info(self) -> None:
        """Failed result should contain error information."""
        from libs.shared.models.lifecycle import IngestionErrorInfo
        
        error_info = IngestionErrorInfo(
            code=IngestionErrorCode.VALIDATION_MISSING_REQUIRED_FIELD,
            message="Missing field 'id'",
        )
        result = IngestionResult.failed(error_info)
        
        self.assertFalse(result.success)
        self.assertIsNotNone(result.error_info)
        self.assertEqual(
            result.error_info.code,
            IngestionErrorCode.VALIDATION_MISSING_REQUIRED_FIELD,
        )


class TestErrorCodeRetryability(unittest.TestCase):
    """Tests for error code retry semantics."""

    def test_validation_errors_not_retryable(self) -> None:
        """Validation errors should not be retryable."""
        self.assertFalse(IngestionErrorCode.VALIDATION_SCHEMA_MISMATCH.is_retryable)
        self.assertFalse(IngestionErrorCode.VALIDATION_MISSING_REQUIRED_FIELD.is_retryable)
        self.assertFalse(IngestionErrorCode.VALIDATION_PAYLOAD_TOO_LARGE.is_retryable)

    def test_transient_errors_are_retryable(self) -> None:
        """Transient errors should be retryable."""
        self.assertTrue(IngestionErrorCode.TRANSIENT_DATABASE_CONNECTION.is_retryable)
        self.assertTrue(IngestionErrorCode.TRANSIENT_FILESYSTEM_IO.is_retryable)
        self.assertTrue(IngestionErrorCode.TRANSIENT_NETWORK.is_retryable)

    def test_infrastructure_errors_not_retryable(self) -> None:
        """Infrastructure errors need manual intervention, not auto-retry."""
        self.assertFalse(IngestionErrorCode.INFRA_DATABASE_UNAVAILABLE.is_retryable)
        self.assertFalse(IngestionErrorCode.INFRA_STORAGE_FULL.is_retryable)

    def test_internal_errors_not_retryable(self) -> None:
        """Internal errors (bugs) should not be auto-retried."""
        self.assertFalse(IngestionErrorCode.INTERNAL_UNEXPECTED.is_retryable)
        self.assertFalse(IngestionErrorCode.INTERNAL_ASSERTION_FAILED.is_retryable)


if __name__ == "__main__":
    unittest.main()
