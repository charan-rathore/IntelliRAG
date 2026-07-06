"""Failure feed: promote production failures into the golden dataset.

Closed-loop eval: failing traces from production get added to the test suite,
making the gate stronger over time (FutureAGI CI/CD playbook 2026).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from .models import EvaluationDataset, EvaluationSample

logger = logging.getLogger(__name__)


@dataclass
class FailureRecord:
    """A recorded evaluation failure for promotion to golden set."""

    question: str
    expected_answer: str
    actual_answer: str
    failure_type: str
    failure_metric: str
    failure_score: float
    reference_context: List[str]
    document_id: Optional[str] = None
    metadata: dict = None
    recorded_at: str = ""
    record_id: str = ""

    def __post_init__(self):
        if not self.recorded_at:
            self.recorded_at = datetime.now().isoformat()
        if not self.record_id:
            self.record_id = str(uuid4())
        if self.metadata is None:
            self.metadata = {}

    def to_sample(self) -> EvaluationSample:
        return EvaluationSample(
            question=self.question,
            ground_truth=self.expected_answer,
            reference_context=self.reference_context,
            document_id=self.document_id,
            metadata={
                **self.metadata,
                "source": "failure_feed",
                "failure_type": self.failure_type,
                "failure_metric": self.failure_metric,
                "promoted_at": datetime.now().isoformat(),
            },
        )


class FailureFeed:
    """Manage failure records and promote them to the golden dataset."""

    def __init__(self, feed_path: str | Path) -> None:
        self.feed_path = Path(feed_path)
        self.feed_path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, failure: FailureRecord) -> None:
        """Append a failure record to the feed."""
        records = self._load_records()
        records.append({
            "record_id": failure.record_id,
            "question": failure.question,
            "expected_answer": failure.expected_answer,
            "actual_answer": failure.actual_answer,
            "failure_type": failure.failure_type,
            "failure_metric": failure.failure_metric,
            "failure_score": failure.failure_score,
            "reference_context": failure.reference_context,
            "document_id": failure.document_id,
            "metadata": failure.metadata,
            "recorded_at": failure.recorded_at,
        })
        self._save_records(records)
        logger.info(f"Recorded failure: {failure.failure_type} for '{failure.question[:50]}'")

    def promote_to_dataset(
        self,
        dataset_path: str | Path,
        promote_below_score: float = 0.5,
    ) -> int:
        """Promote failures with scores below threshold to the golden dataset."""
        records = self._load_records()
        if not records:
            return 0

        dataset_path = Path(dataset_path)
        if dataset_path.exists():
            dataset = EvaluationDataset.from_json(dataset_path)
        else:
            dataset = EvaluationDataset(name="golden", samples=[], version="1.0")

        existing_questions = {s.question for s in dataset.samples}
        promoted = 0

        for record in records:
            if record.get("promoted"):
                continue
            if record.get("failure_score", 1.0) >= promote_below_score:
                continue
            if record["question"] in existing_questions:
                record["promoted"] = True
                continue

            sample = FailureRecord(
                question=record["question"],
                expected_answer=record["expected_answer"],
                actual_answer=record.get("actual_answer", ""),
                failure_type=record["failure_type"],
                failure_metric=record["failure_metric"],
                failure_score=record["failure_score"],
                reference_context=record.get("reference_context", []),
                document_id=record.get("document_id"),
                metadata=record.get("metadata", {}),
            ).to_sample()

            dataset.samples.append(sample)
            existing_questions.add(record["question"])
            record["promoted"] = True
            promoted += 1

        if promoted > 0:
            dataset.to_json(dataset_path)
            self._save_records(records)
            logger.info(f"Promoted {promoted} failures to {dataset_path}")

        return promoted

    def _load_records(self) -> List[dict]:
        if not self.feed_path.exists():
            return []
        with open(self.feed_path) as f:
            return json.load(f)

    def _save_records(self, records: List[dict]) -> None:
        with open(self.feed_path, "w") as f:
            json.dump(records, f, indent=2)

    @property
    def pending_count(self) -> int:
        records = self._load_records()
        return sum(1 for r in records if not r.get("promoted"))
