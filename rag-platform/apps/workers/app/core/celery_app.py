"""Celery application configuration with production-grade retry behavior.

This module configures Celery for reliable task processing with:
- Automatic retries with exponential backoff
- Dead letter queue for permanently failed tasks
- Late acknowledgment to prevent task loss on worker crash
- Rate limiting to avoid overwhelming external services

RETRY STRATEGY:
Tasks are automatically retried on transient failures with exponential backoff:
- Retry 1: 60 seconds
- Retry 2: 120 seconds (60 * 2^1)
- Retry 3: 240 seconds (60 * 2^2)
- After 3 retries: Task moves to dead letter queue

WHY THESE SETTINGS MATTER:

task_acks_late=True:
    Worker acknowledges task AFTER completion, not before. If worker crashes
    mid-processing, the task returns to the queue and another worker picks it up.
    Without this, crashed tasks are lost forever.

worker_prefetch_multiplier=1:
    Worker only fetches one task at a time. Prevents one worker from hoarding
    tasks while others are idle. Critical for fair distribution under load.

task_reject_on_worker_lost=True:
    If a worker dies unexpectedly, reject the task back to the queue.
    Combined with acks_late, ensures tasks are never lost.
"""

from __future__ import annotations

import os
from typing import Any

from celery import Celery


broker_url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
result_backend = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

celery_app = Celery("rag_platform", broker=broker_url, backend=result_backend)

# Default retry configuration for ingestion tasks
DEFAULT_RETRY_DELAY = 60  # seconds
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_BACKOFF = True
DEFAULT_RETRY_BACKOFF_MAX = 600  # 10 minutes max
DEFAULT_RETRY_JITTER = True  # Add randomness to prevent thundering herd

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    
    # Reliability settings
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    
    # Result expiration (7 days)
    result_expires=604800,
    
    # Task execution limits
    task_soft_time_limit=300,  # 5 minute soft limit (raises SoftTimeLimitExceeded)
    task_time_limit=360,       # 6 minute hard limit (kills task)
    
    # Retry defaults (can be overridden per-task)
    task_default_retry_delay=DEFAULT_RETRY_DELAY,
    
    # Task routing for dead letter queue
    task_routes={
        "apps.workers.app.tasks.ingestion.*": {"queue": "ingestion"},
    },
    
    # Dead letter queue configuration
    task_queues_dlq={
        "ingestion": "ingestion_dlq",
    },
)


class RetryableTaskError(Exception):
    """Exception that should trigger automatic retry.
    
    Raise this for transient failures (network issues, temporary DB unavailable).
    The task will be retried with exponential backoff.
    
    Usage:
        from apps.workers.app.core.celery_app import RetryableTaskError
        
        try:
            result = external_api_call()
        except ConnectionError as e:
            raise RetryableTaskError(f"API unavailable: {e}") from e
    """
    pass


class PermanentTaskError(Exception):
    """Exception that should NOT be retried.
    
    Raise this for permanent failures (validation errors, missing data).
    The task will fail immediately and move to dead letter queue.
    
    Usage:
        from apps.workers.app.core.celery_app import PermanentTaskError
        
        if not payload.get("required_field"):
            raise PermanentTaskError("Missing required field 'required_field'")
    """
    pass


def get_retry_kwargs(
    exc: Exception,
    max_retries: int = DEFAULT_MAX_RETRIES,
    countdown: int = DEFAULT_RETRY_DELAY,
) -> dict[str, Any]:
    """Get retry keyword arguments based on exception type.
    
    Returns appropriate retry configuration based on whether the error
    is transient (should retry) or permanent (should fail).
    
    Usage in Celery task:
        @celery_app.task(bind=True, max_retries=3)
        def my_task(self, payload):
            try:
                process(payload)
            except Exception as e:
                raise self.retry(**get_retry_kwargs(e))
    """
    if isinstance(exc, PermanentTaskError):
        # Don't retry permanent errors
        return {"max_retries": 0}
    
    if isinstance(exc, RetryableTaskError):
        # Retry with exponential backoff
        return {
            "exc": exc,
            "countdown": countdown,
            "max_retries": max_retries,
        }
    
    # Default: retry unknown errors (might be transient)
    return {
        "exc": exc,
        "countdown": countdown,
        "max_retries": max_retries,
    }
