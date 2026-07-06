#!/usr/bin/env python3
"""Serve the RAG observability dashboard.

Usage:
    PYTHONPATH=rag-platform python scripts/observability/serve_dashboard.py
    PYTHONPATH=rag-platform python scripts/observability/serve_dashboard.py --port 8080
"""

from __future__ import annotations

import argparse

import uvicorn

from libs.observability.api import create_observability_app


def main():
    parser = argparse.ArgumentParser(description="Serve RAG observability dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    app = create_observability_app()
    print(f"Dashboard: http://{args.host}:{args.port}/dashboard")
    print(f"Metrics:   http://{args.host}:{args.port}/metrics")
    print(f"Health:    http://{args.host}:{args.port}/health")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
