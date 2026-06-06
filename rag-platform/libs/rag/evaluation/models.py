"""Evaluation data models for chunking benchmarks.

These models define the schema for evaluation datasets and results,
enabling systematic comparison of chunking strategies.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4


@dataclass
class EvaluationSample:
    """A single evaluation sample for testing retrieval quality.
    
    Each sample represents a question that could be asked against
    the chunked documents, along with the ground truth information
    needed to score retrieval.
    
    Attributes:
        question: The query to test retrieval against.
        ground_truth: The expected/ideal answer.
        reference_context: Text segments that contain the answer.
        document_id: Optional ID linking to source document.
        metadata: Additional context for filtering or analysis.
    """
    question: str
    ground_truth: str
    reference_context: List[str]
    document_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    sample_id: str = field(default_factory=lambda: str(uuid4()))
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "sample_id": self.sample_id,
            "question": self.question,
            "ground_truth": self.ground_truth,
            "reference_context": self.reference_context,
            "document_id": self.document_id,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvaluationSample":
        """Create from dictionary."""
        return cls(
            sample_id=data.get("sample_id", str(uuid4())),
            question=data["question"],
            ground_truth=data["ground_truth"],
            reference_context=data["reference_context"],
            document_id=data.get("document_id"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class EvaluationDataset:
    """Collection of evaluation samples for benchmarking.
    
    The dataset contains questions, expected answers, and reference
    contexts that allow measuring how well different chunking strategies
    preserve retrievable information.
    """
    name: str
    samples: List[EvaluationSample]
    description: str = ""
    created_at: datetime = field(default_factory=datetime.now)
    version: str = "1.0"
    source_documents: List[str] = field(default_factory=list)
    
    def __len__(self) -> int:
        return len(self.samples)
    
    def __iter__(self):
        return iter(self.samples)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "created_at": self.created_at.isoformat(),
            "source_documents": self.source_documents,
            "samples": [s.to_dict() for s in self.samples],
        }
    
    def to_json(self, path: str | Path) -> None:
        """Save dataset to JSON file."""
        path = Path(path)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvaluationDataset":
        """Create from dictionary."""
        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        
        return cls(
            name=data["name"],
            description=data.get("description", ""),
            version=data.get("version", "1.0"),
            created_at=created_at or datetime.now(),
            source_documents=data.get("source_documents", []),
            samples=[EvaluationSample.from_dict(s) for s in data["samples"]],
        )
    
    @classmethod
    def from_json(cls, path: str | Path) -> "EvaluationDataset":
        """Load dataset from JSON file."""
        path = Path(path)
        with open(path) as f:
            data = json.load(f)
        return cls.from_dict(data)
    
    def to_ragas_format(
        self,
        retrieved_contexts: Dict[str, List[str]],
        generated_answers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, List]:
        """Convert to RAGAS evaluation format.
        
        Args:
            retrieved_contexts: Map of sample_id -> retrieved chunk texts.
            generated_answers: Optional map of sample_id -> LLM answers.
        
        Returns:
            Dictionary with keys matching RAGAS expected format.
        """
        questions = []
        contexts = []
        ground_truths = []
        answers = []
        
        for sample in self.samples:
            questions.append(sample.question)
            contexts.append(retrieved_contexts.get(sample.sample_id, []))
            ground_truths.append(sample.ground_truth)
            
            if generated_answers:
                answers.append(generated_answers.get(sample.sample_id, ""))
            else:
                answers.append(sample.ground_truth)
        
        return {
            "question": questions,
            "contexts": contexts,
            "ground_truth": ground_truths,
            "answer": answers,
        }


@dataclass
class ChunkingEvalResult:
    """Results from evaluating a single chunking configuration.
    
    Stores both RAGAS metrics and chunking statistics for analysis.
    """
    strategy_name: str
    chunk_size: int
    chunk_overlap: int
    
    # RAGAS retrieval metrics
    context_precision: float
    context_recall: float
    
    # Optional RAGAS generation metrics (if LLM answers provided)
    faithfulness: Optional[float] = None
    answer_relevancy: Optional[float] = None
    
    # Chunking statistics
    total_chunks: int = 0
    avg_chunk_tokens: float = 0.0
    min_chunk_tokens: int = 0
    max_chunk_tokens: int = 0
    
    # Timing
    chunking_time_ms: float = 0.0
    evaluation_time_ms: float = 0.0
    
    # Raw per-sample scores for detailed analysis
    per_sample_scores: Dict[str, Dict[str, float]] = field(default_factory=dict)
    
    timestamp: datetime = field(default_factory=datetime.now)
    
    @property
    def combined_score(self) -> float:
        """Compute combined retrieval score (F1 of precision and recall)."""
        if self.context_precision + self.context_recall == 0:
            return 0.0
        return 2 * (self.context_precision * self.context_recall) / (
            self.context_precision + self.context_recall
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "strategy_name": self.strategy_name,
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "context_precision": self.context_precision,
            "context_recall": self.context_recall,
            "faithfulness": self.faithfulness,
            "answer_relevancy": self.answer_relevancy,
            "combined_score": self.combined_score,
            "total_chunks": self.total_chunks,
            "avg_chunk_tokens": self.avg_chunk_tokens,
            "min_chunk_tokens": self.min_chunk_tokens,
            "max_chunk_tokens": self.max_chunk_tokens,
            "chunking_time_ms": self.chunking_time_ms,
            "evaluation_time_ms": self.evaluation_time_ms,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class StrategyComparison:
    """Comparison results across multiple chunking strategies.
    
    Aggregates results to determine which strategy performs best
    on the evaluation dataset.
    """
    dataset_name: str
    results: List[ChunkingEvalResult]
    best_strategy: Optional[str] = None
    best_config: Optional[Dict[str, Any]] = None
    timestamp: datetime = field(default_factory=datetime.now)
    
    def __post_init__(self):
        """Determine best strategy after initialization."""
        if self.results and not self.best_strategy:
            best = max(self.results, key=lambda r: r.combined_score)
            self.best_strategy = best.strategy_name
            self.best_config = {
                "strategy": best.strategy_name,
                "chunk_size": best.chunk_size,
                "chunk_overlap": best.chunk_overlap,
            }
    
    def get_results_by_strategy(self) -> Dict[str, List[ChunkingEvalResult]]:
        """Group results by strategy name."""
        grouped: Dict[str, List[ChunkingEvalResult]] = {}
        for result in self.results:
            if result.strategy_name not in grouped:
                grouped[result.strategy_name] = []
            grouped[result.strategy_name].append(result)
        return grouped
    
    def to_summary_table(self) -> str:
        """Generate a summary table of results."""
        lines = [
            f"{'Strategy':<20} {'Chunk Size':<12} {'Overlap':<10} "
            f"{'Precision':<12} {'Recall':<12} {'F1 Score':<12}",
            "-" * 80,
        ]
        
        sorted_results = sorted(self.results, key=lambda r: r.combined_score, reverse=True)
        
        for r in sorted_results:
            marker = " *" if r.strategy_name == self.best_strategy else ""
            lines.append(
                f"{r.strategy_name:<20} {r.chunk_size:<12} {r.chunk_overlap:<10} "
                f"{r.context_precision:<12.4f} {r.context_recall:<12.4f} "
                f"{r.combined_score:<12.4f}{marker}"
            )
        
        lines.append("-" * 80)
        lines.append(f"* Best performing configuration")
        
        return "\n".join(lines)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "dataset_name": self.dataset_name,
            "timestamp": self.timestamp.isoformat(),
            "best_strategy": self.best_strategy,
            "best_config": self.best_config,
            "results": [r.to_dict() for r in self.results],
        }
    
    def to_json(self, path: str | Path) -> None:
        """Save comparison results to JSON file."""
        path = Path(path)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)
