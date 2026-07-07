#!/usr/bin/env python3
"""Load test the Query API with concurrent requests."""

from __future__ import annotations

import argparse
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx


def run_load_test(base_url: str, num_requests: int, concurrency: int) -> dict:
    latencies: list[float] = []
    errors = 0
    payload = {"question": "What caused the Kubernetes pod scheduling failures?", "top_k": 5}

    def _one_request() -> float:
        start = time.monotonic()
        response = httpx.post(f"{base_url}/query", json=payload, timeout=60.0)
        response.raise_for_status()
        return (time.monotonic() - start) * 1000

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(_one_request) for _ in range(num_requests)]
        for future in as_completed(futures):
            try:
                latencies.append(future.result())
            except Exception:
                errors += 1

    latencies.sort()
    p95_idx = max(0, int(len(latencies) * 0.95) - 1)
    return {
        "requests": num_requests,
        "concurrency": concurrency,
        "success": len(latencies),
        "errors": errors,
        "avg_ms": statistics.mean(latencies) if latencies else 0,
        "p50_ms": statistics.median(latencies) if latencies else 0,
        "p95_ms": latencies[p95_idx] if latencies else 0,
        "qps": len(latencies) / (sum(latencies) / 1000) if latencies else 0,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--requests", type=int, default=20)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    result = run_load_test(args.url, args.requests, args.concurrency)
    print(json_dumps(result))


def json_dumps(data: dict) -> str:
    import json
    return json.dumps(data, indent=2)


if __name__ == "__main__":
    main()
