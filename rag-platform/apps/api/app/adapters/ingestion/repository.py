"""Repository abstraction for ingestion lifecycle persistence."""

from typing import Any, Dict


class IngestionRepository:
    def create_request(self, payload: Dict[str, Any]) -> str:
        raise NotImplementedError

    def update_state(self, request_id: str, state: str) -> None:
        raise NotImplementedError
