# Code search on CoSQA

The search bar (⌘K in the app, `GET /api/search`) ranks passages with
`web/src/lib/rag/code-search.ts`. This folder measures it on **CoSQA**
(Huang et al., ACL 2021): real Bing queries such as "python remove all empty
items in list" against all 6,267 unique Python functions in the dataset. The
313 dev queries labelled as answered by a function are scored by where that
function ranks.

Settings were tuned on 500 training queries only (`--tune`). The learned
associations come from CoSQA training pairs only; dev queries are never seen.

| Arm | nDCG@10 | MRR@10 | R@1 | R@5 | R@10 |
|---|---|---|---|---|---|
| BM25 with IntelliRAG's prose tokenizer | 42.86 | 37.08 | 27.16 | 52.08 | 61.34 |
| + identifier-aware tokens (`parseJSON` → parse, json) | 45.49 | 39.24 | 27.80 | 55.27 | 65.50 |
| + name and docstring fields (BM25F) | 45.82 | 39.83 | 27.80 | 53.99 | 64.86 |
| tried and left off: developer synonym lexicon | 44.18 | 38.33 | 26.20 | 52.72 | 62.62 |
| tried and left off: pseudo-relevance feedback (RM3) | 44.14 | 37.33 | 25.88 | 53.04 | 66.13 |
| **+ learned query→code associations (the search bar)** | **46.42** | **39.91** | 26.20 | **59.42** | **66.77** |

+3.56 nDCG@10 and +7.3 R@5 over plain BM25, with no model and no GPU. R@1 dips:
associations widen recall more than they sharpen the very top.

**How this compares, honestly.** These are lexical numbers. Dense code
embeddings do better on CoSQA-style queries: on NanoCoIR's CosQA (the same
6,267 functions, a different 50-query sample) BM25 scores 30.5 nDCG@10 and
a dense model 67.3. CoIR's full CosQA leaderboard tops out at 36.3 on its own
query split. The splits differ, so none of these numbers are directly
comparable to the table above. IntelliRAG fuses this lexical ranking with
embeddings when an embedding key is set; the benchmark here is the part that
runs with no key.

In the product the associations are learned from questions people confirmed
a passage answers (the experience log), so search sharpens on your own sources
the more the app is used.

Reproduce, from `web/`:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/CodeXGLUE /tmp/cxg
git -C /tmp/cxg sparse-checkout set Text-Code/NL-code-search-WebQuery/CoSQA
COSQA_DIR=/tmp/cxg/Text-Code/NL-code-search-WebQuery/CoSQA npx tsx scripts/cosqa-bench.ts --check
```

CI runs the same check: the search bar must stay 2+ points above plain BM25
and match `cosqa-results.json`.
