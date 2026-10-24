# Document questions containing "help" still retrieve

## Problem and decision

A question such as "Does the Redis runbook help with cache stampedes?" was classified as an app-capability request because the capability pattern matched the word "help" anywhere. That route skips retrieval. Restrict the help-only pattern to a standalone "help" or "help me" request, while keeping existing assistant-meta phrases.

The regression is one test containing two document-question cases. Two new control tests keep standalone help and assistant-meta requests working. No retriever, ranking, cache, corpus, or generation behavior changes.

A redundant quote escape in the existing PWA metadata regex test is also removed so the full lint gate passes. Six boundary inputs produced the same regex matches before and after.

## Local evidence

Environment: Linux x64, Node 22.23.3. Baseline main: `f490ea1a6f37f7bbf7e027925acc2afa09381083`.

- New intent tests against baseline source: 1 failing regression test, 9 passing tests. The two new help/meta control tests passed.
- `npm run test:generation`: 11 passing.
- `node --test 'scripts/**/*.test.mjs'`: 210 passing.
- `node --experimental-strip-types --test src/lib/app-data/app-data.test.ts src/lib/auth/gate-identity.test.ts`: 32 passing.
- `tsx --test --test-force-exit src/lib/rag/*.test.ts`: 196 passing.
- `npm run typecheck`, `npm run build`: pass. Build skipped the external database migration because `DATABASE_URL` was not set; the local PGLite fallback migrates itself.
- `npm run lint`: 0 errors, 11 existing warnings. Baseline had 1 error and 11 warnings; the regex cleanup removes that error.
- Paired `tsx scripts/repo-support-eval.ts`, baseline and patched: all 20 per-question IDs, retrieval metrics, evidence gates, and oracle values identical. No generation requested, no provider cost.

The test commands above are all the components of `npm test`. They were run separately because this environment's global `npx` wrapper cannot unpack its package cache. `tsx` was installed outside the repository for this check; dependency manifests and lockfile are unchanged.

## Limits

The paired evaluation is the repository's single-README local retrieval battery, not a broad answer-quality or production-performance claim. No paid generation, external database, or browser/UI evaluation was performed. Deployment and live smoke checks remain separate gates after merge.
