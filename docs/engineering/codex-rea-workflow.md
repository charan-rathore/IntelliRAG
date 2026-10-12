# Codex + REA: evidence-driven development playbook

This is an **opt-in development workflow**, not a claim that REA is installed on the developer's machine or that the production app supports native reverse engineering.

## Install on the developer's own computer

Requirements: Codex CLI, npm and Node 22.19+, 24.11+, or 26+. Review the package and setup changes first.

```sh
node --version
codex --version
npx rea-agents@latest setup --client codex --dry-run --json
npx rea-agents@latest setup --client codex
codex mcp list
npx rea-agents@latest doctor --client codex --json
```

Approve only the Codex registration, keep the bundled REA skill enabled, and restart Codex. If installed globally, `rea doctor --client codex --json` works too. The setup pins the REA server version and backs up configuration; repeat a reviewed scoped setup when upgrading. Avoid installing Hopper unless a native binary analysis requires it.

## How to select a tool

- **Own source available:** read files, tests, logs, issues and traces directly first. Do not reverse engineer code you can inspect.
- **Third-party UI behavior or minified JavaScript:** use REA only on software you own or have permission to inspect; preserve URLs, versions and evidence, separate observations from hypotheses. Never clone proprietary source/assets or bypass access controls.
- **Native binary:** use REA with a legally obtained provider, only when needed. No decompiler is required for static JavaScript.
- **Product correctness:** use deterministic tests and evaluation datasets; reverse-engineering evidence is not a substitute for a customer need or measured outcome.

## Codex task contract

Every nontrivial task should follow:

1. **Discover:** read `AGENTS.md`, `README.md`, `ROADMAP.md`, `audit/REPORT.md`, and the narrow relevant code/test paths. Check git status and never overwrite unrelated work.
2. **Scope:** write problem, user impact, failure reproduction, suspected cause, acceptance criteria and out-of-scope items. Ask for explicit approval before secrets, infrastructure charges, production changes or destructive operations.
3. **Investigate:** use the simplest effective evidence. REA is optional, and only for authorized opaque targets. Record versions, concrete observations and unknowns.
4. **Implement:** prefer the smallest reviewable diff; avoid new dependencies when existing libraries suffice. No unnecessary rewrites or cosmetic churn.
5. **Prove:** run targeted tests and production quality commands appropriate to changed code; disclose tests skipped, test failures and environment limitations. Never conflate mock results with live model or durable-store acceptance.
6. **Review:** inspect diff for privacy, authorization, SSRF, prompt injection, tenant mixing, cost amplification, accessibility and rollback concerns. Record effect on baselines.
7. **Deliver:** write a concise change summary, exact commands/results, remaining risks and rollback. Commit only after relevant checks, and do not deploy or merge without permission.
8. **Distill:** append reusable lessons to `docs/engineering/verified-lessons.md` **only after** the issue is reproduced and fix verified. Keep notes factual with a test or commit reference, not guesses.

## Product-release gates

**P0 — safe pilot:** authentication and per-tenant data isolation; URL ingestion/redirect/SSRF restrictions; quotas and cost ceilings; persistent database and source revision identity; no public paid-key exposure.

**P1 — credible value:** 30 permissioned support tickets; two blinded reviewers; frozen versions; a BM25-only baseline; matched generator and context budgets; accepted-answer time, material error rate, citation entailment and reviewer agreement. Publish failures, costs and p50/p95 latency, not just averages.

**P2 — operable product:** audit logs, workspace roles, delete/export policies, disaster recovery, on-call alerting, deployment rollback, graph concurrency, index scalability and contract tests for API changes.

No release gate counts as satisfied merely because a checklist exists. Link exact build, evidence and production verification.

## Sample Codex prompts

**Hardening:**
> Read AGENTS.md, ROADMAP.md and audit/REPORT.md. Select one unresolved P0 finding, reproduce it with the smallest failing regression test, implement a focused fix, rerun applicable tests, and prepare a reviewable diff. No secrets, paid services or production deployment. Clearly label untested claims.

**REA investigation:**
> Investigate only this authorized target: [path/url] and feature: [specific behavior]. First decide whether source/tests already answer the question. If opaque, use REA for evidence with versions and limitations. Document observed behavior versus assumptions, implement the smallest independent equivalent using our own code, and verify with tests. Do not copy protected implementation or assets.

**Evaluation:**
> Freeze the support-question dataset and indexes. Run baseline and candidate under matched conditions. Report recall/precision at k, citation entailment, false-answer and refusal rates, sample sizes, latency/cost and per-case regressions. Never invent provider outputs or label an unavailable judge run as passed.

## Knowledge/agent discipline

Personal tools called “Jeff” or “Instinct” are not required by REA. If they are independently installed, verify their exact provider/API and trust boundaries before connecting. Persistent learning should be a reviewed file and test history, not an unvalidated agent self-editing its own rules. Avoid automatic memory writes from third-party content, and keep credentials/customer data out of notes.
