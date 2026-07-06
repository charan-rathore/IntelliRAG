#!/usr/bin/env python3
"""Demo: run an instrumented RAG query and print observability output.

Usage:
    PYTHONPATH=rag-platform python scripts/observability/demo_observed_query.py
"""

from __future__ import annotations

import json
import shutil
import tempfile

from libs.observability.collector import ObservabilityCollector
from libs.observability.dashboard import Dashboard
from libs.observability.pipeline import ObservedRAGPipeline
from libs.rag.generation.ollama import MockLLMClient
from libs.rag.generation.service import GenerationService
from scripts.eval.pipeline_builder import build_eval_pipeline

QUERIES = [
    "What caused the Kubernetes pod scheduling failures?",
    "How should you manage the Python asyncio event loop?",
    "What is the recommended approach for aiohttp connection pooling?",
]


def main():
    tmpdir = tempfile.mkdtemp(prefix="obs-demo-")
    try:
        handles = build_eval_pipeline(tmpdir)
        handles.generation_service = GenerationService(llm_client=MockLLMClient())

        collector = ObservabilityCollector()
        pipeline = ObservedRAGPipeline(
            retrieval_service=handles.retrieval_service,
            reranking_service=handles.reranking_service,
            context_service=handles.context_service,
            generation_service=handles.generation_service,
            faithfulness_evaluator=handles.faithfulness_evaluator,
            collector=collector,
        )

        print("Running instrumented RAG queries...\n")
        for q in QUERIES:
            result = pipeline.query(q)
            print(f"Q: {q}")
            print(f"  trace_id={result.trace_id[:8]}... "
                  f"faith={result.eval_scores.get('faithfulness', 0):.2f} "
                  f"latency={result.total_latency_ms:.0f}ms")
            print(f"  A: {result.answer[:120]}...")
            print()

        snap = collector.snapshot()
        print("=" * 60)
        print("OBSERVABILITY SNAPSHOT")
        print("=" * 60)
        print(json.dumps(snap.summary, indent=2))

        dashboard = Dashboard(collector)
        html_path = "data/observability/dashboard.html"
        from pathlib import Path
        Path(html_path).parent.mkdir(parents=True, exist_ok=True)
        Path(html_path).write_text(dashboard.to_html())
        print(f"\nDashboard HTML saved to {html_path}")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
