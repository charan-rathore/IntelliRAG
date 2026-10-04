# Multi-repository retrieval comparison

IntelliRAG keyword pipeline versus plain BM25, same 1,400-token context budget, required-evidence recall (share of required source sentences present in the context handed to the model). No LLM, no network.

Run from `web/`: `npx tsx scripts/multi-repo-eval.ts --final --rows`. `python3 eval/multi-repo/build_dataset.py` rebuilds and re-validates `dataset.json` (every anchor must be an exact substring of its pinned README).

| Split | Sources | Answerable questions |
|---|---|---|
| development | p-queue, chalk, p-retry, ky, commander | 58 |
| holdout | p-map, uuid | 24 |

Holdout questions were written before any change to the pipeline. The holdout was run twice: once for the baseline, once for the final result. It was not used to choose anything.

Result (plain BM25 vs IntelliRAG with passage packing): development 81.0% vs 93.2%; holdout 79.2% vs 91.7% (3 wins, 0 losses, paired bootstrap 95% interval 0.0 to 25.0 points); all 80.5% vs 92.8%. Mean context tokens on the holdout: 1254 vs 999.

Limits: questions and anchors are authored by the project, one reviewer, README-only corpora, 82 answerable questions, keyword mode (no embeddings). This measures evidence retention, not generated-answer accuracy. Unsupported-question refusal is unchanged by this work and is not a headline result (holdout: 0 of 4 probes refused).
