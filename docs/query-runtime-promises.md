# Query runtime promises

- A query with `skipCache: true` bypasses a matching answer without deleting that answer from the cache. A later query can still use it.
- With no generation provider configured, a supported fresh query returns an extractive answer from the retrieved source passages. It does not enter the generation stage or make provider requests, and generation latency is zero.

These contracts are exercised through the real server wrappers in [query-runtime.test.ts](../web/src/lib/rag/query-runtime.test.ts). The tests use the ephemeral corpus with no provider credentials and a rejecting network stub.
