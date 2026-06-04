"""Lifecycle enums and state transitions for ingestion."""

from enum import Enum


class IngestionState(str, Enum):
    RECEIVED = "received"
    DEDUPE_CHECKED = "dedupe_checked"
    RAW_STORED = "raw_stored"
    REGISTERED = "registered"
    PARSED = "parsed"
    CHUNKED = "chunked"
    EMBEDDED = "embedded"
    INDEXED = "indexed"
    PUBLISHED = "published"
    FAILED = "failed"


class IngestionSource(str, Enum):
    GITHUB_ISSUE = "github_issue"
    GITHUB_ISSUE_COMMENT = "github_issue_comment"
    MARKDOWN_DOC = "markdown_doc"


class IngestionRunStatus(str, Enum):
    RECEIVED = "received"
    VALIDATED = "validated"
    DEDUPE_CHECKED = "dedupe_checked"
    RAW_STORED = "raw_stored"
    REGISTERED = "registered"
    SKIPPED_NO_CHANGE = "skipped_no_change"
    FAILED = "failed"
