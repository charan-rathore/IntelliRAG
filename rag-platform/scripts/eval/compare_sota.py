#!/usr/bin/env python3
"""Push gate: IntelliRAG must beat all SOTA baselines on task benchmark.

Runs SOTA comparison and exits 0 only when production config outperforms
naive_dense, bm25_only, and hybrid_no_rerank on composite task score.

Usage:
    PYTHONPATH=rag-platform python scripts/eval/compare_sota.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="SOTA push gate")
    parser.add_argument(
        "--report",
        default="data/eval/reports/sota_comparison.json",
        help="Pre-computed SOTA report (skip re-run if exists and --use-cache)",
    )
    parser.add_argument("--use-cache", action="store_true")
    parser.add_argument("--min-margin", type=float, default=0.0)
    return parser.parse_args()


def main():
    args = parse_args()
    report_path = Path(args.report)

    if not args.use_cache or not report_path.exists():
        from libs.rag.evaluation.models import EvaluationDataset
        from libs.rag.evaluation.sota_comparison import SOTAComparisonRunner, save_sota_baselines

        dataset = EvaluationDataset.from_json("data/eval/golden_dataset.json")
        report = SOTAComparisonRunner().compare(dataset)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report.to_dict(), indent=2))
        save_sota_baselines(report, "data/eval/baselines/sota")
    else:
        data = json.loads(report_path.read_text())
        from libs.rag.evaluation.sota_comparison import SOTAComparisonReport, SOTARunResult, SOTAConfig

        results = []
        for entry in data.get("rankings", []):
            config = SOTAConfig(
                name=entry["name"],
                description=entry.get("description", ""),
                retrieval_mode=entry.get("retrieval_mode", "hybrid"),
                reranker_type=entry.get("reranker_type", "lexical"),
                context_strategy=entry.get("context_strategy", "full"),
                is_production=entry.get("is_production", False),
            )
            results.append(
                SOTARunResult(
                    config=config,
                    composite_score=entry["composite_score"],
                    aggregate_metrics=entry.get("aggregate_metrics", {}),
                )
            )
        report = SOTAComparisonReport(
            dataset_name=data.get("dataset_name", ""),
            results=results,
            winner=data.get("winner", ""),
            intellirag_beats_all=data.get("intellirag_beats_all", False),
            margin_over_best_baseline=data.get("margin_over_best_baseline", 0.0),
        )

    print(f"Winner: {report.winner}")
    print(f"IntelliRAG beats all: {report.intellirag_beats_all}")
    print(f"Margin over best baseline: {report.margin_over_best_baseline:+.4f}")

    if not report.intellirag_beats_all:
        print("FAIL: IntelliRAG does not beat all SOTA baselines", file=sys.stderr)
        sys.exit(1)

    if report.margin_over_best_baseline < args.min_margin:
        print(
            f"FAIL: margin {report.margin_over_best_baseline:.4f} < {args.min_margin}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("PASS: IntelliRAG outperforms all SOTA baselines on task benchmark")


if __name__ == "__main__":
    main()
