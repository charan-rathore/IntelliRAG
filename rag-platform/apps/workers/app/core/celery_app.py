"""Celery application configuration (V1)."""

from __future__ import annotations

import os

from celery import Celery


broker_url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
result_backend = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

celery_app = Celery("rag_platform", broker=broker_url, backend=result_backend)

celery_app.conf.update(
	task_serializer="json",
	accept_content=["json"],
	result_serializer="json",
	task_acks_late=True,
	worker_prefetch_multiplier=1,
)
