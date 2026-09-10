# IntelliRAG live web console

[Open the public lab](https://intellirag-live-own-track.vercel.app/) · [Audit and observed failures](audit/REPORT.md)

The production Vercel project is `intellirag-live-own-track`. Its source is **this repository**, `charan-rathore/IntelliRAG`, branch `main`. The duplicate `intellirag-web` GitHub repository has been retired after a verified mirror backup. Earlier instructions calling the current public hostname SSO-only are obsolete.

## Deploy the existing project

Use the repository root and its checked-in `vercel.json`. It installs/builds `web/` and copies Nitro's Vercel output to the root. Runtime: Node 24. Do not apply an additional `web/` root-directory override to this configuration.

The public app works without provider keys in **ephemeral keyword/extractive mode**. Imported documents and graph memory can disappear across workers. This is not persistent semantic RAG. Check [`/api/health`](https://intellirag-live-own-track.vercel.app/api/health) for the current storage, migration and index state; it exposes no credentials.

## Enable persistent hybrid retrieval

Configure these variables privately in the Vercel project's Production environment:

- `DATABASE_URL`: Neon/Postgres connection string, preferably the provider's pooled endpoint.
- `GEMINI_API_KEY`: provider key for actual `gemini-embedding-2` embeddings and generation. An OpenRouter key can also supply supported models, subject to provider availability.
- Optional `GITHUB_TOKEN`: improves upstream ingestion rate limits.

Keep credentials server-only; never commit them or prefix them with `VITE_`/`NEXT_PUBLIC_`. Redeploy. The build runs `npm run db:migrate`; migration failures fail the build. Migration `0006_evaluation_runs.sql` adds persistent evaluation artifacts. The app seeds documents and supports indexing from its browser console. Run indexing until `/api/health` reports `index-ready`, all chunks use the current model, and stored dimensions are 768.

Document metadata and chunk replacement now commit together. Failed writes roll back; same-slug writers take a transaction advisory lock. Embedding calls have deadlines and reject malformed, non-finite and zero vectors. These protections do not replace a real provider smoke test.

## Frozen production acceptance and cold starts

From `web/`:

```bash
npm run acceptance:production -- https://intellirag-live-own-track.vercel.app ../audit/production-acceptance.json
# After a fresh deployment/worker, without changing the indexed corpus:
npm run acceptance:production -- https://intellirag-live-own-track.vercel.app ../audit/production-acceptance-after-restart.json ../audit/production-acceptance.json
```

The command records a fixture hash, deployment worker ID, index fingerprint and raw query results. It exits with status 2 when setup is incomplete or acceptance fails. It checks real hybrid execution, provider generation and expected cited documents with cache bypass. The optional previous report requires a changed worker ID, unchanged index fingerprint and passing queries in both runs. A warm-worker rerun is not cold-start proof. Use an imported sentinel document too: seeds alone can be reconstructed, so verify the sentinel survives with the same chunk IDs and vectors.

This is a pipeline acceptance check, **not an answer-quality score**. The browser's evaluation action runs the separate custom RAGAS-style judge. Reports now persist in Postgres with a run ID, dataset hash and index hash. Judge failures cannot become lexical passes. This implementation is not the official Python RAGAS library. No real-provider score is claimed while credentials/indexing are absent.

## Verify locally

```bash
cd web
npm ci
npm run dev
npm run typecheck
npm run test:hardening
npm run test:persistence
npx --yes tsx --test src/lib/rag/*.test.ts
npm run build
```

The product CI runs these RAG checks and the production build. The inherited whole-template `npm test` also contains app-builder fixture/branding tests that currently fail independently of the RAG suites; see audit finding R30.

## Remaining architecture limits

The current graph extracts document/heading/shared-term links. It is a lexical provenance graph inspired by Graphify, not verified semantic entity/relation extraction or detected communities. Tests cover imported/edited/deleted nodes, dangling edges, traversal budgets, cache isolation and Unicode headings. Multi-instance graph conflict handling, incremental subgraph storage and semantic relation precision/recall remain open.

Vectors are persisted as JSON text and searched in-process; this is not a pgvector ANN index. A larger corpus needs measured database retrieval/indexing and batching. Public shared mutation/evaluation endpoints also need durable abuse controls and ownership before production team use. See the audit's full finding/fix table rather than treating a successful build as closure of these issues.
