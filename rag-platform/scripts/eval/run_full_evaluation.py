#!/usr/bin/env python3
"""Full RAG pipeline evaluation using the unified evaluation platform.

Runs all layers: retrieval, reranking, context assembly, generation, faithfulness.
Produces distribution metrics, adversarial probes, quality gate, and JSON report.

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_full_evaluation.py
    PYTHONPATH=rag-platform python scripts/eval/run_full_evaluation.py --save-baseline
    PYTHONPATH=rag-platform python scripts/eval/run_full_evaluation.py --use-ollama
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser(description="Full RAG pipeline evaluation")
    parser.add_argument(
        "--dataset",
        default="data/eval/golden_dataset.json",
        help="Path to golden evaluation dataset",
    )
    parser.add_argument("--use-ollama", action="store_true")
    parser.add_argument("--model", default="llama3.2")
    parser.add_argument("--ollama-url", default="http://localhost:11434")
    parser.add_argument("--save-baseline", action="store_true")
    parser.add_argument(
        "--baseline-dir",
        default="data/eval/baselines",
        help="Directory for baseline storage",
    )
    parser.add_argument(
        "--output",
        default="data/eval/reports/latest_report.json",
        help="Output path for JSON report",
    )
    parser.add_argument("--no-adversarial", action="store_true")
    parser.add_argument("--lenient-gate", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()

    from libs.rag.evaluation.models import EvaluationDataset
    from libs.rag.evaluation.parameters import PipelineParameters
    from libs.rag.evaluation.platform import EvaluationPlatform
    from libs.rag.evaluation.thresholds import QualityGateConfig
    from libs.rag.generation.config import GenerationConfig
    from libs.rag.generation.ollama import MockLLMClient, OllamaClient
    from libs.rag.generation.service import GenerationService
    from scripts.eval.pipeline_builder import build_eval_pipeline

    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        logger.error(f"Dataset not found: {dataset_path}")
        sys.exit(1)

    dataset = EvaluationDataset.from_json(dataset_path)
    logger.info(f"Loaded dataset: {dataset.name} ({len(dataset)} samples)")

    gen_config = GenerationConfig.for_ollama(model=args.model, base_url=args.ollama_url)
    if args.use_ollama:
        client = OllamaClient(gen_config)
        if not client.is_available():
            logger.error("Ollama not available at %s", args.ollama_url)
            sys.exit(1)
        logger.info("Using Ollama: %s", args.model)
    else:
        client = MockLLMClient()
        logger.info("Using mock LLM")

    tmpdir = tempfile.mkdtemp(prefix="full-eval-")
    try:
        pipeline = build_eval_pipeline(tmpdir)
        pipeline.generation_service = GenerationService(config=gen_config, llm_client=client)

        gate_config = QualityGateConfig.lenient() if args.lenient_gate else QualityGateConfig()

        params = PipelineParameters(
            run_id=str(uuid4()),
            timestamp="",
            dataset_name=dataset.name,
            dataset_version=dataset.version,
            num_samples=len(dataset),
            generation_model=args.model,
            judge_model="lexical",
        )

        platform = EvaluationPlatform(
            dataset=dataset,
            pipeline=pipeline,
            parameters=params,
            quality_gate_config=gate_config,
            baseline_dir=args.baseline_dir,
        )

        report = platform.run(
            run_adversarial=not args.no_adversarial,
            check_quality_gate=True,
            compare_baseline=True,
        )

        print("\n" + report.to_summary())

        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        report.to_json(args.output)
        logger.info(f"Report saved to {args.output}")

        if args.save_baseline:
            platform.save_baseline(report)
            logger.info(f"Baseline saved to {args.baseline_dir}/latest.json")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
