# Phase 9: LLM Generation Architecture

## Problem Statement

Context assembly produces a deduplicated, budget-constrained prompt with citation labels. Phase 9 transforms that context into grounded, attributable answers using a local LLM (Ollama), and evaluates whether those answers are faithful to the cited sources.

## Functional Requirements

1. Generate answers from `AssembledContext` using Ollama
2. Enforce generation-time citations (G-Cite), not post-hoc attribution
3. Parse and map `[Source N]` citations back to chunk IDs
4. Refuse to answer when context is empty or insufficient
5. Evaluate faithfulness at atomic-claim level
6. Benchmark across prompt styles and models

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Latency | <5s generation on local 3B model |
| Temperature | 0.0 (deterministic for eval reproducibility) |
| Cost | Zero API spend (Ollama only) |
| Eval reproducibility | Lexical fallback when Ollama unavailable |

## Design Options

| Component | Options | Chosen | Rationale |
|---|---|---|---|
| Citation timing | G-Cite (generation-time) vs P-Cite (post-hoc) | G-Cite | Higher citation precision; avoids post-rationalization |
| LLM client | LangChain, httpx direct, ollama-python | httpx direct | Consistent with embedder; no extra deps |
| Faithfulness eval | RAGAS only, NLI model, LLM-as-judge + lexical | LLM-as-judge + lexical fallback | Best-practice claim decomposition; works offline |
| Prompt styles | Single vs multi-style | 3 styles (citation_aware, concise, detailed) | A/B testable |

## Evaluation Strategy (Best Practices)

Based on current RAG evaluation research (RAG Triad, Wallat et al. 2025, SN Computer Science 2026):

### Metrics

| Metric | Definition | Why |
|---|---|---|
| **Faithfulness** | Claims with SUPPORT entailment / total claims | Primary groundedness metric |
| **Citation Precision** | Supporting citations / total citations | Measures citation correctness |
| **Citation Recall** | Claims with ≥1 supporting citation / total claims | Measures attribution coverage |
| **Hallucination Rate** | Unsupported + contradicted + uncited claims / total | Inverse of faithfulness |
| **Citation Coverage** | Claims with any citation / total claims | Detects uncited factual statements |
| **Answer Relevancy** | Query-answer token overlap (or RAGAS) | Ensures answer addresses the question |
| **Refusal Rate** | Refusals / total queries | Correct abstention when context insufficient |

### Evaluation Pipeline

```
Generated Answer
    |
    v
Atomic Claim Decomposition (sentence-level)
    |
    v
Citation Mapping (per-claim [Source N] extraction)
    |
    v
Entailment Check (SUPPORTS / CONTRADICTS / NEUTRAL / NO_CITATION)
    |
    v
Aggregate Metrics
```

### Key Distinction: Correctness vs Faithfulness

- **Citation correctness**: Does the cited passage support the claim? (we measure via entailment)
- **Citation faithfulness**: Did the model actually derive the claim from that passage? (G-Cite architecture + adversarial tests in future)

We implement correctness measurement now; faithfulness probing via adversarial context injection is documented as a Phase 10 upgrade.

## Pipeline

```
AssembledContext
    |
    v
Prompt Orchestration (system + user with sources)
    |
    v
Ollama /api/chat (temperature=0)
    |
    v
Citation Parsing ([Source N] -> chunk_id)
    |
    v
GenerationResult
    |
    v
FaithfulnessEvaluator (claim decomposition + entailment)
    |
    v
FaithfulnessResult
```

## Prompt Styles

| Style | Use Case |
|---|---|
| `citation_aware` | Default; strict grounding rules, mandatory citations |
| `concise` | Short answers with citations |
| `detailed` | Structured comprehensive answers |

## Failure Modes

| Failure | Mitigation |
|---|---|
| Model ignores citation format | Strict system prompt; parse failures logged |
| Post-rationalization (cites but didn't use source) | G-Cite prompts; adversarial eval in Phase 10 |
| Empty context | Automatic refusal without LLM call |
| Ollama unavailable | MockLLMClient for tests; lexical faithfulness fallback |
| LLM judge non-deterministic | temperature=0; lexical fallback on failure |

## Production Gap

| Local | Production | Upgrade Trigger |
|---|---|---|
| llama3.2 3B | Larger model or GPU serving | Faithfulness <70% on eval set |
| Lexical entailment | Dedicated NLI model (e.g., deberta) | Judge latency or accuracy insufficient |
| Manual benchmark | CI eval gate on PRs | After query API ships |
| Single judge model | Multi-judge agreement | Before production SLA |

## Run Benchmark

```bash
# Offline (mock LLM, lexical faithfulness)
PYTHONPATH=rag-platform python scripts/eval/run_generation_benchmark.py

# With real Ollama
PYTHONPATH=rag-platform python scripts/eval/run_generation_benchmark.py --use-ollama

# Compare prompt styles
PYTHONPATH=rag-platform python scripts/eval/run_generation_benchmark.py --compare-styles

# Full eval with LLM judge + RAGAS
PYTHONPATH=rag-platform python scripts/eval/run_generation_benchmark.py \
  --use-ollama --use-llm-judge --use-ragas
```
