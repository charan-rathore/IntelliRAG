"""Tests for GitHubIssueChunker."""

import unittest
from uuid import uuid4

from libs.rag.chunking.base import ChunkerConfig
from libs.rag.chunking.github_chunker import GitHubComment, GitHubIssueChunker
from libs.shared.models.chunk import ChunkMetadata
from libs.shared.models.lifecycle import IngestionSource


class TestGitHubIssueChunkerBasics(unittest.TestCase):
    """Basic functionality tests."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(
            chunk_size=100,
            chunk_overlap=10,
        )
        self.chunker = GitHubIssueChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(
            source_type=IngestionSource.GITHUB_ISSUE,
            source_uri="https://github.com/org/repo/issues/123",
        )

    def test_strategy_name(self) -> None:
        self.assertEqual(self.chunker.strategy_name, "github_issue")

    def test_simple_issue_body(self) -> None:
        body = "This is a bug report. The system crashes when I click submit."
        result = self.chunker.chunk(body, self.doc_id, self.version_id, self.metadata)
        self.assertEqual(result.total_chunks, 1)


class TestIssueWithTitle(unittest.TestCase):
    """Tests for chunk_issue_with_title method."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(chunk_size=100, chunk_overlap=10)
        self.chunker = GitHubIssueChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.GITHUB_ISSUE)

    def test_title_included_in_first_chunk(self) -> None:
        title = "Application crashes on login"
        body = "When clicking login button, the app crashes with error code 500."
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        self.assertIn(title, result.chunks[0].chunk_text)

    def test_first_chunk_marked_as_summary(self) -> None:
        title = "Bug Report"
        body = "Description of the bug."
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        self.assertTrue(result.chunks[0].metadata.is_summary_chunk)

    def test_empty_body_with_title(self) -> None:
        title = "Feature Request"
        body = ""
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        self.assertEqual(result.total_chunks, 1)
        self.assertIn(title, result.chunks[0].chunk_text)

    def test_empty_title_with_body(self) -> None:
        title = ""
        body = "This is the issue body content."
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        self.assertGreater(result.total_chunks, 0)
        self.assertIn("issue body", result.chunks[0].chunk_text)

    def test_both_empty_raises_error(self) -> None:
        with self.assertRaises(ValueError):
            self.chunker.chunk_issue_with_title(
                "", "", self.doc_id, self.version_id, self.metadata
            )

    def test_whitespace_body_treated_as_empty(self) -> None:
        title = "Title Only Issue"
        body = "   \n\n   "
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        self.assertEqual(result.total_chunks, 1)


class TestIssueWithCodeBlocks(unittest.TestCase):
    """Tests for issues containing code."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(chunk_size=150, chunk_overlap=15)
        self.chunker = GitHubIssueChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.GITHUB_ISSUE)

    def test_code_block_preserved(self) -> None:
        title = "Error in API call"
        body = """I get this error:

```python
response = api.call()
# Error: ConnectionRefused
```

Please help!"""
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("ConnectionRefused", all_text)
        self.assertIn("api.call()", all_text)


class TestCommentChunking(unittest.TestCase):
    """Tests for comment chunking."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(chunk_size=100, chunk_overlap=10)
        self.chunker = GitHubIssueChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.GITHUB_ISSUE_COMMENT)

    def test_single_comment(self) -> None:
        comments = [
            GitHubComment(
                author="user1",
                body="I can reproduce this bug.",
                comment_id="1",
            )
        ]
        result = self.chunker.chunk_comments(
            comments, self.doc_id, self.version_id, self.metadata
        )
        self.assertEqual(result.total_chunks, 1)
        self.assertIn("@user1", result.chunks[0].chunk_text)

    def test_multiple_comments(self) -> None:
        comments = [
            GitHubComment(author="user1", body="First comment.", comment_id="1"),
            GitHubComment(author="user2", body="Second comment.", comment_id="2"),
            GitHubComment(author="user3", body="Third comment.", comment_id="3"),
        ]
        result = self.chunker.chunk_comments(
            comments, self.doc_id, self.version_id, self.metadata
        )
        self.assertEqual(result.total_chunks, 3)

    def test_consecutive_comments_same_author_merged(self) -> None:
        comments = [
            GitHubComment(author="user1", body="Part one.", comment_id="1"),
            GitHubComment(author="user1", body="Part two.", comment_id="2"),
            GitHubComment(author="user2", body="Different user.", comment_id="3"),
        ]
        result = self.chunker.chunk_comments(
            comments, self.doc_id, self.version_id, self.metadata, merge_same_author=True
        )
        self.assertLessEqual(result.total_chunks, 3)

    def test_no_merge_when_disabled(self) -> None:
        comments = [
            GitHubComment(author="user1", body="Part one.", comment_id="1"),
            GitHubComment(author="user1", body="Part two.", comment_id="2"),
        ]
        result = self.chunker.chunk_comments(
            comments, self.doc_id, self.version_id, self.metadata, merge_same_author=False
        )
        self.assertEqual(result.total_chunks, 2)

    def test_empty_comments_list(self) -> None:
        result = self.chunker.chunk_comments(
            [], self.doc_id, self.version_id, self.metadata
        )
        self.assertEqual(result.total_chunks, 0)

    def test_comment_metadata_includes_author(self) -> None:
        comments = [
            GitHubComment(author="testuser", body="Test comment.", comment_id="123")
        ]
        result = self.chunker.chunk_comments(
            comments, self.doc_id, self.version_id, self.metadata
        )
        self.assertEqual(result.chunks[0].metadata.extra["comment_author"], "testuser")
        self.assertEqual(result.chunks[0].metadata.extra["comment_id"], "123")


class TestGitHubChunkerEdgeCases(unittest.TestCase):
    """Edge case tests."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(chunk_size=50, chunk_overlap=5)
        self.chunker = GitHubIssueChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(source_type=IngestionSource.GITHUB_ISSUE)

    def test_very_long_title(self) -> None:
        title = "Bug: " + "x" * 500
        body = "Short body."
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        self.assertGreater(result.total_chunks, 0)

    def test_unicode_in_issue(self) -> None:
        title = "Error: 日本語テスト"
        body = "Content with émojis 🐛 and special chars."
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("日本語", all_text)
        self.assertIn("🐛", all_text)

    def test_error_traces_preserved(self) -> None:
        title = "Stack trace error"
        body = """Error occurred:

```
Traceback (most recent call last):
  File "main.py", line 10, in <module>
    result = process()
  File "main.py", line 5, in process
    raise ValueError("Invalid input")
ValueError: Invalid input
```"""
        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("Traceback", all_text)
        self.assertIn("ValueError", all_text)


class TestRealWorldIssueScenario(unittest.TestCase):
    """Test with realistic GitHub issue content."""

    def setUp(self) -> None:
        self.config = ChunkerConfig(chunk_size=200, chunk_overlap=20)
        self.chunker = GitHubIssueChunker(self.config)
        self.doc_id = uuid4()
        self.version_id = uuid4()
        self.metadata = ChunkMetadata(
            source_type=IngestionSource.GITHUB_ISSUE,
            labels=["bug", "high-priority"],
            service="payment-api",
        )

    def test_realistic_bug_report(self) -> None:
        title = "Payment API returns 500 error intermittently"
        body = """## Description

The payment API is returning HTTP 500 errors approximately 5% of the time.

## Steps to Reproduce

1. Send a POST request to /api/v1/payments
2. Include valid payment details
3. Observe that ~5% of requests fail

## Expected Behavior

All valid requests should succeed.

## Actual Behavior

```json
{
  "error": "Internal Server Error",
  "code": 500
}
```

## Environment

- API Version: 2.3.1
- Region: us-east-1

## Logs

```
2024-01-15 10:23:45 ERROR PaymentProcessor: Database connection timeout
```"""

        result = self.chunker.chunk_issue_with_title(
            title, body, self.doc_id, self.version_id, self.metadata
        )
        
        self.assertIn("Payment API", result.chunks[0].chunk_text)
        self.assertTrue(result.chunks[0].metadata.is_summary_chunk)
        
        all_text = " ".join(c.chunk_text for c in result.chunks)
        self.assertIn("500", all_text)
        self.assertIn("PaymentProcessor", all_text)
        
        self.assertEqual(result.chunks[0].metadata.service, "payment-api")


if __name__ == "__main__":
    unittest.main()
