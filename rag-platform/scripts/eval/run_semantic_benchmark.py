#!/usr/bin/env python3
"""Benchmark script to compare semantic chunking against recursive chunking.

This script runs a comprehensive comparison between the new semantic chunker
and the baseline recursive chunker using RAGAS evaluation metrics.

Usage:
    # Run with Ollama (recommended - no API key needed)
    python scripts/eval/run_semantic_benchmark.py --provider ollama
    
    # Run with embedding-based retrieval (more accurate)
    python scripts/eval/run_semantic_benchmark.py --provider ollama --use-embeddings
    
    # Quick test mode
    python scripts/eval/run_semantic_benchmark.py --provider ollama --quick

Prerequisites:
    1. Install dependencies: pip install -e ".[eval]"
    2. Install Ollama: https://ollama.ai
    3. Pull models: ollama pull llama3 && ollama pull nomic-embed-text
"""

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from libs.rag.evaluation.benchmark import ChunkingBenchmark
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
        description="Compare semantic chunking vs recursive chunking"
    )
    
    parser.add_argument(
        "--provider",
        choices=["ollama", "openai"],
        default="ollama",
        help="LLM provider for RAGAS evaluation (default: ollama)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Model name (default: llama3 for ollama)",
    )
    parser.add_argument(
        "--use-embeddings",
        action="store_true",
        help="Use embedding-based retrieval instead of lexical",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Run quick test with fewer configurations",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Save results to JSON file",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose output",
    )
    
    return parser.parse_args()


def create_ragas_config(args) -> RagasConfig:
    """Create RAGAS config based on CLI arguments."""
    if args.provider == "ollama":
        model = args.model or "llama3"
        return RagasConfig.for_ollama(
            model=model,
            embedding_model="nomic-embed-text",
        )
    else:
        model = args.model or "gpt-4o-mini"
        return RagasConfig.for_openai(model=model)


def run_benchmark(args):
    """Run the semantic vs recursive benchmark."""
    logger.info("=" * 60)
    logger.info("SEMANTIC CHUNKING BENCHMARK")
    logger.info("=" * 60)
    
    dataset = create_combined_sample_dataset()
    documents = get_sample_documents()
    
    logger.info(f"Dataset: {dataset.name} ({len(dataset)} samples)")
    logger.info(f"Documents: {len(documents)}")
    logger.info(f"LLM Provider: {args.provider}")
    logger.info(f"Use Embeddings: {args.use_embeddings}")
    
    ragas_config = create_ragas_config(args)
    
    benchmark = ChunkingBenchmark(
        dataset=dataset,
        source_documents=documents,
        ragas_config=ragas_config,
        use_embeddings=args.use_embeddings,
    )
    
    strategies = ["recursive", "semantic"]
    
    if args.quick:
        chunk_sizes = [512]
        overlaps = [25]
    else:
        chunk_sizes = [256, 512, 1024]
        overlaps = [25, 50]
    
    logger.info(f"Strategies: {strategies}")
    logger.info(f"Chunk sizes: {chunk_sizes}")
    logger.info(f"Overlaps: {overlaps}")
    logger.info("")
    
    results = benchmark.run_comparison(
        strategies=strategies,
        chunk_sizes=chunk_sizes,
        overlaps=overlaps,
        top_k=5,
    )
    
    print("\n" + "=" * 80)
    print("BENCHMARK RESULTS: SEMANTIC vs RECURSIVE CHUNKING")
    print("=" * 80 + "\n")
    print(results.to_summary_table())
    
    recursive_results = [r for r in results.results if r.strategy_name == "recursive"]
    semantic_results = [r for r in results.results if r.strategy_name == "semantic"]
    
    if recursive_results and semantic_results:
        best_recursive = max(recursive_results, key=lambda r: r.combined_score)
        best_semantic = max(semantic_results, key=lambda r: r.combined_score)
        
        print("\n" + "-" * 60)
        print("ANALYSIS: SEMANTIC vs RECURSIVE")
        print("-" * 60)
        
        print(f"\nBest Recursive Configuration:")
        print(f"  Chunk size: {best_recursive.chunk_size}")
        print(f"  Overlap: {best_recursive.chunk_overlap}")
        print(f"  Precision: {best_recursive.context_precision:.4f}")
        print(f"  Recall: {best_recursive.context_recall:.4f}")
        print(f"  F1 Score: {best_recursive.combined_score:.4f}")
        
        print(f"\nBest Semantic Configuration:")
        print(f"  Chunk size: {best_semantic.chunk_size}")
        print(f"  Overlap: {best_semantic.chunk_overlap}")
        print(f"  Precision: {best_semantic.context_precision:.4f}")
        print(f"  Recall: {best_semantic.context_recall:.4f}")
        print(f"  F1 Score: {best_semantic.combined_score:.4f}")
        
        improvement = (
            (best_semantic.combined_score - best_recursive.combined_score) 
            / best_recursive.combined_score * 100
        ) if best_recursive.combined_score > 0 else 0
        
        print(f"\nPerformance Comparison:")
        print(f"  F1 Score Improvement: {improvement:+.2f}%")
        
        precision_improvement = (
            (best_semantic.context_precision - best_recursive.context_precision)
            / best_recursive.context_precision * 100
        ) if best_recursive.context_precision > 0 else 0
        print(f"  Precision Improvement: {precision_improvement:+.2f}%")
        
        recall_improvement = (
            (best_semantic.context_recall - best_recursive.context_recall)
            / best_recursive.context_recall * 100
        ) if best_recursive.context_recall > 0 else 0
        print(f"  Recall Improvement: {recall_improvement:+.2f}%")
        
        if improvement > 0:
            print(f"\n✅ Semantic chunking shows {improvement:.1f}% improvement!")
        elif improvement < 0:
            print(f"\n📊 Recursive chunking performs better by {-improvement:.1f}%")
        else:
            print(f"\n📊 Both strategies perform equally well")
    
    if args.output:
        output_data = {
            "timestamp": datetime.now().isoformat(),
            "config": {
                "provider": args.provider,
                "use_embeddings": args.use_embeddings,
                "chunk_sizes": chunk_sizes,
                "overlaps": overlaps,
            },
            "results": [
                {
                    "strategy": r.strategy_name,
                    "chunk_size": r.chunk_size,
                    "chunk_overlap": r.chunk_overlap,
                    "context_precision": r.context_precision,
                    "context_recall": r.context_recall,
                    "f1_score": r.combined_score,
                    "total_chunks": r.total_chunks,
                    "avg_chunk_tokens": r.avg_chunk_tokens,
                }
                for r in results.results
            ],
        }
        
        with open(args.output, "w") as f:
            json.dump(output_data, f, indent=2)
        
        logger.info(f"Results saved to {args.output}")
    
    return results


def main():
    """Main entry point."""
    args = parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    try:
        results = run_benchmark(args)
        return 0
    except KeyboardInterrupt:
        logger.info("\nBenchmark interrupted")
        return 1


if __name__ == "__main__":
    sys.exit(main())
