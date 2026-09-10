# IntelliRAG next milestones

The [public browser lab](https://intellirag-live-own-track.vercel.app/) lives in `web/`, deployed from the canonical `charan-rathore/IntelliRAG` repository. The Python platform remains in `rag-platform/`.

## Production milestone

1. Connect Neon/Postgres and provider credentials privately in Vercel.
2. Apply migrations and index the frozen corpus with actual `gemini-embedding-2` vectors.
3. Verify dense/BM25 hybrid execution, generated answers and citation quality on the public host.
4. Re-run after a changed worker with an unchanged persisted index and an imported sentinel document.
5. Publish the frozen acceptance artifacts and real custom-judge results, including failures, latency and human disagreement.

[WEB.md](WEB.md) contains executable acceptance commands. [audit/REPORT.md](audit/REPORT.md) tracks concrete findings; no unconfigured provider stage is marked complete.

## Implemented foundations

- Atomic document/chunk replacement, same-slug transaction locks, migration tracking.
- Request-local browser keys, corpus-scoped exact answer caching and correction invalidation.
- Lexical graph rebuilds when documents change, bounded adjacency traversal, orphan pruning and keyboard/touch inspection.
- Persistent evaluation run records with dataset/index hashes; explicit failure on unavailable judge.
- Production health endpoint and a frozen pipeline acceptance runner.

## Engineering still required

- Ownership and shared abuse limits for mutation/evaluation endpoints; stronger URL ingestion controls.
- Concurrent graph persistence without whole-state overwrites; incremental extraction, subgraph APIs and retention.
- Benchmark JSON-vector scans, then introduce pgvector/ANN when corpus size warrants it.
- Typed semantic entities/relations with cited spans and alias deduplication if semantic GraphRAG is intended. The current shared-token links are lexical associations.
- Graph-on/off ablations, multi-hop and contradiction fixtures, relation precision/recall and retrieval/answer metrics measured separately.
- Isolate or restore inherited app-builder test fixtures so the legacy aggregate test command is useful again.

Preserve frozen evaluation cases when tuning ranking. Expand with versioned real issue discussions and imported source-injection/negation/number tests; report regressions as well as averages.
