#!/usr/bin/env python3
"""Generate synthetic documents for scalability load testing."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def generate_docs(count: int, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        doc = {
            "doc_id": f"synthetic-{i:06d}",
            "title": f"Synthetic Runbook {i}",
            "body": (
                f"# Incident {i}\n\n"
                f"Service degradation observed in region-{i % 10}. "
                f"Root cause: memory pressure on node pool {i % 50}. "
                f"Resolution: scale replicas and apply resource quotas."
            ),
        }
        (output / f"{doc['doc_id']}.json").write_text(json.dumps(doc))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--output", default="data/scalability/synthetic_corpus")
    args = parser.parse_args()
    generate_docs(args.count, Path(args.output))
    print(f"Generated {args.count} synthetic docs in {args.output}")


if __name__ == "__main__":
    main()
