"""Pydantic schemas for GitHub payload validation with size limits.

This module provides strict validation for GitHub webhook payloads with:
- Type checking for all fields
- Size limits to prevent DoS via oversized payloads
- Structured error categorization for operational handling

SIZE LIMITS RATIONALE:
- title: 256 chars (GitHub limit)
- body: 65535 chars (GitHub limit, ~64KB)
- html_url: 2048 chars (URL practical limit)

These limits prevent memory exhaustion attacks while allowing legitimate data.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, HttpUrl

from libs.shared.models.lifecycle import IngestionErrorCode, IngestionErrorInfo


# Size limits (aligned with GitHub's actual limits)
MAX_TITLE_LENGTH = 256
MAX_BODY_LENGTH = 65535  # 64KB
MAX_URL_LENGTH = 2048
MAX_LABELS = 100


class GitHubUser(BaseModel):
    """GitHub user reference (minimal fields needed)."""
    model_config = ConfigDict(extra="allow")

    login: str = Field(..., min_length=1, max_length=39)  # GitHub username limit


class GitHubLabel(BaseModel):
    """GitHub label with name extraction."""
    model_config = ConfigDict(extra="allow")

    name: str = Field(..., max_length=50)
    color: Optional[str] = None
    description: Optional[str] = None


class GitHubIssuePayload(BaseModel):
    """Validated GitHub issue webhook payload.
    
    Required fields: id, html_url, created_at, updated_at, user
    Optional fields: everything else (GitHub API can omit them)
    
    The extra="allow" config accepts additional GitHub fields we don't use,
    ensuring forward compatibility when GitHub adds new fields.
    """
    model_config = ConfigDict(extra="allow")

    id: int = Field(..., gt=0)
    html_url: str = Field(..., max_length=MAX_URL_LENGTH)
    title: Optional[str] = Field(None, max_length=MAX_TITLE_LENGTH)
    body: Optional[str] = Field(None, max_length=MAX_BODY_LENGTH)
    created_at: str
    updated_at: str
    user: GitHubUser
    labels: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_LABELS)
    repository_url: Optional[str] = Field(None, max_length=MAX_URL_LENGTH)
    number: Optional[int] = Field(None, gt=0)
    state: Optional[str] = Field(None, pattern="^(open|closed)$")

    @field_validator("html_url")
    @classmethod
    def validate_github_url(cls, v: str) -> str:
        """Ensure URL is a valid GitHub URL."""
        if not v.startswith(("https://github.com/", "https://github.enterprise.")):
            # Allow enterprise GitHub URLs
            if not ("github" in v.lower()):
                raise ValueError("URL must be a GitHub URL")
        return v

    @field_validator("created_at", "updated_at")
    @classmethod
    def validate_timestamp(cls, v: str) -> str:
        """Validate ISO 8601 timestamp format."""
        if not v:
            raise ValueError("Timestamp cannot be empty")
        # GitHub uses ISO 8601 with Z suffix
        if not (v.endswith("Z") or "+" in v or "-" in v[10:]):
            raise ValueError("Timestamp must be ISO 8601 format")
        return v


class GitHubCommentPayload(BaseModel):
    """Validated GitHub issue comment webhook payload."""
    model_config = ConfigDict(extra="allow")

    id: int = Field(..., gt=0)
    html_url: str = Field(..., max_length=MAX_URL_LENGTH)
    body: Optional[str] = Field(None, max_length=MAX_BODY_LENGTH)
    created_at: str
    updated_at: str
    user: GitHubUser
    issue_url: Optional[str] = Field(None, max_length=MAX_URL_LENGTH)

    @field_validator("html_url")
    @classmethod
    def validate_github_url(cls, v: str) -> str:
        """Ensure URL is a valid GitHub URL."""
        if not v.startswith(("https://github.com/", "https://github.enterprise.")):
            if not ("github" in v.lower()):
                raise ValueError("URL must be a GitHub URL")
        return v

    @field_validator("created_at", "updated_at")
    @classmethod
    def validate_timestamp(cls, v: str) -> str:
        """Validate ISO 8601 timestamp format."""
        if not v:
            raise ValueError("Timestamp cannot be empty")
        if not (v.endswith("Z") or "+" in v or "-" in v[10:]):
            raise ValueError("Timestamp must be ISO 8601 format")
        return v


def categorize_validation_error(exc: Exception) -> IngestionErrorInfo:
    """Convert Pydantic ValidationError to structured IngestionErrorInfo.
    
    This function analyzes the validation error and categorizes it for:
    - Alerting: Different error types need different responses
    - Debugging: Structured details make investigation faster
    - Metrics: Count errors by category for trends
    
    Args:
        exc: The exception (typically pydantic.ValidationError)
        
    Returns:
        IngestionErrorInfo with appropriate error code and details
    """
    from pydantic import ValidationError
    
    if not isinstance(exc, ValidationError):
        return IngestionErrorInfo(
            code=IngestionErrorCode.INTERNAL_UNEXPECTED,
            message=str(exc),
            details={"exception_type": type(exc).__name__},
        )
    
    errors = exc.errors()
    if not errors:
        return IngestionErrorInfo(
            code=IngestionErrorCode.VALIDATION_SCHEMA_MISMATCH,
            message="Unknown validation error",
        )
    
    # Analyze first error (most errors have one primary cause)
    first_error = errors[0]
    error_type = first_error.get("type", "")
    field_path = ".".join(str(loc) for loc in first_error.get("loc", []))
    error_msg = first_error.get("msg", "")
    
    # Categorize by Pydantic error type
    if error_type in ("missing", "value_error.missing"):
        return IngestionErrorInfo(
            code=IngestionErrorCode.VALIDATION_MISSING_REQUIRED_FIELD,
            message=f"Missing required field: {field_path}",
            details={
                "field": field_path,
                "error_count": len(errors),
                "all_errors": [e.get("loc") for e in errors],
            },
        )
    
    if error_type in ("type_error", "int_type", "string_type", "bool_type"):
        return IngestionErrorInfo(
            code=IngestionErrorCode.VALIDATION_INVALID_FIELD_TYPE,
            message=f"Invalid type for field '{field_path}': {error_msg}",
            details={
                "field": field_path,
                "expected_type": error_type,
                "error_count": len(errors),
            },
        )
    
    if "max_length" in error_type or "too_long" in error_type:
        return IngestionErrorInfo(
            code=IngestionErrorCode.VALIDATION_PAYLOAD_TOO_LARGE,
            message=f"Field '{field_path}' exceeds maximum length",
            details={
                "field": field_path,
                "error_count": len(errors),
            },
        )
    
    if error_type in ("value_error", "assertion_error"):
        return IngestionErrorInfo(
            code=IngestionErrorCode.VALIDATION_FIELD_CONSTRAINT,
            message=f"Constraint violation for field '{field_path}': {error_msg}",
            details={
                "field": field_path,
                "constraint": error_msg,
                "error_count": len(errors),
            },
        )
    
    # Default: generic schema mismatch
    return IngestionErrorInfo(
        code=IngestionErrorCode.VALIDATION_SCHEMA_MISMATCH,
        message=f"Schema validation failed: {error_msg}",
        details={
            "field": field_path,
            "error_type": error_type,
            "error_count": len(errors),
            "all_errors": errors[:5],  # Limit to first 5 errors
        },
    )
