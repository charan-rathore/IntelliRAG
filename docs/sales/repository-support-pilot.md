# Repository support pilot

## The decision we want to improve

A support engineer must answer: “Can I change shared configuration while background jobs are waiting?” The relevant API guarantees exist in different sections. Giving a confident but incomplete answer can lead a customer to wait indefinitely or mutate state while work is still running.

The current p-queue example is a reproducible stand-in for this workflow. It combines pause, running-task completion and queue-idle semantics from a pinned README. The source provides the ingredients. The system must retrieve all of them before a model can explain the decision.

## What the buyer gets first

A reviewer-facing answer draft with the source revision, citations, retrieved passages and a visible uncertainty state. Start with one SDK or developer tool and a small set of support engineers. Keep publication to the customer under human control.

This is a product hypothesis, not a claim of a signed customer, production readiness or proven willingness to pay. Existing developer-documentation support products are reviewed in [the research notes](research-and-pilot.md).

## Ten-day pilot

1. Collect 30 historical tickets with permission. Exclude secrets and identify the documentation version available when each ticket arrived.
2. Two reviewers mark required decisions, evidence and unanswerable details. Resolve disagreements before scoring.
3. Freeze a repository/version holdout. Do not tune prompts or retrieval on it.
4. Compare manual source search, budgeted BM25 plus the same model, and IntelliRAG plus the same model. Randomize the presentation order. Record time to a reviewer-accepted answer, material errors, supported-claim rate, cost and p50/p95 latency.
5. Inspect failures by stage: missing source, lost evidence during chunking, retrieval miss, packing loss, wrong synthesis, unsupported claim or stale cache.
6. Review the economics with the support lead. Calculate observed reviewer minutes saved minus model, hosting and review costs. Report the sample size and uncertainty. Do not turn a small pilot into an industry-wide claim.

## Release gates

- Every published recommendation has reviewer approval and inspectable source evidence.
- Source changes invalidate affected cached answers.
- Private content is isolated by tenant and permission. This is a prerequisite before private customer ingestion, not a feature claimed by the public demo.
- Missing model credentials, vectors or sources are visible states.
- Escalation/contact details absent from the repository remain unanswered.

## Why this scope

It uses the repository ingestion, corpus scoping, citations, graph inspection and evaluation instrumentation already present. It gives the graph a practical role: let a reviewer follow a decision back to evidence. Chat integrations, ticket synchronization and enterprise permission controls are later work, after the pilot shows useful answer quality and time savings.
