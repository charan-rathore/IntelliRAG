# Reject incomplete recursive GitHub tree listings

Minimal patch from base `f490ea1`, applied on help-intent branch head `08e3a21`. No subtree SHA identity or ingestion routing change.

- Focused GitHub regression: baseline 1 fail, 6 pass; patched 7 pass.
- Actual exported `ingestFromUrl` entrypoint exercised against tree and subtree URLs with a truncated recursive-tree response. Both reject before fetching any file; exactly two tree requests and no raw-file requests.
- Actual `fetchRemoteDocument` blob URL fallback fetched the individual raw file without a tree request and preserved content.

These are deterministic network-stub integration checks, not a live large-repository import. No database writes or paid provider calls were needed on the rejection path. Full-suite and CI integration gates remain to be run after the separate PGlite isolation fix is qualified.

## Integration after the CI isolation repair

Rebased only this fix onto merged PR #69 (`6ab2c940`). Independent current-head components all pass: generation 11, scripts 210, app-data/auth 32, RAG 198, total 451. This uses the exact npm-test component commands with the external local tsx executable rather than claiming the earlier broken npx wrapper passed. No new serial-concurrency override was used. Typecheck and production build pass; lint has zero errors and existing warnings. GitHub CI and fresh review remain required before merge.
