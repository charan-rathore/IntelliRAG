#!/usr/bin/env python3
"""Compare IntelliRAG against SOTA RAG baselines on the task benchmark.

Usage:
    PYTHONPATH=rag-platform python scripts/eval/run_sota_comparison.py
    PYTHONPATH=rag-platform python scripts/eval/run_sota_comparison.py --save-baselines
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser(description="SOTA baseline comparison")
    parser.add_argument(
        "--dataset",
        default="data/eval/golden_dataset.json",
    )
    parser.add_argument(
        "--output",
        default="data/eval/reports/sota_comparison.json",
    )
    parser.add_argument(
        "--baseline-dir",
        default="data/eval/baselines/sota",
        help="Directory to save per-config SOTA baseline metrics",
    )
    parser.add_argument("--save-baselines", action="store_true")
    parser.add_argument("--no-adversarial", action="store_true")
    parser.add_argument(
        "--require-win",
        action="store_true",
        help="Exit 1 unless IntelliRAG beats all baselines",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    from libs.rag.evaluation.models import EvaluationDataset
    from libs.rag.evaluation.sota_comparison import (
        SOTAComparisonRunner,
        save_sota_baselines,
    )

    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        logger.error("Dataset not found: %s", dataset_path)
        sys.exit(1)

    dataset = EvaluationDataset.from_json(dataset_path)
    logger.info("Running SOTA comparison on %s (%d samples)", dataset.name, len(dataset))

    runner = SOTAComparisonRunner()
    report = runner.compare(dataset, run_adversarial=not args.no_adversarial)

    print("\n" + report.to_summary())

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report.to_dict(), indent=2))
    logger.info("Report saved to %s", output_path)

    if args.save_baselines:
        save_sota_baselines(report, args.baseline_dir)
        logger.info("SOTA baselines saved to %s", args.baseline_dir)

    if args.require_win and not report.intellirag_beats_all:
        logger.error(
            "IntelliRAG did not beat all baselines (margin=%+.4f)",
            report.margin_over_best_baseline,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
