# Phase 8: Context Assembly Architecture

## Problem Statement

Reranking produces an ordered list of relevant chunks, but LLMs have finite context windows and redundant information wastes tokens. Context assembly transforms ranked chunks into a compact, deduplicated, budget-constrained prompt context that maximizes answer quality per token.

## Functional Requirements

1. Select the most informative chunks from reranked candidates
2. Remove duplicate and near-duplicate content
3. Pack chunks within a configurable token budget
4. Optionally compress individual chunks extractively
5. Format context with citation labels for Phase 9 attribution
6. Benchmark assembly strategies objectively

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Latency | <50ms for assembly (excluding retrieval/rerank) |
| Token budget | Configurable, default 2048 tokens |
| Deduplication | Remove >85% Jaccard similar chunks |
| Extensibility | Strategy enum for A/B testing |

## Design Options

| Component | Options | Chosen | Rationale |
|---|---|---|---|
| Deduplication | Exact match, MinHash, Jaccard | Jaccard (0.85) | Simple, no extra deps, good for chunk-level dupes |
| Selection | Top-K, MMR, clustering | MMR (lambda=0.7) | Balances relevance and diversity without extra model |
| Budget packing | Greedy by score, knapsack DP | Greedy by score/token | Fast, good enough for <20 candidates |
| Compression | LLM summarize, extractive | Extractive | Zero API cost, preserves factual content |
| Citations | Inline [N], footnotes, metadata only | [Source N] inline | Ready for Phase 9 citation verification |

## Pipeline

```
RerankedChunks
    |
    v
Deduplication (Jaccard >= 0.85)
    |
    v
MMR Selection (diversity)
    |
    v
Token Budget Packing (greedy)
    |
    v
Extractive Compression (optional)
    |
    v
Citation Formatting
    |
    v
AssembledContext
```

## Assembly Strategies

| Strategy | Dedup | MMR | Budget | Compression |
|---|---|---|---|---|
| top_k | No | No | No | No |
| dedup_only | Yes | No | No | No |
| mmr | Yes | Yes | No | No |
| budget | No | No | Yes | No |
| full | Yes | Yes | Yes | No |
| full_compressed | Yes | Yes | Yes | Yes |

## Evaluation Strategy

The context benchmark (`libs/rag/evaluation/context_benchmark.py`) measures:

1. **Context precision**: fraction of tokens from relevant chunks
2. **Context recall**: fraction of reference phrases captured
3. **Token efficiency**: precision * recall / budget utilization
4. **Dedup rate**: redundant chunks removed
5. **Budget utilization**: tokens used vs limit
6. **Source diversity**: unique documents in context
7. **Compression ratio**: tokens saved by compression
8. **Budget sweep**: find optimal token budget inflection point

Run: `PYTHONPATH=rag-platform python scripts/eval/run_context_benchmark.py --budget-sweep`

## Failure Modes

| Failure | Mitigation |
|---|---|
| All chunks are duplicates | Keep highest-scored chunk, never return empty if input non-empty |
| Budget too small for any chunk | Include at least top-1 chunk truncated |
| MMR selects zero diversity | Fall back to top-K by score |
| Compression removes all content | Keep headers and first sentence |

## Production Gap

| Local | Production | Upgrade |
|---|---|---|
| chars/4 token estimate | tiktoken or model tokenizer | Before production LLM integration |
| Extractive compression | LLM summarization (Ollama) | When budget is very tight |
| Jaccard dedup | Semantic dedup (embedding similarity) | When near-duplicates are paraphrases |

## Next: Phase 9 LLM Generation

Feed AssembledContext into Ollama prompt with citation-aware generation and faithfulness evaluation.
