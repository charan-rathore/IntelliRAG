# IntelliRAG: visible-browser and implementation audit

Audit dates: 9–10 September 2026. Baseline: `e7b4178e18686251716eb462afb27284e3bb3691`, served at https://intellirag-live-own-track.vercel.app/. Tests used a headed Brave browser on Charan's Mac, actual form submissions and chat messages. Source-level regression tests supplement the browser tests; they are not substitutes for model evaluation.

## Verdict

The baseline is a useful **keyword retrieval / cited-excerpt demo**, not a verified production RAG system. Production reports ephemeral storage and no embedding/model provider. Imports disappeared between requests. Dense embeddings, persistent vector indexing, model-generated answers and real judge evaluations were therefore **not exercised**. No RAGAS faithfulness score is claimed.

The hardening changes fix reproducible ingestion, key isolation, cache identity, graph lifecycle and evaluation-reporting bugs. They do not solve distributed persistence, tenant isolation, semantic graph extraction or model quality. Those remain release blockers for a public, user-funded ingestion service.

## What was actually done

1. Used suggested Redis and Kubernetes questions and the weather-refusal example first.
2. Submitted the 20 existing golden questions, five adversarial questions and six additional cache/false-premise questions through the chat composer. Results: `live-queries.json` (31 cases). The golden cases returned extractive, cited responses; five generic adversarial cases refused. This is not a 100% answer-quality result: some excerpts omit facts or include distractors.
3. Pasted the fictional Lyra runbook via Title / Paste markdown / Chunk & store. It contains exact facts: retry budget **7**, lead **Asha Rao**, persistent ledger **PostgreSQL**, transient cache **Redis**, retention **45 days**, and “Never delete the audit ledger.” The first import created one chunk.
4. Submitted https://github.com/charan-rathore/IntelliRAG/issues/2 through Fetch & index. The baseline imported **22 repository files**, not the issue. Total documents rose from 18 to 40. The issue actually contains deployment cleanup instructions and one comment. Its old deployment advice is treated as test content, not as authorization to change projects.
5. Asked six issue-specific questions. The baseline refused all six, including two answerable questions (duplicate repository name and Root Directory). Results: `intellirag-audit-issue.json`.
6. Selected the Lyra corpus and asked six exact-fact/false-premise questions. During this phase the imports disappeared and the UI returned to **17 seed documents / Seed lab**. The responses cited SRE/Git/Linux/Redis seeds, not Lyra. Results: `intellirag-audit-lyra.json`. These are evidence of missing persistence and misleading context switching, not a valid isolated-Lyra quality benchmark.
7. In the corrected local app, the same issue URL imported **one issue document**, including its comment. Repeated the same six questions: both straightforward answers are present in the cited excerpt; invented credentials are refused; the false-crash and delete-everything prompts do not cause fabricated instructions, but mostly return a long excerpt instead of a direct correction. `intellirag-local-issue.json` captures this behavior. A later wording fix makes lexical absence explicitly limited to retrieved passages instead of claiming whole-document absence.
8. Ran graph identity, traversal, scaling and persistence-lifecycle regressions against the actual implementation. Ran the existing RAG regression suite (41 pass) and eight hardening tests (8 pass). The full inherited `npm test` command fails in unrelated app-builder/template fixtures, including missing `.grok/skills/og` files, template branding assumptions and app-env expectations. These failures are not hidden or relabelled as a passing full suite.

## Observed failures and recommended fixes

“Fixed” below means implemented in the hardening branch and regression-checked. Consult `deployment.json` for the commit and deployment state; browser baseline artifacts intentionally retain the old behavior.

| ID | Severity | Error / evidence | Fix and status |
|---|---|---|---|
| R01 | Critical | Production imports vanish; 40 documents became 17. Storage reports `ephemeral`, zero durable vectors. | **Open:** configure a real Postgres `DATABASE_URL`, migrate, then ingest/index. Prove survival across restarts and concurrent instances. Never treat `/tmp` as durable. |
| R02 | Critical | Browser model keys were copied into process-global/disk state; GET `/api/keys` could reissue another visitor's shared key cookies. Source inspection; no real-key exfiltration attempted. | **Fixed:** request-local WeakMap and request cookies; remove shared key-file storage and GET key copying. Concurrent request-isolation regression passes. Rotate any key previously entered into the old version. Server-owned keys still require service-level authorization/rate limits. |
| R03 | High | `/issues/2` falls through to repository-root ingestion and imports 22 unrelated code files. | **Fixed:** distinguish issue/PR URLs; fetch issue body and comments, preserve source URLs; reject unsupported paths. Corrected browser import produces one issue document. |
| R04 | High | Missing/expired selected corpus can leave visitors looking at seed answers after import loss. | **Open:** persist corpus selection explicitly, reject unavailable corpus IDs, show a blocking “source unavailable” state, and require explicit user selection before switching. Durable storage is the primary fix. |
| R05 | High | Query cache normalization drops negation and numeric facts; “use” vs “not use”, 7 vs 9 can collide. | **Fixed:** exact normalized text preserves punctuation, numbers, negation and order; scope by corpus. No fuzzy reuse of final answers. |
| R06 | High | Feedback identifies questions without corpus scope; corrections overwrite answer text while keeping prior citations. | **Fixed:** scope memory, query-node identity, feedback and hit counters by corpus; corrected answers are invalidated, never treated as source evidence. Tenant isolation is still open. |
| R07 | High | Ingested documents were missing from the graph; answers could create dangling `answered_from` edges; deletes/edits left stale cache entries. | **Fixed:** compare source/version fingerprint, rebuild from current documents, invalidate cache and revision-dependent feedback. Integration regression checks add/edit/delete, corpus-specific feedback and zero dangling edges. |
| R08 | High | Extractive answers never write graph memory/cache, so repeat questions and Useful feedback do little in the actual live mode. | **Fixed:** record extractive results; evaluation `skipCache` avoids reads and writes. Refusals remain explicitly represented. |
| R09 | High | Graph storage is a process singleton plus one whole JSON row (`id='default'`), read once. Concurrent instances can overwrite each other's work. SQL failures are swallowed. | **Partly fixed:** await writes. **Open:** normalized/versioned node, edge and memory tables; atomic updates or revision/CAS; tenant keys; surface write failures; retry/observability. |
| R10 | High | Whole vector table is scanned in JS; JSON vectors do not provide an ANN index. | **Open:** use pgvector with appropriate HNSW/IVFFlat indexing; verify dimensions, corpus filters and recall against brute force; report query plan and p50/p95 latency at realistic scale. |
| R11 | High | Chunk replacement deletes then inserts without a transactional staging/swap boundary. A failed ingest can erase working evidence. | **Improved:** document metadata and chunk replacement now share a real SQL transaction; a PGLite integration test injects a write failure and verifies complete rollback plus successful retry. Same-slug writes serialize with transaction advisory locks. **Open:** immutable staged revisions including embeddings, resumable jobs, and concurrent production load verification. |
| R12 | High | Arbitrary URL ingestion lacks private-network / redirect destination safeguards; response text is read before truncation. | **Open:** constrain supported source providers or validate resolved addresses at each hop; bound streaming bytes, redirects, time and file counts. Add SSRF regression cases before enabling unrestricted public ingestion. |
| R13 | High | Shared public mutation, ingestion, embedding and evaluation endpoints lack adequate per-user/corpus authorization and durable cost limits. | **Open:** authenticated workspaces, ownership checks, quotas, durable rate limiting, provider spend ceilings and audit trails. Do not place a broadly funded model key behind the current unauthenticated surface. |
| R14 | High | “RAGAS” is a custom TypeScript judge rubric, not an execution of the official RAGAS library. Judge failures could silently use lexical fallback and pass. | **Fixed reporting:** call it RAG evaluation / RAGAS-style rubric; invalid/missing judge output fails the run; durable storage required. **Open:** run official RAGAS if that name is a product claim, pin evaluator/model versions and publish actual results. |
| R15 | High | Citation precision checks source existence, not claim entailment. A phrase appearing in context does not establish that the answer is supported. | **Open:** decompose answer claims; evaluate each claim against cited spans; distinguish citation validity, precision, recall and faithfulness. Human-review a stratified sample. |
| R16 | High | Retrieval “recall” acts like any matching document, not multi-document coverage; simple adversarial refusal checks can over-credit answers. | **Open:** specify relevance sets and required fact sets, recall@k/MRR/nDCG, answerable vs unanswerable classification, paired adversarial cases and calibrated abstention. |
| R17 | High | Evaluation is a long serial HTTP job; reports are local filesystem artifacts, not durable experiment records. | **Open:** durable background jobs, cancellation/budgets, persisted run IDs, index/corpus hashes, provider/model/prompt versions, raw samples, error counts and confidence intervals. |
| R18 | Medium | Fixed 480-character excerpts cut off answer-bearing sections (numeric facts and incident resolution). | **Improved:** retain up to 1,800 characters. **Open:** select query-relevant contiguous spans with exact provenance; short direct answers need a configured model and evidence checks. Longer clipping alone is not a semantic solution. |
| R19 | High | Topic overlap can mark misleading questions grounded: quantum elephants in a Redis question, unknown passwords in incident questions, incorrect causal/numeric premises. | **Partly fixed:** run negative-evidence handling in extractive mode; limit absence wording to retrieved passages. **Open:** answerability/contradiction detection and explicit “not established” responses; test with a real model. |
| R20 | Medium | GitHub branch names containing `/` are ambiguously parsed; repository ingestion sorts/truncates a bounded file set and skips some failures. | **Open:** resolve refs using GitHub metadata; report every inclusion/exclusion/failure; store commit SHA and manifest; support resumable full-repo indexing with explicit limits. |
| R21 | Medium | GitHub issue comments are capped; incomplete discussion can change the apparent resolution. | **Improved:** fetch up to 100 comments, fail on detected oversize/truncation instead of silently claiming completeness. **Open:** pagination and incremental sync with revision tracking. |
| R22 | Medium | Code-aware chunking is regex-based; it is not AST-aware across supported languages. | **Open:** language-specific parsing, parent/symbol context, overlap rules, stable chunk identity and fixtures for multiline/nested symbols and oversized functions. |
| R23 | Medium | Graph heading IDs collapse repeated headings and non-Latin headings. Technical abbreviations and Arabic disappear under old token rules. | **Fixed:** heading source-line identity and Unicode tokens; preserve SQL/TLS/TTL/API/Go. Language-specific tokenization and single-character language names still need dedicated handling. |
| R24 | Medium | Preferred sources leaked into unrelated graph queries; BFS repeatedly scanned all edges and only truncated at the end. | **Fixed:** remove unrelated global preference append; adjacency lookup and enforce node budget during traversal. Semantic relevance and corpus-aware graph neighborhoods still need evaluation. |
| R25 | Medium | Graph query nodes grow even when memory/cache have retention limits. | **Fixed:** prune query nodes and orphaned links to retained memory; cap memory/cache. **Open:** database retention jobs and production payload budgets. |
| R26 | Medium | Graph UI only takes the first 28 document/term nodes; once documents dominate, edges can appear empty. Hover-only inspection excludes keyboard/touch. | **Improved:** search documents, include connected term nodes, disclose subset size, keyboard/focus/tap inspection. Still a bounded overview, not a full graph explorer. |
| R27 | Medium | Graph “communities” are per-document indices; shared-word edges are inferred lexical relations, not proven semantic connections or detected communities. | **Open architecture:** choose whether this is a lexical provenance graph or entity/relation graph. For semantic GraphRAG, extract typed entities/relations with cited spans, deduplicate aliases, score relation precision/recall and benchmark multi-hop queries. UI now explicitly calls it lexical. |
| R28 | Medium | Graph snapshots send the whole graph and repeatedly serialize/rebuild it; version check is per request. | **Open:** incremental extraction, paginated/subgraph APIs, indexed adjacency, explicit invalidation events and payload/cache budgets. |
| R29 | Medium | UI sample traces and capability text can sound like live hybrid/LLM measurements while production is keyword-only. | **Open:** derive every capability badge from actual trace/runtime, label illustrative examples distinctly and avoid implied embedding/model execution. |
| R30 | Medium | The monorepo contains inherited app-builder tests referencing missing fixtures and unrelated branding contracts. Full `npm test` fails before RAG tests run. | **Open:** move template tooling to its own package or restore its fixtures; run product test suites independently in CI without suppressing failures. RAG tests were run separately and pass. |

## Graph measurements and what they mean

Baseline seed graph: **260 nodes, 490 edges, 91,812 JSON bytes, zero dangling edges** before imported-answer paths. Old cache collision tests returned true for both negation and numbers. Repeated/non-Latin heading example collapsed to three nodes instead of five. Technical abbreviations and Arabic produced empty token lists.

After extraction fixes: **304 nodes, 688 edges, 116,064 bytes**, preserving more terms. Larger is not automatically more accurate or more efficient.

Synthetic traversal measurements on this Mac (single diagnostic samples, CPU/load uncontrolled):

| Synthetic documents | Nodes / edges | Before | After |
|---:|---:|---:|---:|
| 100 | 210 / 1,100 | 53.1 ms | 6.6 ms |
| 1,000 | 2,010 / 11,000 | 639.6 ms | 59.9 ms |
| 5,000 | 10,010 / 55,000 | 6,298.3 ms | 192.5 ms |

The algorithm change explains the improvement: adjacency traversal replaces repeated edge scans and respects the 24-node budget. These are not production p95 numbers, retrieval-quality scores, storage-efficiency measurements or proof of semantic correctness. See `graph-results.json` / `graph-after.json` and `graph-tests.cjs`.

## Required follow-through for a defensible production study

The audit follows the production concerns in [Arpit Bhayani's production RAG article](https://arpitbhayani.me/blogs/rag-production/): durable ingestion, source changes, evaluation, retrieval observability and failure handling. The findings and measurements above are from this implementation, not borrowed benchmark claims.

1. Configure credentials privately in Vercel: Postgres, embedding provider and generation/evaluation provider. Never paste keys into chat. Rebuild vectors using the same model/dimensions used for queries.
2. Ingest a fixed, versioned set of real issue discussions, code files, runbooks and deliberately conflicting revisions. Store expected answers, required cited spans, source timestamps, access scopes and unanswerable labels.
3. Test duplicate ingestion, source edits/deletes, partial failures, worker restarts and concurrent imports. Assert document/chunk/vector cardinality and no stale source/citation reuse.
4. Compare keyword, dense and hybrid on the same frozen dataset; measure retrieval and answer metrics separately. Add graph-on/off ablation to establish whether graph expansion actually helps.
5. Include exact numbers, negation, abbreviations, multilingual questions, outdated issue comments, cross-document synthesis, conflicting facts, missing secrets, and prompt injection inside both questions and imported sources.
6. Persist real provider traces, costs, latency distributions, judge disagreements and human verdicts. Publish failures as well as averages. Do not advertise the custom judge as official RAGAS.

## Repository consolidation

The originally deployed live commit already belongs to `charan-rathore/IntelliRAG` (canonical repository). The duplicate GitHub repository `charan-rathore/intellirag-web` was permanently deleted as requested after a full mirror backup and successful `git fsck --full`. Backup: `/Users/charanrathore/Downloads/intellirag-web-retirement-backup.git`. No unrelated Vercel projects were deleted. Keep the canonical original as the sole source of ongoing changes.

## Production verification after deployment

Vercel marked canonical commit `0ef8f69279bfd3603f67716f597515b1b9c17b44` READY at deployment `dpl_3EeYpJm3DrcMo3Q59aDHG17TihiP`. Opened the public URL in Brave, pasted the same GitHub issue URL, and clicked Fetch & index. **One issue document / one keyword chunk** was indexed, bringing the corpus to 18 documents, with the issue corpus selected automatically. Repeated all six issue questions on production; the results match the corrected local behavior. See `intellirag-production-issue.json`. Easy answers are present in cited excerpts, invented credentials are refused, and misleading premises still need better direct answers. This confirms the ingestion fix on actual Vercel, while persistent storage and model evaluation remain unconfigured.

The production graph showed **332 nodes / 757 edges / 4 cache entries** after the issue tests. Repeating the first question returned `model: graphify-cache`, `cacheHit: true`, one citation, and the correct issue corpus ID. This verifies the scoped cache in the deployed extractive path; cross-instance durability remains unproven without Postgres.


## September 10 completion pass

Added production `/api/health` with explicit setup/index/database states, applied migrations, current-model vector counts/dimensions, worker ID and index fingerprint. Added a frozen production pipeline acceptance runner that records raw responses and refuses to call missing storage/provider configuration a pass. Optional previous-run comparison checks a changed worker and stable persistent index; imported-source cold-start verification remains required.

Evaluation reports now persist in `evaluation_runs` with run ID, dataset hash and index hash. Database report write failures propagate. The custom judge is still not official RAGAS, and no real model result has been fabricated. Embedding/generation requests have deadlines; malformed dimensions, non-finite and zero vectors are rejected. Atomic ingestion rollback was verified against real embedded Postgres. This does not establish Neon connectivity or production durability.

Documentation now points to the current public hostname and canonical repository, with correct root-level Vercel packaging. Product-specific GitHub CI runs build, typecheck, the RAG regressions, security/graph hardening checks and the SQL rollback test. The unrelated inherited template aggregate test limitation remains disclosed.

Live verification exposed another graph-quality issue: short connector words (`is`, `to`, `as`, etc.) became shared-term hubs after abbreviations were enabled. The extractor now filters those words while retaining API/TLS/Go; a regression checks the distinction. An extractor-version fingerprint forces stored graphs to rebuild after this algorithm change. This reduces lexical noise but is not semantic relation validation. Illustrative onboarding scores are now explicitly labeled as unexecuted examples.


## Additional real upstream issue study

On the public Vercel deployment, entered `https://github.com/brianc/node-postgres/issues/3745` in the URL field and clicked Fetch & index. The importer stored **one issue document with four chunks**, including discussion comments, and automatically selected its own corpus. The graph displayed **358 nodes / 737 edges** after import on the filtered extractor. Frozen issue body: `node-postgres-3745-source.json`; raw six-query results: `intellirag-production-node-postgres.json`.

Three factual questions retrieved the correct cited passage: POC pool `max: 2`, query `id = 7`, and a `WeakMap` for stable statement names without hashing. Extractive mode copied a long passage instead of concise answers. The false `id = 70` premise and injected `max = 200` request returned the real code but did not directly correct the user. The missing production-password question incorrectly labeled unrelated production discussion as grounded. **This was a failed answerability test, not a successful answer.**

Follow-up fixes add a conservative missing-credential-field gate and recognize source/document bypass instructions. Two regressions cover these cases, and the cache policy fingerprint changes so previous unsafe classifications cannot be reused. Credential synonyms, placeholder values, general numeric contradiction detection and concise synthesis still require broader evaluation. Model-based generation and judged answer quality remain blocked by provider/database setup.
