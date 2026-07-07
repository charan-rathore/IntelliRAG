#!/usr/bin/env python3
"""Run Phase 12 capacity review across scale tiers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from libs.scalability import CapacityModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="data/scalability/capacity_report.json",
    )
    args = parser.parse_args()

    model = CapacityModel()
    report = model.full_report()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2))

    print(f"Capacity report written to {output}")
    for tier, data in report.items():
        print(
            f"{tier}: storage={data['storage_mb']:.1f}MB, "
            f"query_p95~{data['estimated_query_latency_p95_ms']:.0f}ms, "
            f"bottlenecks={len(data['bottlenecks'])}"
        )


if __name__ == "__main__":
    main()
