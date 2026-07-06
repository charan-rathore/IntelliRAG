"""Pipeline parameter tracking for reproducible evaluation.

Per SN Computer Science 2026 review: log all parameters that influence
evaluation outcomes (chunking, retrieval, reranking, context, generation, judge).
"""

from __future__ import annotations

import json
import platform
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


@dataclass
class PipelineParameters:
    """Complete parameter snapshot for an evaluation run."""

    run_id: str
    timestamp: str
    dataset_name: str
    dataset_version: str
    num_samples: int

    chunking_strategy: str = "recursive"
    chunk_size: int = 512
    chunk_overlap: int = 50

    embedding_model: str = "nomic-embed-text"
    embedding_dimensions: int = 768

    retrieval_mode: str = "hybrid"
    retrieval_top_k: int = 5
    retrieve_top_n: int = 20

    reranker: str = "lexical"
    rerank_top_k: int = 5

    context_strategy: str = "full"
    context_max_tokens: int = 2048
    context_max_chunks: int = 10

    generation_model: str = "llama3.2"
    generation_prompt_style: str = "citation_aware"
    generation_temperature: float = 0.0

    judge_model: str = "lexical"
    use_ragas: bool = False

    python_version: str = field(default_factory=lambda: sys.version)
    platform_info: str = field(default_factory=lambda: platform.platform())

    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PipelineParameters":
        known = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in known}
        return cls(**filtered)
