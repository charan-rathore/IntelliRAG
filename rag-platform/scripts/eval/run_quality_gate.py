#!/usr/bin/env python3
"""CI quality gate for RAG pipeline evaluation.

Exits with code 1 if any metric breaches threshold floors.
Designed for GitHub Actions PR-blocking gates.

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_quality_gate.py
    PYTHONPATH=rag-platform python scripts/eval/run_quality_gate.py --fail-on-threshold-breach
    PYTHONPATH=rag-platform python scripts/eval/run_quality_gate.py --lenient
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
    parser = argparse.ArgumentParser(description="RAG CI quality gate")
    parser.add_argument(
        "--dataset",
        default="data/eval/golden_dataset.json",
    )
    parser.add_argument(
        "--baseline-dir",
        default="data/eval/baselines",
    )
    parser.add_argument(
        "--fail-on-threshold-breach",
        action="store_true",
        default=True,
        help="Exit 1 on gate failure (default: True)",
    )
    parser.add_argument(
        "--no-fail",
        action="store_true",
        help="Report only, do not exit 1 on failure",
    )
    parser.add_argument(
        "--lenient",
        action="store_true",
        help="Use lenient thresholds for smoke tests",
    )
    parser.add_argument(
        "--save-baseline",
        action="store_true",
        help="Update baseline after successful run",
    )
    parser.add_argument(
        "--output",
        default="data/eval/reports/ci_report.json",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    from libs.rag.evaluation.models import EvaluationDataset
    from libs.rag.evaluation.parameters import PipelineParameters
    from libs.rag.evaluation.platform import EvaluationPlatform
    from libs.rag.evaluation.quality_gate import GateVerdict
    from libs.rag.evaluation.thresholds import QualityGateConfig
    from libs.rag.generation.config import GenerationConfig
    from libs.rag.generation.ollama import MockLLMClient
    from libs.rag.generation.service import GenerationService
    from scripts.eval.pipeline_builder import build_eval_pipeline

    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        logger.error(f"Dataset not found: {dataset_path}")
        sys.exit(1)

    dataset = EvaluationDataset.from_json(dataset_path)
    gate_config = QualityGateConfig.lenient() if args.lenient else QualityGateConfig()

    tmpdir = tempfile.mkdtemp(prefix="quality-gate-")
    try:
        pipeline = build_eval_pipeline(tmpdir)
        gen_config = GenerationConfig()
        pipeline.generation_service = GenerationService(
            config=gen_config, llm_client=MockLLMClient()
        )

        params = PipelineParameters(
            run_id=str(uuid4()),
            timestamp="",
            dataset_name=dataset.name,
            dataset_version=dataset.version,
            num_samples=len(dataset),
        )

        platform = EvaluationPlatform(
            dataset=dataset,
            pipeline=pipeline,
            parameters=params,
            quality_gate_config=gate_config,
            baseline_dir=args.baseline_dir,
        )

        report = platform.run(
            run_adversarial=True,
            check_quality_gate=True,
            compare_baseline=Path(args.baseline_dir, "latest.json").exists(),
        )

        print("\n" + report.to_summary())
        report.to_json(args.output)

        if report.quality_gate:
            print(f"\nGate Verdict: {report.quality_gate.verdict.value.upper()}")

            if args.save_baseline and report.quality_gate.verdict != GateVerdict.FAIL:
                platform.save_baseline(report)
                logger.info("Baseline updated")

            should_fail = (
                args.fail_on_threshold_breach
                and not args.no_fail
                and report.quality_gate.verdict == GateVerdict.FAIL
            )
            if should_fail:
                logger.error("Quality gate FAILED — blocking merge")
                for f in report.quality_gate.failures:
                    logger.error(f"  {f}")
                sys.exit(1)

        logger.info("Quality gate passed")
        sys.exit(0)

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
