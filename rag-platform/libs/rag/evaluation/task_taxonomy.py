"""Task taxonomy for enterprise technical-doc RAG evaluation.

IntelliRAG targets operational knowledge: incident runbooks, how-to guides,
and procedural documentation. Each sample maps to a task type with distinct
quality expectations.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional

from .models import EvaluationSample


class TaskType(str, Enum):
    """Task-specific evaluation categories for the golden benchmark."""

    INCIDENT_RCA = "incident_rca"
    INCIDENT_RESOLUTION = "incident_resolution"
    HOW_TO = "how_to"
    RUNBOOK_PROCEDURE = "runbook_procedure"
    CONCEPTUAL = "conceptual"

    @classmethod
    def from_str(cls, value: str) -> "TaskType":
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        raise ValueError(f"Unknown task type: {value}")


TASK_DESCRIPTIONS: Dict[TaskType, str] = {
    TaskType.INCIDENT_RCA: "Root-cause analysis from incident documentation",
    TaskType.INCIDENT_RESOLUTION: "Remediation steps and fixes for incidents",
    TaskType.HOW_TO: "Procedural how-to questions from technical guides",
    TaskType.RUNBOOK_PROCEDURE: "Operational runbook step retrieval",
    TaskType.CONCEPTUAL: "Conceptual explanations from documentation",
}


def resolve_task_type(sample: EvaluationSample) -> TaskType:
    """Resolve task type from explicit metadata or infer from route/topic."""
    metadata = sample.metadata or {}
    if "task_type" in metadata:
        return TaskType.from_str(str(metadata["task_type"]))

    route = str(metadata.get("route", "")).lower()
    if route == "incident":
        question = sample.question.lower()
        resolution_keywords = ("resolved", "resolution", "fix", "mitigation", "implement")
        if any(kw in question for kw in resolution_keywords):
            return TaskType.INCIDENT_RESOLUTION
        return TaskType.INCIDENT_RCA

    if route in {"async", "how_to", "how-to"}:
        return TaskType.HOW_TO

    doc_type = str(metadata.get("type", "")).lower()
    if doc_type == "runbook":
        return TaskType.RUNBOOK_PROCEDURE

    topic = str(metadata.get("topic", "")).lower()
    if topic in {"scheduling", "resources", "taints"}:
        return TaskType.CONCEPTUAL

    return TaskType.HOW_TO


def task_metadata(task_type: TaskType, **extra: Any) -> Dict[str, Any]:
    """Build metadata dict with normalized task_type field."""
    data = dict(extra)
    data["task_type"] = task_type.value
    return data
