# IntelliRAG: a focused technical-support pilot

Research date: 15 September 2026. These are public primary-source observations and vendor-published customer accounts, not buyer interviews or independent outcome studies. They establish plausible pain; they do not establish the single biggest problem across YC startups or multinational companies. None of the companies below is an IntelliRAG customer or a validated prospect.

## The first problem to sell

**Help a technical support agent find an answer they can verify, without interrupting an engineer.** Start with developer-facing SaaS/API teams whose documentation and GitHub discussions change frequently. A 20–300 employee company is a recruiting hypothesis, not a verified market boundary. The buyer hypothesis is a support/engineering leader; the daily user is an agent or developer advocate.

The current product fits public GitHub documentation better than enterprise-wide search. Start with one product and one support workflow. Mid-sized multinational support teams are a later interview segment: their role, region, language and permission requirements need separate validation.

## Evidence → product decision

| Observed pain | Public evidence | Decision for IntelliRAG |
|---|---|---|
| Engineers repeat answers already in the docs | [YC's kapa.ai profile](https://www.ycombinator.com/companies/kapa-ai) describes maintainer interruptions and technical support/onboarding from existing sources. | Measure time to a **verified** answer and engineer escalations, not raw chatbot messages. |
| Growing support demand and version-specific mistakes | [Kapa's CircleCI account](https://www.kapa.ai/customer-examples/circleci) describes scaling support without proportional headcount and grounding configuration in actual schemas. | Begin with versioned API/setup questions. Preserve the source, line and cited passage. |
| Repeated internal questions despite existing documentation | [Guru's Branch account](https://www.getguru.com/customers/branch-reduces-slack-questions) describes agents struggling to find documented answers and interrupting leaders. | Interview users inside their existing workflow before investing in a Slack connector. |
| Updates buried across tools; different roles need different context | [Guru's Perk account](https://www.getguru.com/customers/perk-global-customer-care) describes incident/process noise and role/platform-specific answers. It is a larger global-company example, not evidence specific to small firms. | Validate relevance filters and freshness before broad enterprise positioning. Corpus selection alone is not authorization. |
| Indexed knowledge drifts after releases | [Kapa's refresh guidance](https://www.kapa.ai/library/how-to-keep-a-rag-knowledge-base-in-sync-with-changing-docs), updated 2 July 2026, describes change detection, refresh, validation and stale-cache invalidation. | Next engineering priority: observable source revisions, scheduled refresh and rate-limit recovery. Current refresh is import-driven. |
| Users need an accountable way to correct bad knowledge | [Guru verification documentation](https://help.getguru.com/docs/what-is-verifcation) describes human review, expiry and override history. | Keep observed, inferred and manually edited graph connections distinguishable; add an owner review queue before team deployment. |
| Search must respect existing access | [Guru enterprise search](https://www.getguru.com/solutions/ai-enterprise-search) describes inherited source permissions and cited lineage. | Authentication, tenant isolation and source ACL tests are prerequisites for private customer data. |

Kapa, Guru and [Onyx](https://www.ycombinator.com/companies/onyx) already address important parts of this market. An inspectable graph is not a sufficient commercial advantage by itself. The differentiation hypothesis is that a small support team values the ability to inspect and correct the exact evidence path, and can do so faster than in its current workflow. Test that against an incumbent and ordinary documentation search.

## What we have actually tested

- Two previously unseen repository READMEs, `sindresorhus/p-debounce` and `sindresorhus/p-throttle`, were imported locally. Supported answers stayed inside their selected corpus; graph answer edges matched **only** cited source documents; exact repeats reused the cache; unsupported password questions refused without citations. [Machine-readable results](../../audit/graph-provenance-local.json).
- Whole-repository tree requests hit GitHub HTTP 403 during the local audit. Direct README imports passed. This is an ingestion reliability gap, not a successful full-repository test.
- The public browser experiment imports node-postgres issue 3745, produces a cited extract, exposes its source graph, refuses an unrelated question, and reuses the exact cached result. [Capture assertions](../../audit/walkthrough-capture.json), [watch the experiment](https://intellirag-live-own-track.vercel.app/walkthrough).
- The public deployment uses keyword retrieval and cited extracts. Its imports and graph history are temporary without Postgres. Current checks do not establish semantic-model accuracy, production cost savings, tenant isolation, automatic source synchronization or customer ROI.

## A two-week pilot, after setup gates

Use public or explicitly approved non-confidential documentation initially. Agree one workflow, 20–50 documents and 100 real historical questions. Hold back 30 questions from tuning. Label expected evidence, product version and whether an answer exists. Include stale-version, unsupported, ambiguous and cross-corpus questions.

Days 1–2: collect a timed baseline using the team's current search/support process. Days 3–5: import, inspect failures and tune on the training set only. Days 6–8: run a blind, randomized comparison on the holdout set; have two reviewers adjudicate support and citations. Days 9–10: change/delete selected sources, test invalidation and recovery, and deliver a scorecard plus a go/no-go recommendation.

| Measure | Method | Proposed acceptance target, not an achieved result |
|---|---|---|
| Time to verified answer | Median and p95 elapsed time through human source confirmation | At least 30% lower median, with no quality regression |
| Evidence quality | Review every material claim against cited text; report answer coverage separately | At least 95% supported claims; all citation links resolve |
| Unknowns | Score refusal precision and recall on answerable/unanswerable labels | Zero invented answers on the agreed high-risk unknown set |
| Freshness | Update/delete fixtures, re-import, repeat cached questions | Zero stale answers after a successful refresh; log time until refresh |
| Operating cost | Separate embedding, retrieval, generation and cache events | Report actual cost per verified answer; no savings claim before measurement |
| Access control, for a later private pilot | Cross-user, cross-tenant and revoked-access queries | Zero unauthorized evidence exposure; fail closed |

Small samples are directional. Report counts and disagreements; do not turn one passing fixture into a 100% accuracy claim. Cache benefit depends on real repetition and source/settings identity. Graph feedback guides retrieval; user edits do not become documentary facts.

## Order the next increments by buyer risk

1. **Freshness and ingestion:** revision/last-success status, explicit failure and retry, GitHub backoff, incremental refresh, stale-cache regression tests. Preserve the last good index on upstream failures.
2. **Durability and access:** Postgres, authenticated workspaces, inherited source permissions, deletion/revocation checks. Finish these before confidential data.
3. **Useful corrections:** failed-question queue, source owner and review status; distinguish repeated feedback from independent evidence. Measure whether corrections improve held-out answers.
4. **Workflow and economics:** choose one connector from interviews, instrument provider-backed runs, compare actual per-answer cost and p95 latency. Do not add connectors solely for a longer feature list.

## Five short discovery interviews

Recruit two developer-tool support leads, two SaaS support engineers, and one distributed operations lead. Ask for the last concrete incident, not opinions about AI:

1. Show a recent question that needed an engineer. Where was the eventual answer?
2. How long did searching, checking and escalation each take? How often does this repeat?
3. What changed in the docs that made an old answer wrong? Who owns the correction?
4. Which information must different users never see? Which tools are unavoidable?
5. What measurable result would justify a paid pilot, who approves it, and what would make you reject this approach?

Offer a scoped paid pilot only after the workflow, data permissions, acceptance criteria and fee are agreed. Deliver the evaluation set, failure analysis and verified-answer scorecard, even if the result is no-go. No outreach has been sent.
