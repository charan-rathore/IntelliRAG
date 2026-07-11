#!/usr/bin/env python3
"""Run task-specific evaluation sliced by task type.

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_task_eval.py
    PYTHONPATH=rag-platform python scripts/eval/run_task_eval.py --output data/eval/reports/task_eval_report.json
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser(description="Task-specific RAG evaluation")
    parser.add_argument(
        "--dataset",
        default="data/eval/golden_dataset.json",
        help="Golden evaluation dataset path",
    )
    parser.add_argument(
        "--output",
        default="data/eval/reports/task_eval_report.json",
        help="Output JSON report path",
    )
    parser.add_argument("--no-adversarial", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()

    from datetime import datetime

    from libs.rag.evaluation.models import EvaluationDataset
    from libs.rag.evaluation.parameters import PipelineParameters
    from libs.rag.evaluation.task_eval import TaskEvaluator
    from libs.rag.evaluation.thresholds import QualityGateConfig
    from libs.rag.generation.config import GenerationConfig
    from libs.rag.generation.ollama import MockLLMClient
    from libs.rag.generation.service import GenerationService
    from scripts.eval.pipeline_builder import build_eval_pipeline

    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        logger.error("Dataset not found: %s", dataset_path)
        sys.exit(1)

    dataset = EvaluationDataset.from_json(dataset_path).with_task_types()
    logger.info("Loaded dataset: %s (%d samples)", dataset.name, len(dataset))

    tmpdir = tempfile.mkdtemp(prefix="task-eval-")
    try:
        pipeline = build_eval_pipeline(tmpdir)
        pipeline.generation_service = GenerationService(
            config=GenerationConfig.for_ollama(model="mock"),
            llm_client=MockLLMClient(),
        )

        params = PipelineParameters(
            run_id=str(uuid4()),
            timestamp=datetime.now().isoformat(),
            dataset_name=dataset.name,
            dataset_version=dataset.version,
            num_samples=len(dataset),
            generation_model="mock",
        )

        evaluator = TaskEvaluator()
        report = evaluator.evaluate(
            dataset=dataset,
            pipeline=pipeline,
            parameters=params,
            quality_gate_config=QualityGateConfig.lenient(),
            run_adversarial=not args.no_adversarial,
        )

        print("\n" + report.to_summary())

        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report.to_dict(), indent=2))
        logger.info("Report saved to %s", output_path)

        if not report.all_passed:
            logger.warning("Some task types failed thresholds")
            sys.exit(1)

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
