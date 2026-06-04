"""Celery client adapter for API layer."""

from __future__ import annotations

from apps.workers.app.core.celery_app import celery_app


def enqueue_task(task_name: str, payload: dict) -> None:
	celery_app.send_task(task_name, args=[payload])
