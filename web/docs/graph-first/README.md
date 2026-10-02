# Graph-first dense retrieval (draft implementation)

Based on main 973967af9e0221a728bbe841ea559ab375089ca5. Branch only; not deployed.

## Design
The existing exact answer cache remains first and remains exact question/corpus/policy only. On an answer-cache miss, embed the new question. Search a bounded learned working set of at most 256 source-chunk vectors before loading the normal full chunk index. Learn only positive-gate retrieved context chunks, not generated answers. Each resident node contains chunk/document/corpus identity, content hash, embedding model, dimension, vector hash and the actual vector. Raw vectors are not emitted to the web UI.

Strong roots require query cosine >= 0.88 and within 0.02 of the best match (up to 3 roots). Stored semantic-neighbor edges connect up to four compatible nearest neighbors per node with cosine >= 0.70; edges do not bridge corpora/models/dimensions. Cost = max(0.001, 1 - clamped cosine). Query-to-root cost uses the same meaning. Costs are dissimilarities, not probabilities or evidence confidence.

Multi-source Dijkstra minimizes summed dissimilarity, allowing cheaper multihop routes over expensive direct edges. Total path budget 0.45; candidates also need query cosine >= 0.70; at most 24 are fetched. Paths choose candidate eligibility/order and add a bounded 0.04/(1+cost) rerank boost. The existing evidence and context packing rules still apply. This is genuinely weighted shortest-path retrieval, not BFS relabeled or an explanation-only algorithm.

Fetch candidates by indexed chunk IDs. Verify corpus/document/content/model/dimension/vector hash against current stored rows. Accept graph-only retrieval only for positive evidence with at least two distinctive question terms and >=80% term support. Cross-source/comparison requests fall back. Weak vectors, stale/missing rows, ambiguous/insufficient evidence, unavailable dense storage and graph I/O failures use the existing full-corpus path. Thresholds are conservative initial policy, not calibrated correctness guarantees or recall proof.

Source version/model fingerprint change clears vector memory along with existing answer cache/feedback. Selected rows are independently revalidated on every graph hit. Same-model changed vector bytes cannot silently reuse stale identities. Unchanged nodes avoid rebuild/persist. The graph cache is global in existing architecture; this change preserves existing corpus scoping, not a new multi-tenant isolation model. Existing all-corpus mode may retrieve multiple corpora, but semantic edges do not bridge them.

Web graph snapshots gain chunk-reference nodes and semantic-neighbor edges. Query events expose real roots, costs, paths, candidate counts, graph/full route and fallback reason. Evidence panel renders the actual shortest-path forest. A graph is not always a tree, and some successful queries have only one root with no multihop path.

## Tests
- RAG suite: 100 tests, 100 passed (11 added tests).
- Typecheck and production build passed.
- Actual local PGLite integration: primary-key candidate fetch, graph hit with full-loader prohibited, unchanged citation text, model rejection, version invalidation passed.
- Actual runQueryStream integration with synthetic 768-dimensional embeddings and synthetic streaming generation: cold full fallback, repeat graph hit, related graph hit, with answer cache bypassed. Not real-provider end-to-end proof.
- Broader repository script suite: 182 passed / 16 failed of 198. The same 16 failures reproduce unchanged on base main, in template/metadata fixtures. No claim that all repository tests pass.
- Desktop/mobile Evidence trace pixels inspected. Visual fixture replays the actual synthetic query event stream; it is UI verification, not a live provider demo.

## Before/after measurements
Local PGLite, 1000 chunks with synthetic 128-dimensional vectors, 1 resident learned vector, 5 warmups + 20 measurements:
- Graph median 2.82185 ms; p95 11.16312 ms.
- Full-index median 41.93435 ms; p95 61.32831 ms.
- 25 candidate-ID fetches; zero full loader calls on graph hits.
Graph timing includes metadata revision check, candidate SQL fetch, validation, rerank and evidence. Full timing includes full-row SQL fetch and retrieval. Neither includes provider, server transport, initial query health metadata/counts or post-retrieval learning persistence. Do not present as total answer-latency speedup. There are still document metadata/health and pending-embedding count operations in runQueryStream outside this benchmark.

CPU-only benchmark, 30 measurements after 5 warmups, same synthetic dimensions and 1 learned vector:
| Full corpus chunks | Graph median ms | Full median ms |
|---:|---:|---:|
| 100 | 0.26057 | 3.20918 |
| 1000 | 0.21203 | 11.54029 |
| 5000 | 0.24589 | 56.78206 |
This favorable working set is not representative of every graph size/hit distribution. Synthetic results cannot prove real model retrieval accuracy.

## Real-provider diagnostic
Tiny fixed 3-chunk corpus; 9 sequential selected queries, actual retrieval functions, exact answer cache bypassed. Embeddings google/gemini-embedding-2 returned 3072 dimensions in this diagnostic. The production adapter requests 768 and formats inputs differently; do not equate this check with production-adapter or full-server evaluation. Matched Gemini 3.7 Flash grounded generation for both arms.

- Graph routes: 2/9 overall; exact repeat 1/1; related questions 1/2. Remaining queries fell back.
- Six supported answers per arm inspected against supplied source text; all give the expected timeout/pause/abort facts with valid source markers. This is manual diagnostic review, not RAGAS or human-adjudicated accuracy.
- Unsupported abstentions: 3/3 per arm. Password blocked by gate; throughput/Postgres cases still reached the generator, which refused. Finite outcomes are not a blanket anti-hallucination guarantee.
- All fetched citation texts match store content.
- Real provider multihop paths: zero in this small corpus. Weighted multihop behavior is covered by controlled algorithm tests, not demonstrated by this provider run.
- 28 calls total: 12 embeddings ($0.00003894), 16 generation ($0.01676175), total $0.01680069. No provider errors; every cost known. Hard cap $5. Private entry and processes removed at completion.
- No RAGAS judge was run for this build. Earlier RAGAS comparison is separate, not a before/after score for this feature.

## Remaining risks
Strong similarity and local term coverage do not prove full-corpus completeness. Novel paraphrases may fall back; local high coverage can miss a more authoritative source elsewhere. Cold graphs have no speed advantage. The 256-vector cap is a bounded working set, not an ANN index; it is still scanned for seeds. Dijkstra currently uses a simple bounded-set implementation suitable for 256 nodes, not a claim of scale. Neighbor rebuilding costs grow with resident graph size, although unchanged vectors avoid rebuild. Concurrent distributed graph writes still inherit the existing whole-state persistence limitations. Larger held-out/provider/server tests and an independently reviewed corpus are needed before release.

Raw measurements and answers are in this directory. No credentials, private entry URLs, harness server or runtime logs are included.
