# IntelliRAG

**Ask a source. Know what it actually says.**

[**Try the live source demo**](https://intellirag-live-own-track.vercel.app/) · [See the execution architecture](https://intellirag-live-own-track.vercel.app/architecture.html) · [Watch the real browser walkthrough](https://intellirag-live-own-track.vercel.app/walkthrough) · [Read the measured evaluation](eval/repo-support/README.md)

IntelliRAG is a research-minded source-retrieval and inference-execution console. It starts with a narrow developer-support question: can we recover *all* the source passages needed for a correct technical answer, preserve their exact origin, and refuse to imply that absent facts have been established?

The public browser demo pins a **single README** from [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) to an exact revision. It asks how to change shared configuration while jobs are queued. The user can inspect the retrieved passages and citation path, then explore how the execution made its decision.

The public demo is deliberately honest: without a configured server model, it presents **cited source extracts**, not generated reasoning. It uses ephemeral storage and refuses visitor imports and API keys. This is not persistent, multi-tenant RAG.

## One concrete demo

1. [Open the console](https://intellirag-live-own-track.vercel.app/).
2. Select **Ask this question** on the pinned p-queue example.
3. Inspect the answer or cited extracts; click a citation to inspect the supporting passage. A synthesis of several API behaviors is an inference, not a verbatim source fact.
4. Switch from **Reading** to **Lab** to see available retrieval decisions, evidence diagnostics and graph inspection. The graph is a diagnostic, not proof that a graph algorithm improved the answer.
5. [Open the visual architecture](https://intellirag-live-own-track.vercel.app/architecture.html) for the same workflow, trust boundaries, concrete source files and benchmark limitations.

No new provider keys or external setup are needed to try the pinned public demo.

## What the architecture actually does

~~~text
source revision + corpus
      │
      ▼
ingest → chunk → keyword index (+ optional compatible vectors)
      │
      ▼
query + exact corpus → retrieve → rank → pack within budget
      │
      ▼
evidence gate → extract / model generation when configured
      │
      ▼
cited output + trace → source inspection + feedback
~~~

The cache and orchestration policy must never cross corpus, source revision, request, retrieval-policy, permission or model boundaries where those affect the result. Cache hits are evaluated separately from retrieval quality. The Evidence Core provides immutable source identity, exact spans and claim status, but the original contract alone is **not** a complete response-cache key.

- [Visual live architecture](https://intellirag-live-own-track.vercel.app/architecture.html)
- [Architecture decisions and known failure modes](docs/architecture/web-rag-decisions.md)
- [Evidence Core contract and adapter](web/src/lib/evidence-core/)
- [Web deployment, security posture and production acceptance](WEB.md)
- [Repository-support evaluation and raw data](eval/repo-support/README.md)
- [Security, functionality and operational audit](audit/REPORT.md)

The application lives in [web/](web/), with retrieval implementation in [web/src/lib/rag/](web/src/lib/rag/). The Python [rag-platform/](rag-platform/) remains a separate benchmark/reference implementation, **not** the serving runtime for the public web app.

## Measured result—not a broad superiority claim

On one pinned p-queue README, using a frozen set of 15 answerable questions and an approximate 1,400-token evidence context budget:

| Evidence recovery | Required-evidence recall |
| --- | ---: |
| Earlier document-level deduplication | 36.7% |
| After fixing that deduplication bug | 70.0% |
| Budget-aware passage trimming | **73.3%** |
| Plain BM25 at the same budget | **73.3%** |

The current evidence-retention result **ties** BM25, rather than beating it. The evidence gate refused the five unsupported probes in this diagnostic. No LLM generation ran in this retrieval experiment. Those figures do not establish answer correctness, customer value, multi-repository generalization or cloud-serving latency.

Read the [full methodology, data, before/after runs and limitations](eval/repo-support/README.md). A future retrieval arm must beat the same frozen baseline under the same context budget and report its failures, not merely improve the design story.

## Run it locally

~~~sh
git clone https://github.com/charan-rathore/IntelliRAG.git
cd IntelliRAG/web
npm ci
npm run dev
~~~

Open http://localhost:8080. The pinned source is available without a key.

~~~sh
npm run typecheck
npm run test:hardening
npm run test:persistence
npx --yes tsx --test src/lib/rag/*.test.ts
npm run build
~~~

See [WEB.md](WEB.md) for the Vercel project setup and release gate. In public demo mode the server enforces read-only seeded content. Enabling durable imports, persistent semantic search, private workspaces and provider generation requires independent configuration and security acceptance—not a frontend toggle.

## What we are optimizing

The engineering target is **verified task completion per unit of computation**. That means:

- retrieve the required evidence with as little context and repeated work as possible;
- reuse valid computation only when source versions, question and policy match;
- treat cache invalidation, corpus isolation, refusal and latency as correctness properties;
- compare simple BM25, dense retrieval, hybrids and long-context baselines before adding costly complexity;
- separate model usage from local retrieval measurements and publish losing experiments.

The first customer hypothesis is a developer-tool support team answering configuration and troubleshooting questions. The proposed [human-reviewed pilot](docs/sales/repository-support-pilot.md) measures accepted answers, material errors, engineer review time and actual cost per resolved case. No proven customer ROI or production semantic-search advantage is claimed.

## Limits

The current public host has no configured durable production vector index or server generation key. Its keyword/extractive mode is inspectable but does not demonstrate production semantic RAG. The graph contains document/heading/shared-term connections and feedback; it is not verified semantic entity extraction. The evaluation is small and single-source. The original web template's entire inherited test suite has legacy failures distinct from the focused RAG gates; do not claim all tests are green until verified.

The goal is to improve the execution architecture through measured failures—not enlarge the agent surface without need.
