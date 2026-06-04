"""GitHub fetcher: responsible for API calls, pagination, and rate limiting."""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

import httpx

from libs.connectors.sources.github.utils import get_next_link, handle_rate_limit


class GitHubFetcher:
    def __init__(self, base_url: str, token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token

    def fetch_issues(self, params: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
        """Yield raw issue payloads across pages."""
        owner = params["owner"]
        repo = params["repo"]
        url = f"{self._base_url}/repos/{owner}/{repo}/issues"
        yield from self._paginate(url, params)

    def fetch_issue_comments(self, issue_number: int, params: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
        """Yield raw comment payloads for an issue."""
        owner = params["owner"]
        repo = params["repo"]
        url = f"{self._base_url}/repos/{owner}/{repo}/issues/{issue_number}/comments"
        yield from self._paginate(url, params)

    def _paginate(self, url: str, params: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
        headers = {"Authorization": f"Bearer {self._token}"}
        with httpx.Client(timeout=30.0, headers=headers) as client:
            next_url: Optional[str] = url
            while next_url:
                response = client.get(next_url, params=params)
                response.raise_for_status()
                handle_rate_limit(response)
                payload = response.json()
                for item in payload:
                    if "pull_request" in item:
                        continue
                    yield item
                next_url = get_next_link(response.headers.get("Link"))
