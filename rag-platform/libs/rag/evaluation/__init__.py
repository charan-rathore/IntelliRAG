"""RAG Evaluation module using RAGAS.

This module provides tools to objectively measure and compare chunking
strategies instead of relying on intuition. It integrates with RAGAS
to compute retrieval quality metrics like context precision and recall.

Supports multiple LLM providers:
- Ollama (local, no API key needed) - RECOMMENDED
- OpenAI
- HuggingFace

Usage with Ollama (no API key needed):
    from libs.rag.evaluation import (
        ChunkingBenchmark,
        EvaluationDataset,
        RagasConfig,
        create_ollama_evaluator,
    )
    
    # Load or create evaluation dataset
    dataset = EvaluationDataset.from_json("eval_data.json")
    
    # Run benchmark with Ollama (local)
    config = RagasConfig.for_ollama(model="llama3")
    benchmark = ChunkingBenchmark(dataset, ragas_config=config)
    results = benchmark.run_comparison(["recursive", "structure_aware"])
    
    print(results.to_summary_table())
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
    # Benchmark
    "ChunkingBenchmark",
]
