"""GitHub connector helpers (rate limit + pagination)."""

from __future__ import annotations

import time
from typing import Dict, Optional

import httpx


def handle_rate_limit(response: httpx.Response) -> None:
    remaining = int(response.headers.get("X-RateLimit-Remaining", "1"))
    reset = int(response.headers.get("X-RateLimit-Reset", "0"))
    if remaining <= 0 and reset:
        sleep_for = max(reset - int(time.time()), 1)
        time.sleep(sleep_for)


def get_next_link(link_header: Optional[str]) -> Optional[str]:
    if not link_header:
        return None
    parts = link_header.split(",")
    for part in parts:
        section = part.split(";")
        if len(section) < 2:
            continue
        url = section[0].strip()[1:-1]
        rel = section[1].strip()
        if rel == 'rel="next"':
            return url
    return None
