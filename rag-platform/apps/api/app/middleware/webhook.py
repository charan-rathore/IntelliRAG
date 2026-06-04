"""Webhook signature verification middleware helpers."""

from __future__ import annotations

import hmac
import os
from hashlib import sha256
from typing import Optional

from fastapi import HTTPException, Request


DEFAULT_SIGNATURE_HEADER = "X-Hub-Signature-256"


def _get_secret() -> Optional[str]:
    secret = os.getenv("INGESTION_WEBHOOK_SECRET", "")
    return secret or None


def _get_header_name() -> str:
    return os.getenv("INGESTION_WEBHOOK_SIGNATURE_HEADER", DEFAULT_SIGNATURE_HEADER)


async def verify_webhook_signature(request: Request) -> None:
    secret = _get_secret()
    if not secret:
        return
    header_name = _get_header_name()
    signature = request.headers.get(header_name)
    if not signature:
        raise HTTPException(status_code=401, detail="Missing webhook signature header.")

    body = await request.body()
    digest = hmac.new(secret.encode("utf-8"), body, sha256).hexdigest()
    expected = f"sha256={digest}"
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")
