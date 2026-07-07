#!/usr/bin/env python3
"""Compare eval report against baseline; exit 1 if metrics regressed."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Metrics where higher is better
HIGHER_BETTER = {
    "retrieval_mrr",
    "retrieval_recall",
    "retrieval_precision",
    "rerank_mrr_lift",
    "context_precision",
    "context_recall",
    "faithfulness",
    "citation_precision",
    "answer_relevancy",
    "adversarial_pass_rate",
}

LOWER_BETTER = {"hallucination_rate", "e2e_latency_p95_ms"}


def compare(current: dict, baseline: dict, min_improvements: int = 3) -> bool:
    """Return True if current is better than or equal to baseline."""
    improved = 0
    regressed = 0

    for metric, value in current.items():
        base = baseline.get(metric)
        if base is None:
            continue

        if metric in HIGHER_BETTER:
            if value > base + 0.001:
                improved += 1
            elif value < base - 0.001:
                regressed += 1
        if metric in LOWER_BETTER:
            if value < base - 0.001:
                improved += 1
            elif value > base + 0.001:
                if metric == "e2e_latency_p95_ms" and value < 100:
                    continue
                regressed += 1

    print(f"Improved metrics: {improved}, Regressed: {regressed}")
    return regressed == 0 and improved >= min_improvements


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", default="data/eval/reports/latest_report.json")
    parser.add_argument("--baseline", default="data/eval/baselines/pre_phase12.json")
    parser.add_argument("--min-improvements", type=int, default=3)
    args = parser.parse_args()

    current_path = Path(args.current)
    baseline_path = Path(args.baseline)

    if not current_path.exists():
        print(f"Current report not found: {current_path}", file=sys.stderr)
        sys.exit(1)
    if not baseline_path.exists():
        print(f"Baseline not found: {baseline_path}", file=sys.stderr)
        sys.exit(1)

    current = json.loads(current_path.read_text())["aggregate_metrics"]
    baseline = json.loads(baseline_path.read_text())

    if "metrics" in baseline:
        baseline_metrics = baseline["metrics"]
    else:
        baseline_metrics = baseline.get("aggregate_metrics", baseline)

    print("Metric comparison:")
    for metric in sorted(HIGHER_BETTER | LOWER_BETTER):
        cur = current.get(metric)
        base = baseline_metrics.get(metric)
        if cur is not None and base is not None:
            delta = cur - base
            print(f"  {metric}: {base:.4f} -> {cur:.4f} ({delta:+.4f})")

    if compare(current, baseline_metrics, args.min_improvements):
        print("PASS: benchmarks improved over baseline")
        sys.exit(0)

    print("FAIL: benchmarks did not improve sufficiently", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
