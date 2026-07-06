# Phase 10: Evaluation Platform Architecture

## Problem Statement

Phases 1-9 built layer-specific benchmarks (chunking, retrieval, reranking, context, generation), but production RAG systems need a unified evaluation platform that runs before optimization, gates deploys on quality thresholds, tracks distributions (not just averages), and closes the loop from production failures back to test cases.

## Functional Requirements

1. Run end-to-end evaluation across all pipeline layers in one command
2. Track retrieval, generation, and operational metrics
3. Enforce CI quality gates with absolute threshold floors
4. Compare against versioned baselines for regression detection
5. Run adversarial faithfulness probes (canary injection)
6. Promote production failures into the golden dataset
7. Log all pipeline parameters for reproducibility
8. Produce JSON reports and human-readable summaries

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| CI runtime | <3 min with mock LLM on golden set (5 samples) |
| Reproducibility | Parameter logging + versioned datasets |
| Offline capable | Lexical judge fallback, no API keys |
| Extensibility | Injectable pipeline components |

## Design Options

| Component | Options | Chosen | Rationale |
|---|---|---|---|
| Orchestration | Per-layer scripts, RAGAS only, unified platform | Unified `EvaluationPlatform` | Single entry point; layer isolation for debugging |
| Quality gates | Manual review, RAGAS only, custom thresholds | Custom 3-tier thresholds + delta | pytest-native pass/fail; no SaaS dependency |
| Baseline storage | MLflow, W&B, JSON files | JSON files in `data/eval/baselines/` | Local-first; zero infra |
| Adversarial test | None, RAGAS, canary injection | Canary injection | Detects post-rationalization per Wallat 2025 |
| Failure loop | Manual, automated feed | `FailureFeed` → golden dataset | CI/CD closed-loop best practice |
| Distributions | Mean only, percentiles | P10/P50/P90/P95 + pass rate | Tail failures hide in averages |

## Architecture

```
Golden Dataset (versioned JSON)
        │
        ▼
EvaluationPlatform
        │
        ├── RetrievalBenchmark    → MRR, Recall, Precision, NDCG
        ├── RerankingBenchmark    → MRR lift, rank displacement
        ├── ContextBenchmark      → Context precision/recall
        ├── GenerationBenchmark   → Faithfulness, citations
        ├── AdversarialProbe      → Canary injection pass rate
        │
        ▼
DistributionStats (per metric: mean, P10, P90, pass rate)
        │
        ├── QualityGate           → Absolute floors + P10 tail check
        ├── BaselineStore         → Delta comparison (Welch's t-test)
        │
        ▼
EvalReport (JSON + text summary)
        │
        ├── CI: run_quality_gate.py (--fail-on-threshold-breach)
        └── Nightly: run_full_evaluation.py (--save-baseline)
```

## Evaluation Dimensions (SN Computer Science 2026 Framework)

| Dimension | Metrics | Layer |
|---|---|---|
| Retrieval quality | MRR, Recall@K, Precision@K, NDCG@K | Retrieval |
| Reranking lift | MRR lift, top-1 change rate | Reranking |
| Context quality | Context precision, context recall | Context Assembly |
| Groundedness | Faithfulness, hallucination rate | Generation |
| Attribution | Citation precision, citation coverage | Generation |
| Relevance | Answer relevancy | Generation |
| Faithfulness probing | Adversarial pass rate | Adversarial |
| Operations | E2E latency P50/P95, queries/sec | Operational |

## Quality Gate Thresholds

| Metric | Good | Warning | Critical |
|---|---|---|---|
| Faithfulness | ≥0.85 | ≥0.70 | <0.70 |
| Context Precision | ≥0.85 | ≥0.65 | <0.65 |
| Context Recall | ≥0.80 | ≥0.60 | <0.60 |
| Hallucination Rate | ≤0.15 | ≤0.30 | >0.30 |
| Adversarial Pass Rate | ≥0.90 | ≥0.70 | <0.70 |
| E2E Latency P95 | ≤5s | ≤10s | >10s |

P10 tail check: even if mean passes, P10 below critical floor triggers warning.

## CI/CD Integration

### PR Gate (fast, lenient)
```bash
PYTHONPATH=rag-platform python scripts/eval/run_quality_gate.py --lenient
```

### Nightly (full, baseline update)
```bash
PYTHONPATH=rag-platform python scripts/eval/run_full_evaluation.py --save-baseline
```

### GitHub Actions
`.github/workflows/rag-eval.yml`:
- `unit-tests` job: pytest on all eval tests
- `quality-gate` job: lenient gate on every PR
- `nightly-full-eval` job: manual dispatch with baseline save

## Closed-Loop Failure Feed

```
Production failure trace
        │
        ▼
FailureFeed.record()
        │
        ▼
FailureFeed.promote_to_dataset()
        │
        ▼
golden_dataset.json (grows over time)
        │
        ▼
Stronger CI gate
```

## Adversarial Faithfulness Probe

Per Wallat et al. 2025 (post-rationalization detection):

1. Inject canary chunk: "Root cause was DNS misconfiguration in CoreDNS"
2. Ask unrelated question about resource fragmentation
3. If answer mentions DNS/CoreDNS → FAIL (model used irrelevant canary)
4. If answer refuses or stays on-topic → PASS

## Parameter Tracking

Every eval run logs:
- Dataset name/version/sample count
- Chunking, embedding, retrieval, rerank, context, generation configs
- Judge model, Python version, platform

Enables: "Why did faithfulness drop 0.05 between run A and run B?"

## Failure Modes

| Failure | Mitigation |
|---|---|
| Mean passes but tail fails | P10 percentile gate check |
| Baseline stale after model change | `--save-baseline` on known-good nightly |
| Golden set too small | Failure feed promotion; target 100-200 cases |
| Mock LLM scores don't reflect Ollama | Nightly Ollama eval via workflow_dispatch |
| Adversarial false positives | Tune canary keywords per domain |

## Production Gap

| Local | Production | Upgrade Trigger |
|---|---|---|
| JSON baselines | MLflow/W&B experiment tracking | Multiple engineers running evals |
| Lenient CI gate | Strict gate on merge to main | After golden set ≥50 samples |
| Manual failure promotion | Auto-promote from production traces | After observability layer (Phase 11) |
| Lexical judge | Multi-judge agreement (2+ models) | Before production SLA |
| 5-sample golden set | 100-200 production-sampled cases | Before strict gate |

## Run Commands

```bash
# Full evaluation report
PYTHONPATH=rag-platform python scripts/eval/run_full_evaluation.py

# CI quality gate
PYTHONPATH=rag-platform python scripts/eval/run_quality_gate.py --lenient

# Save new baseline
PYTHONPATH=rag-platform python scripts/eval/run_full_evaluation.py --save-baseline

# With real Ollama
PYTHONPATH=rag-platform python scripts/eval/run_full_evaluation.py --use-ollama
```
