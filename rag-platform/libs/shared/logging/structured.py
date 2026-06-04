"""Structured logging helpers."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "event"):
            payload["event"] = record.event
        if hasattr(record, "fields") and isinstance(record.fields, dict):
            payload.update(record.fields)
        return json.dumps(payload, default=str)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonLogFormatter())
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def log_event(
    logger: logging.Logger,
    event: str,
    message: str,
    fields: Optional[Dict[str, Any]] = None,
) -> None:
    logger.info(message, extra={"event": event, "fields": fields or {}})
