"""Unified RAG evaluation platform.

Phase 10: End-to-end evaluation across all pipeline layers with
CI quality gates, baseline tracking, adversarial probes, and failure feed.

Usage:
    from libs.rag.evaluation import EvaluationPlatform, QualityGateConfig

    platform = EvaluationPlatform(dataset, pipeline, baseline_dir="data/eval/baselines")
    report = platform.run()
    print(report.to_summary())
"""

from .models import (
    EvaluationSample,
    EvaluationDataset,
    ChunkingEvalResult,
    StrategyComparison,
)
from .ragas_wrapper import (
    RagasConfig,
    RagasEvaluator,
    LLMProvider,
    OllamaConfig,
    OpenAIConfig,
    HuggingFaceConfig,
    create_evaluator,
    create_ollama_evaluator,
    create_openai_evaluator,
)
from .benchmark import ChunkingBenchmark
from .faithfulness import FaithfulnessEvaluator, FaithfulnessResult
from .generation_benchmark import GenerationBenchmark, GenerationBenchmarkResult
from .platform import EvaluationPlatform, PipelineHandles
from .quality_gate import QualityGate, QualityGateResult, GateVerdict
from .thresholds import QualityGateConfig, MetricThreshold, ThresholdLevel
from .baseline import BaselineStore, BaselineMetrics, DeltaResult
from .adversarial import AdversarialProbe, AdversarialReport
from .failure_feed import FailureFeed, FailureRecord
from .report import EvalReport
from .parameters import PipelineParameters
from .metrics import DistributionStats, LayerMetrics, compute_distribution

__all__ = [
    # Models
    "EvaluationSample",
    "EvaluationDataset",
    "ChunkingEvalResult",
    "StrategyComparison",
    # RAGAS wrapper
    "RagasConfig",
    "RagasEvaluator",
    "LLMProvider",
    "OllamaConfig",
    "OpenAIConfig",
    "HuggingFaceConfig",
    "create_evaluator",
    "create_ollama_evaluator",
    "create_openai_evaluator",
    # Layer benchmarks
    "ChunkingBenchmark",
    "GenerationBenchmark",
    "GenerationBenchmarkResult",
    "FaithfulnessEvaluator",
    "FaithfulnessResult",
    # Phase 10 platform
    "EvaluationPlatform",
    "PipelineHandles",
    "QualityGate",
    "QualityGateResult",
    "GateVerdict",
    "QualityGateConfig",
    "MetricThreshold",
    "ThresholdLevel",
    "BaselineStore",
    "BaselineMetrics",
    "DeltaResult",
    "AdversarialProbe",
    "AdversarialReport",
    "FailureFeed",
    "FailureRecord",
    "EvalReport",
    "PipelineParameters",
    "DistributionStats",
    "LayerMetrics",
    "compute_distribution",
]
