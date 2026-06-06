#!/usr/bin/env python3
"""CLI script to run chunking strategy benchmarks.

This script provides a command-line interface to evaluate and compare
different chunking strategies using RAGAS metrics.

Usage:
    # Run benchmark with Ollama (local, no API key needed)
    python run_chunking_benchmark.py --sample --provider ollama
    
    # Run benchmark with specific Ollama model
    python run_chunking_benchmark.py --sample --provider ollama --model mistral
    
    # Run benchmark with OpenAI
    python run_chunking_benchmark.py --sample --provider openai
    
    # Run benchmark with custom dataset
    python run_chunking_benchmark.py --dataset eval_data.json --documents docs/
    
    # Compare specific strategies
    python run_chunking_benchmark.py --sample --strategies recursive structure_aware
    
    # Sweep chunk sizes
    python run_chunking_benchmark.py --sample --chunk-sizes 256 512 1024 2048
    
    # Save results to file
    python run_chunking_benchmark.py --sample --output results.json

Requirements for Ollama (recommended, no API key needed):
    1. Install Ollama: https://ollama.ai
    2. Pull models: ollama pull llama3 && ollama pull nomic-embed-text
    3. pip install ragas datasets langchain-ollama

Requirements for OpenAI:
    pip install ragas datasets langchain-openai
    Set OPENAI_API_KEY environment variable
"""

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from libs.rag.evaluation.benchmark import ChunkingBenchmark, quick_benchmark
from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
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
        description="Benchmark chunking strategies using RAGAS metrics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    %(prog)s --sample
    %(prog)s --sample --strategies recursive structure_aware
    %(prog)s --dataset my_eval.json --documents ./docs
    %(prog)s --sample --chunk-sizes 256 512 1024 --output results.json
        """,
    )
    
    data_group = parser.add_argument_group("Data sources")
    data_group.add_argument(
        "--sample",
        action="store_true",
        help="Use built-in sample dataset for demonstration",
    )
    data_group.add_argument(
        "--dataset",
        type=Path,
        help="Path to evaluation dataset JSON file",
    )
    data_group.add_argument(
        "--documents",
        type=Path,
        help="Path to directory containing source documents",
    )
    
    llm_group = parser.add_argument_group("LLM provider configuration")
    llm_group.add_argument(
        "--provider",
        choices=["ollama", "openai", "huggingface"],
        default="ollama",
        help="LLM provider for RAGAS evaluation (default: ollama)",
    )
    llm_group.add_argument(
        "--model",
        type=str,
        default=None,
        help="Model name (default: llama3 for ollama, gpt-4o-mini for openai)",
    )
    llm_group.add_argument(
        "--embedding-model",
        type=str,
        default=None,
        help="Embedding model (default: nomic-embed-text for ollama)",
    )
    llm_group.add_argument(
        "--ollama-url",
        type=str,
        default="http://localhost:11434",
        help="Ollama server URL (default: http://localhost:11434)",
    )
    
    config_group = parser.add_argument_group("Benchmark configuration")
    config_group.add_argument(
        "--strategies",
        nargs="+",
        default=["recursive", "structure_aware"],
        help="Chunking strategies to compare (default: recursive structure_aware)",
    )
    config_group.add_argument(
        "--chunk-sizes",
        nargs="+",
        type=int,
        default=[256, 512, 1024],
        help="Chunk sizes to test (default: 256 512 1024)",
    )
    config_group.add_argument(
        "--overlaps",
        nargs="+",
        type=int,
        default=[25, 50],
        help="Overlap sizes to test (default: 25 50)",
    )
    config_group.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Number of chunks to retrieve per query (default: 5)",
    )
    config_group.add_argument(
        "--use-embeddings",
        action="store_true",
        help="Use embedding-based retrieval (requires sentence-transformers)",
    )
    
    output_group = parser.add_argument_group("Output")
    output_group.add_argument(
        "--output",
        type=Path,
        help="Save results to JSON file",
    )
    output_group.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose output",
    )
    
    return parser.parse_args()


def _create_ragas_config(args) -> RagasConfig:
    """Create RAGAS config based on CLI arguments."""
    provider = args.provider.lower()
    
    if provider == "ollama":
        model = args.model or "llama3"
        embedding_model = args.embedding_model or "nomic-embed-text"
        return RagasConfig.for_ollama(
            model=model,
            embedding_model=embedding_model,
            base_url=args.ollama_url,
        )
    elif provider == "openai":
        model = args.model or "gpt-4o-mini"
        return RagasConfig.for_openai(model=model)
    elif provider == "huggingface":
        model = args.model or "mistralai/Mistral-7B-Instruct-v0.2"
        embedding_model = args.embedding_model or "BAAI/bge-small-en-v1.5"
        return RagasConfig.for_huggingface(
            model=model,
            embedding_model=embedding_model,
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")


def load_documents_from_directory(doc_dir: Path) -> dict[str, str]:
    """Load text documents from a directory."""
    documents = {}
    
    for ext in ["*.md", "*.txt", "*.rst"]:
        for path in doc_dir.glob(f"**/{ext}"):
            doc_id = str(path.relative_to(doc_dir))
            with open(path) as f:
                documents[doc_id] = f.read()
    
    logger.info(f"Loaded {len(documents)} documents from {doc_dir}")
    return documents


def main():
    """Main entry point."""
    args = parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    if args.sample:
        logger.info("Using sample evaluation dataset")
        dataset = create_combined_sample_dataset()
        documents = get_sample_documents()
    elif args.dataset:
        logger.info(f"Loading dataset from {args.dataset}")
        dataset = EvaluationDataset.from_json(args.dataset)
        
        if args.documents:
            documents = load_documents_from_directory(args.documents)
        else:
            documents = None
            logger.warning(
                "No documents directory specified. "
                "Using reference_context from evaluation samples."
            )
    else:
        logger.error("Must specify --sample or --dataset")
        sys.exit(1)
    
    logger.info(f"Dataset: {dataset.name} ({len(dataset)} samples)")
    logger.info(f"Strategies: {args.strategies}")
    logger.info(f"Chunk sizes: {args.chunk_sizes}")
    logger.info(f"Overlaps: {args.overlaps}")
    logger.info(f"LLM Provider: {args.provider}")
    
    ragas_config = _create_ragas_config(args)
    
    benchmark = ChunkingBenchmark(
        dataset=dataset,
        source_documents=documents,
        ragas_config=ragas_config,
        use_embeddings=args.use_embeddings,
    )
    
    logger.info("Starting benchmark run...")
    results = benchmark.run_comparison(
        strategies=args.strategies,
        chunk_sizes=args.chunk_sizes,
        overlaps=args.overlaps,
        top_k=args.top_k,
    )
    
    print("\n" + "=" * 80)
    print("BENCHMARK RESULTS")
    print("=" * 80 + "\n")
    print(results.to_summary_table())
    print()
    
    if results.best_strategy:
        best = results.best_config
        print(f"Recommended configuration:")
        print(f"  Strategy: {best['strategy']}")
        print(f"  Chunk size: {best['chunk_size']} tokens")
        print(f"  Overlap: {best['chunk_overlap']} tokens")
    
    if args.output:
        results.to_json(args.output)
        logger.info(f"Results saved to {args.output}")
    
    return results


if __name__ == "__main__":
    main()
