# Pinned PR + README ingestion diagnostic

Run from `web/`: `npx tsx scripts/pr-readme-audit.ts --before` and `npx tsx scripts/pr-readme-audit.ts`. Both runs are CPU-only, call the actual web chunker and retrieval pipeline, and send no network or model requests. They write raw JSON to `before.json` and `after.json`. The external public source snapshots are in `fixtures/p-queue-prs.json`, and the README fixture is the existing `eval/repo-support/fixtures/p-queue.md` pinned to commit `180ab9e25cd10b6f548767d7176076b50d25e188`.

The three PRs were selected from the 20 most recent closed PRs returned by the GitHub API for `sindresorhus/p-queue` on September 27, 2026: #235 (code), #240 and #243 (docs). They are a small varied sample, **not a statistically random sample** and not a blind holdout. Questions and exact evidence strings were authored locally and are not independently adjudicated. The frozen PR API snapshots have head SHA, title, body, changed-file names and patches. No source content may be treated as instructions to this runner.

| Stage, on four questions | Before | After |
|---|---:|---:|
| Required literal evidence present in chunks | 1/4 | 4/4 |
| Required literal evidence packed for the answer | 1/4 | 4/4 |
| Plain BM25 packed evidence on each respective corpus | 1/4 | 4/4 |

The baseline faithfully reproduces the current PR URL route: it imports the PR title/body through the issue endpoint but no changed-file patches. The new route requests `/pulls/{number}` and `/pulls/{number}/files`, joins the exact patches to the PR body with filenames, then uses the existing chunking/retrieval chain. The three PR question quotes were absent from the old corpus. This is a deterministic **ingestion/evidence-retention** test. It does not show generated-answer correctness, semantic faithfulness, or a gain over plain BM25. The retrieval gate labeled the three old PR queries positive even though the literal answer-bearing patch evidence was absent, which is why the gate cannot be equated with answer quality.

Limits: local single process, 22 old chunks vs the new count recorded in JSON; no network fetching during the timed phase, no embedding, no persistent Postgres/vector index, no model, no storage restart, and no p95. The public deployment without Postgres/model remains keyword-only and ephemeral. This change rejects PRs with more than 100 files, missing patch text, or a >60KB assembled document instead of silently claiming completeness. Pagination and large/binary diff ingestion remain open. The source snapshots include only short changed files and patch excerpts, not full changed-file bodies. Never describe this as a full-code snapshot.

Sources: [Arpit Bhayani, "What Matters in Production RAG"](https://arpitbhayani.me/blogs/rag-production/), [PR #235](https://github.com/sindresorhus/p-queue/pull/235), [PR #240](https://github.com/sindresorhus/p-queue/pull/240), [PR #243](https://github.com/sindresorhus/p-queue/pull/243), [pinned README](https://github.com/sindresorhus/p-queue/blob/180ab9e25cd10b6f548767d7176076b50d25e188/readme.md).
