#!/usr/bin/env python3
"""Evaluate nomic-embed-text embeddings using RAGAS.

This script compares the recommended nomic-embed-text model against
the legacy all-MiniLM-L6-v2 model to validate the embedding choice.

Prerequisites:
    1. Install Ollama: https://ollama.ai
    2. Pull models:
       ollama pull nomic-embed-text
       ollama pull llama3
    3. Install dependencies:
       pip install -e ".[eval]"

Usage:
    # Quick test with sample dataset
    python run_nomic_evaluation.py --sample
    
    # Compare nomic vs minilm
    python run_nomic_evaluation.py --sample --compare-models
    
    # Full evaluation with all strategies
    python run_nomic_evaluation.py --sample --full
    
    # Save results
    python run_nomic_evaluation.py --sample --output results.json

Expected Results (based on analysis):
    nomic-embed-text should outperform all-MiniLM-L6-v2 because:
    - 8,192 token context vs 256 tokens (no truncation)
    - 768 dimensions vs 384 (richer representations)
    - 62.39 MTEB vs 56.30 (better benchmark scores)
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from libs.rag.evaluation.benchmark import ChunkingBenchmark
from libs.rag.evaluation.models import EvaluationDataset
from libs.rag.evaluation.ragas_wrapper import RagasConfig
from libs.rag.evaluation.sample_dataset import (
    create_combined_sample_dataset,
    get_sample_documents,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Evaluate nomic-embed-text embeddings using RAGAS",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    
    parser.add_argument(
        "--sample",
        action="store_true",
        help="Use built-in sample dataset",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        help="Path to evaluation dataset JSON",
    )
    parser.add_argument(
        "--documents",
        type=Path,
        help="Path to source documents directory",
    )
    parser.add_argument(
        "--compare-models",
        action="store_true",
        help="Compare nomic-embed-text vs all-MiniLM-L6-v2",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run full evaluation with all strategies",
    )
    parser.add_argument(
        "--embedding-model",
        default="nomic-embed-text",
        choices=["nomic-embed-text", "all-MiniLM-L6-v2", "mxbai-embed-large"],
        help="Embedding model to use (default: nomic-embed-text)",
    )
    parser.add_argument(
        "--llm-model",
        default="llama3",
        help="LLM model for RAGAS evaluation (default: llama3)",
    )
    parser.add_argument(
        "--ollama-url",
        default="http://localhost:11434",
        help="Ollama server URL",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Save results to JSON file",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output",
    )
    
    return parser.parse_args()


def check_ollama_models(base_url: str, models: list[str]) -> dict[str, bool]:
    """Check if required Ollama models are available."""
    import httpx
    
    try:
        client = httpx.Client(base_url=base_url, timeout=10.0)
        response = client.get("/api/tags")
        
        if response.status_code != 200:
            return {m: False for m in models}
        
        available = response.json().get("models", [])
        available_names = [m.get("name", "").split(":")[0] for m in available]
        
        return {m: m in available_names for m in models}
        
    except Exception as e:
        logger.warning(f"Could not check Ollama models: {e}")
        return {m: False for m in models}


def run_single_model_evaluation(
    dataset: EvaluationDataset,
    documents: dict[str, str],
    embedding_model: str,
    ragas_config: RagasConfig,
    strategies: list[str],
    chunk_sizes: list[int],
    overlaps: list[int],
) -> dict:
    """Run evaluation with a single embedding model."""
    
    use_ollama = embedding_model in ["nomic-embed-text", "mxbai-embed-large"]
    
    benchmark = ChunkingBenchmark(
        dataset=dataset,
        source_documents=documents,
        ragas_config=ragas_config,
        use_embeddings=True,
        embedding_model=embedding_model,
        use_ollama=use_ollama,
    )
    
    logger.info(f"Running evaluation with {embedding_model}...")
    start_time = time.time()
    
    results = benchmark.run_comparison(
        strategies=strategies,
        chunk_sizes=chunk_sizes,
        overlaps=overlaps,
    )
    
    elapsed = time.time() - start_time
    
    return {
        "embedding_model": embedding_model,
        "elapsed_seconds": elapsed,
        "best_strategy": results.best_strategy,
        "best_config": results.best_config,
        "results": [r.to_dict() for r in results.results],
        "summary": results.to_summary_table(),
    }


def compare_embedding_models(
    dataset: EvaluationDataset,
    documents: dict[str, str],
    ragas_config: RagasConfig,
) -> dict:
    """Compare nomic-embed-text vs all-MiniLM-L6-v2."""
    
    models = ["nomic-embed-text", "all-MiniLM-L6-v2"]
    strategies = ["recursive", "structure_aware"]
    chunk_sizes = [256, 512]
    overlaps = [25, 50]
    
    comparisons = {}
    
    for model in models:
        logger.info(f"\n{'='*60}")
        logger.info(f"Testing {model}")
        logger.info(f"{'='*60}\n")
        
        try:
            result = run_single_model_evaluation(
                dataset=dataset,
                documents=documents,
                embedding_model=model,
                ragas_config=ragas_config,
                strategies=strategies,
                chunk_sizes=chunk_sizes,
                overlaps=overlaps,
            )
            comparisons[model] = result
        except Exception as e:
            logger.error(f"Failed to evaluate {model}: {e}")
            comparisons[model] = {"error": str(e)}
    
    return comparisons


def print_comparison_summary(comparisons: dict) -> None:
    """Print a summary comparison of models."""
    print("\n" + "=" * 80)
    print("EMBEDDING MODEL COMPARISON")
    print("=" * 80 + "\n")
    
    for model, data in comparisons.items():
        if "error" in data:
            print(f"{model}: ERROR - {data['error']}")
            continue
        
        print(f"\n{model}:")
        print(f"  Best Strategy: {data['best_strategy']}")
        print(f"  Best Config: chunk_size={data['best_config']['chunk_size']}, "
              f"overlap={data['best_config']['chunk_overlap']}")
        print(f"  Evaluation Time: {data['elapsed_seconds']:.1f}s")
        
        # Find best F1 score
        results = data.get("results", [])
        if results:
            best_f1 = max(r.get("combined_score", 0) for r in results)
            best_precision = max(r.get("context_precision", 0) for r in results)
            best_recall = max(r.get("context_recall", 0) for r in results)
            print(f"  Best F1 Score: {best_f1:.4f}")
            print(f"  Best Precision: {best_precision:.4f}")
            print(f"  Best Recall: {best_recall:.4f}")
    
    # Determine winner
    print("\n" + "-" * 80)
    
    valid_models = {k: v for k, v in comparisons.items() if "error" not in v}
    if len(valid_models) >= 2:
        best_model = max(
            valid_models.items(),
            key=lambda x: max(r.get("combined_score", 0) for r in x[1].get("results", [{"combined_score": 0}]))
        )
        print(f"\nRECOMMENDED: {best_model[0]}")
        
        nomic_results = comparisons.get("nomic-embed-text", {}).get("results", [])
        minilm_results = comparisons.get("all-MiniLM-L6-v2", {}).get("results", [])
        
        if nomic_results and minilm_results:
            nomic_best = max(r.get("combined_score", 0) for r in nomic_results)
            minilm_best = max(r.get("combined_score", 0) for r in minilm_results)
            improvement = ((nomic_best - minilm_best) / max(minilm_best, 0.0001)) * 100
            print(f"  nomic-embed-text F1: {nomic_best:.4f}")
            print(f"  all-MiniLM-L6-v2 F1: {minilm_best:.4f}")
            print(f"  Improvement: {improvement:+.1f}%")


def main():
    """Main entry point."""
    args = parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Load dataset
    if args.sample:
        logger.info("Using sample evaluation dataset")
        dataset = create_combined_sample_dataset()
        documents = get_sample_documents()
    elif args.dataset:
        logger.info(f"Loading dataset from {args.dataset}")
        dataset = EvaluationDataset.from_json(args.dataset)
        documents = None
        if args.documents:
            documents = {}
            for ext in ["*.md", "*.txt"]:
                for path in args.documents.glob(f"**/{ext}"):
                    doc_id = str(path.relative_to(args.documents))
                    with open(path) as f:
                        documents[doc_id] = f.read()
    else:
        logger.error("Must specify --sample or --dataset")
        sys.exit(1)
    
    logger.info(f"Dataset: {dataset.name} ({len(dataset)} samples)")
    
    # Check Ollama models
    required_models = [args.llm_model, "nomic-embed-text"]
    if args.compare_models:
        required_models.append("nomic-embed-text")
    
    model_status = check_ollama_models(args.ollama_url, required_models)
    missing = [m for m, available in model_status.items() if not available]
    
    if missing:
        logger.warning(f"Missing Ollama models: {missing}")
        logger.warning("Install with: " + " && ".join(f"ollama pull {m}" for m in missing))
    
    # Create RAGAS config
    ragas_config = RagasConfig.for_ollama(
        model=args.llm_model,
        embedding_model="nomic-embed-text",
        base_url=args.ollama_url,
    )
    
    # Run evaluation
    if args.compare_models:
        comparisons = compare_embedding_models(
            dataset=dataset,
            documents=documents,
            ragas_config=ragas_config,
        )
        print_comparison_summary(comparisons)
        results = {"comparison": comparisons}
        
    else:
        # Single model evaluation
        strategies = ["recursive", "structure_aware", "hybrid"] if args.full else ["recursive", "structure_aware"]
        chunk_sizes = [256, 512, 1024] if args.full else [512]
        overlaps = [25, 50, 100] if args.full else [50]
        
        result = run_single_model_evaluation(
            dataset=dataset,
            documents=documents,
            embedding_model=args.embedding_model,
            ragas_config=ragas_config,
            strategies=strategies,
            chunk_sizes=chunk_sizes,
            overlaps=overlaps,
        )
        
        print("\n" + "=" * 80)
        print("EVALUATION RESULTS")
        print("=" * 80 + "\n")
        print(result["summary"])
        print(f"\nBest Configuration:")
        print(f"  Strategy: {result['best_strategy']}")
        print(f"  Config: {result['best_config']}")
        print(f"  Time: {result['elapsed_seconds']:.1f}s")
        
        results = result
    
    # Save results
    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2, default=str)
        logger.info(f"Results saved to {args.output}")
    
    return results


if __name__ == "__main__":
    main()
