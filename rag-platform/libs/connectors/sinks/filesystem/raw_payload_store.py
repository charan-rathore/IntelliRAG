"""Local filesystem raw payload storage (V1)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict
from uuid import UUID, uuid4


class RawPayloadStore:
    def __init__(self, base_dir: str) -> None:
        self._base_dir = base_dir

    def write_json(self, document_id: UUID, payload: Dict[str, Any]) -> tuple[UUID, str]:
        """Persist raw payload to disk and return (payload_id, uri)."""
        payload_id = uuid4()
        ts = datetime.now(timezone.utc).strftime("%Y%m%d")
        dir_path = os.path.join(self._base_dir, ts)
        os.makedirs(dir_path, exist_ok=True)
        file_name = f"{document_id}-{payload_id}.json"
        file_path = os.path.join(dir_path, file_name)
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)
        return payload_id, file_path
