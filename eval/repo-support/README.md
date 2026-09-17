# Repository support evaluation

**Measured retrieval diagnostic; cloud answer evaluation pending credentials.** This is a first-party diagnostic for developer-support decisions. It is not a Ragas, RAGBench or CRAG leaderboard result.

## Reproduce

From `web/`, run `npx tsx scripts/repo-support-eval.ts`. This executes the actual web chunker, BM25, calibrated reranker, context packer and evidence gate against the checked-in, MIT-licensed p-queue README. No network or model is used for retrieval measurements. `--distractors` additionally mixes in the app’s seed documents as an explicitly artificial noise stress test.

The corpus is **one README**, pinned to `180ab9e25cd10b6f548767d7176076b50d25e188`. `dataset.json` contains 20 scenarios: 15 answerable decisions and 5 unsupported/adversarial questions. Each answerable case includes expected decisions and exact source anchors with offsets and line numbers. Validate the annotation against the source before treating it as gold. Current annotations are authored by the project, not independently adjudicated.

The first eight cases are marked development and the remaining twelve evaluation. Both splits are now inspected: these are **exploratory diagnostic results, not a blind held-out test**. Future tuning requires a new locked holdout, preferably split by repository and version, not merely by paraphrase.

## What actually happened

![Evidence retention by method and question](retrieval-results.svg)

| Method | Mean required-evidence recall | All required anchors retained |
|---|---:|---:|
| Plain BM25 with token budget | 73.3% | 10 / 15 |
| IntelliRAG before passage fix | 36.7% | 4 / 15 |
| IntelliRAG after passage fix | 70.0% | 9 / 15 |

The old packer treated two passages from one file as duplicate evidence. The fix deduplicates repeated passage text instead. It improves five questions without changing their source, question, or annotation. It does **not** establish superiority over BM25. The paired mean gain over the old implementation is 33.3 percentage points; a seeded, 10,000-resample question bootstrap gives [13.3, 60.0] points. Questions from one README are correlated, so this interval is descriptive and does not establish cross-repository generalization.

Before: [`15:15` raw results](runs/2026-09-16T15-15-18-135Z/results.json). After: [`15:18` raw results](runs/2026-09-16T15-18-44-879Z/results.json). The earlier `15:11` run is an exploratory mixed-corpus noise test and is not included in this comparison. All artifacts retain candidates, selected text, decisions and timings. There were **no model answers in these runs**.

![Local stage timings](stage-latency.svg)

Stage timings are a single local CPU pass. They exclude persistence, network, embedding and LLM work; they are not deployment latency. Chart generation: `python plot_results.py BEFORE/results.json AFTER/results.json`, with Matplotlib and NumPy installed. The generator asserts identical datasets and corpus conditions.

## Why these metrics

| Question | Measurement | Limitation |
|---|---|---|
| Did chunking preserve the needed fact? | Evidence anchors present in any chunk; inspect oracle coverage. | One annotated wording may have equivalent evidence elsewhere. |
| Did retrieval preserve all needed facts? | Anchor recall, complete-evidence rate, first relevant rank, precision of selected chunks. | Deterministic span matching is a diagnostic proxy, not semantic correctness. |
| Did reranking/packing discard useful context? | Compare baseline, candidates and final context with the same budget. | The plain baseline and calibrated pipeline have different selection rules; this is an end-to-end selection comparison. |
| Did the answer make the right decision? | Required-claim checks, harmful-contradiction flag, human review. | Pending model generation; no score is imputed. |
| Does the answer follow the supplied evidence? | Atomic supported claims divided by verifiable claims; citation entailment separately. | A judge needs calibration against people; valid citation IDs alone are insufficient. |
| Does the system admit uncertainty? | Refusal precision/recall and unsupported-answer rate. | The retrieval gate alone refused 1 of 5 unknown probes; that is not end-to-end refusal accuracy. |
| Is it operationally useful? | Error rate, actual token/cost usage, p50/p95 latency, time to first token, source freshness and cache invalidation. | Only local retrieval stage time is measured here. Missing stages remain missing. |

## Cloud protocol

Put `OPENROUTER_API_KEY` in the gitignored `web/.env.local`; never in a dataset or report. Supply an explicit `EVAL_MAX_USD` budget. From `web/`:

```sh
EVAL_MAX_USD=5 node --env-file=.env.local --import tsx scripts/repo-support-eval.ts --generate
```

The default model is `google/gemini-3.7-flash`, verified against OpenRouter’s live catalog before requests. Resume an interrupted run with the same `EVAL_OUTPUT` and `--resume`. The runner checks dataset, code and model identity, retains completed answers, and carries forward spent or reserved costs. A write-ahead reservation prevents a timeout or process interruption from silently resetting the spending ledger.

The runner records catalog metadata, returned model/provider, request ID, actual usage, failure state and estimated/reserved costs where provider cost is unavailable. It does not silently substitute a different model. Generation uses temperature 0, seed 42, a 4,096-token output cap and low reasoning effort. Provider determinism is not guaranteed.

Five paired arms: **no context; plain BM25 context; IntelliRAG-selected context; oracle evidence; full README**. Arm order rotates by question. The first two retrieval arms share the same source, question and approximate 1,400-token context budget. Oracle and full-context arms are diagnostic upper-bound comparisons and may use more tokens; report their cost alongside quality. No-context prompts omit grounding instructions because no sources exist; do not describe the prompts as identical.

This runner isolates the actual retrieval components and uses a controlled common generation prompt. It bypasses the HTTP transport, persistent index and graph feedback/cache. It is **not** a measurement of the complete deployed app. Pair it with `web/scripts/verify-workspace.mjs` and real `/api/query` traces; use `skipCache: true` for quality runs, and record `actualMode` to detect keyword fallback. Dense/hybrid and graph ablations require a separately measured, fully embedded corpus.

Do not score missing responses as correct. Preserve timeouts and malformed judge responses. Report both attempted-count accuracy (failures count against completion) and quality conditional on successful responses. Keep cached repeats separate. Three independent repeats are the minimum planned stability check; a single deterministic setting is not evidence of zero variance.

## Research used to design this diagnostic

Reviewed 16 September 2026. These papers inform the protocol; their reported scores are not comparable to the p-queue dataset.

- [Ragas faithfulness documentation](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/): decompose answer statements and check whether context supports them. We keep this separate from reference-answer correctness and exact citation validity. We have not executed the Ragas library.
- [RAGBench, 2024](https://arxiv.org/abs/2407.11005): evaluate retrieval-augmented answers with explainable dimensions. Our dataset makes expected decisions and supporting evidence inspectable rather than reporting one opaque score.
- [RAGChecker, 2024](https://arxiv.org/abs/2408.08067): use fine-grained retrieval and generation diagnostics to locate failures. This motivated tracking evidence loss before asking an LLM judge to assess an answer.
- [CRAG, 2024](https://arxiv.org/abs/2406.04744): include diverse question difficulty and changing facts. For this use case, missing information and source-version changes matter alongside ordinary configuration questions.
- [Enterprise diagnostic framework, April 2026](https://arxiv.org/abs/2604.02640): reasoning difficulty, retrieval difficulty, document structure and explainability interact. We label scenario types and expose evidence selection, rather than treating every question as equivalent.
- [RAGe, May 2026](https://arxiv.org/abs/2605.27445): connect pipeline quality with resource telemetry. We retain stage timing and plan actual token/cost reporting so a quality gain cannot conceal an impractical operating cost.
- [URAG, March 2026](https://arxiv.org/abs/2603.19281): reliability under retrieval noise needs its own evaluation. Our unknown and injected-premise probes diagnose that boundary; we do not claim to reproduce URAG’s uncertainty-calibration method.

## What is required before a credible broader improvement claim

1. Add at least two independent repositories with version-sensitive, cross-file questions and realistic support tickets; keep a repository/version holdout unseen during tuning.
2. Have two reviewers verify source sufficiency, required decisions and unanswerability. Record disagreements and adjudication.
3. Run the same generator across all arms, plus a separately configured judge. Blind answer order and audit judge errors against human labels. Same-model judging must be labeled as such.
4. Run explicit dense, hybrid, no-rerank, no-graph and context-budget ablations. Record missing vectors and provider fallback as failed conditions, not passing hybrid measurements.
5. Test fresh process, warm process, cache hit, source update and source deletion separately. Compare latency distributions on identical hardware and network conditions.
6. Publish raw runs, cost, failures, per-category scores and paired uncertainty. Phrase claims around the actual task, population and baseline. Never say “above benchmarks” because one custom demo passed.

## Independent answer review

After a completed generation run, use a different OpenRouter model as a judge and a separate explicit budget:

```sh
EVAL_JUDGE_MODEL=your/chosen-judge EVAL_JUDGE_MAX_USD=5 node --env-file=.env.local scripts/repo-support-judge.mjs ../eval/repo-support/runs/RUN/results.json
```

The judge checks required decisions, atomizes factual claims, and supplies exact evidence quotes. The runner validates the JSON schema, requires every reference decision exactly once, and verifies cited evidence quotes against the supplied contexts. Wrong or malformed judgments are retained as errors. These are provisional custom judge scores, not official Ragas scores or human-adjudicated truth. No-context faithfulness is undefined rather than automatically scored zero. The generation runner also exports `ragas-input.jsonl` with question, response, context and reference fields for a later actual Ragas run.
