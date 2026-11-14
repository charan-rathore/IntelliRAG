# STATUS — IntelliRAG audit remediation (work log; local commits only, NOT pushed/merged/deployed)

Clone: GitHub `main` @ ab5baf7 (owner's unpushed Mac changes not included; the separately-tested
local repair was NOT available here → no reconciliation claimed).
Skill URLs (ponytail, grill-me) NOT read — skipped to conserve the limited allowance.

## Commits (in order)
| commit | scope |
|---|---|
| 1560602 | H5/H6 headings own sections; word-boundary overlap; no overlap into a heading-led piece; `chunk.heading` in both BM25 build sites (retrieve-core.ts:48,179) |
| e3137b1 | fix: 1560602 dropped ALL overlap for unspaced text (CJK/emoji); fallback to surrogate-safe char start. New `chunk-section-overlap.test.ts` (7 tests) |
| 606d72f | eval-only: `eval/retrieval-chunking/pqueue-eval.ts` (not production) |
Patches: `git format-patch ab5baf7..e3137b1` (production) ; 606d72f separate.

## Runtime / how to test
Repo test script = node:test via `npx tsx --test` (not Vitest). No node_modules + network off here, so I used
node 22 strip-types with a tiny extension-resolve hook (`eval/retrieval-chunking/reg.mjs`):
```
cd web && node --no-warnings --experimental-strip-types --import ../eval/retrieval-chunking/reg.mjs --test src/lib/rag/chunk-section-overlap.test.ts
node --no-warnings --experimental-strip-types --import eval/retrieval-chunking/reg.mjs eval/retrieval-chunking/pqueue-eval.ts $PWD/web/src/lib/rag $PWD/eval/repo-support/fixtures/p-queue.md
```

## Evidence
New tests: ab5baf7 → 1 pass / 6 fail (H5/H6, bleed, repeated headings, spaces/tabs/newlines);
1560602 → unspaced-overlap test FAILS ("unspaced text lost its overlap"); e3137b1 → 7/7 pass.
Existing suites at e3137b1: chunking 28/28, chunk-heading-fences 3/3, chunk-line-endings 3/3,
chunk-buffer-equivalence 1/1, bm25-index-cache 3/3, ranking 16/16.
chunk-unicode-persistence: FAILS on baseline too — env only (`@tanstack/react-start` not installed), not a regression.

p-queue keyword eval (top-5, evidence = answer-bearing text; ab5baf7 vs e3137b1): coverage 6/7 both;
chunks 19 both; index chars 33455 → 31733 (less duplicated overlap); query ~17-19 ms.
Only miss (both): "can i bump how many run at once mid-flight" (top hits .onEmpty/FAQ).
NOTE: fixture has NO body text saying concurrency is settable at runtime — `#### [.concurrency]` is an empty heading.
Honest answer there is "documented as a property; runtime change not explicitly described".

## Tried and reverted (important finding)
Splitting prose at every heading before size-merging (so each p-queue method is its own chunk):
63 chunks, coverage fell 6/7 → 1/7. Today's 6/7 relies on large multi-section chunks (e.g. one chunk holds
onEmpty+onIdle+onPendingZero) — that is the ".onEmpty chunk dominates" symptom. Finer sections need
comparison-aware retrieval first (retrieve evidence for EACH compared item, e.g. split "A vs/and B" into
sub-queries and union top hits, guarded so ordinary "and" queries don't pull unrelated sections).

## Not done / not run
- Comparison sub-query retrieval; 'and'-query noise test; five-runs-per-second answer text check beyond retrieval.
- Dense embedding text (ingest.server.ts:537) still excludes heading — changing it invalidates stored vectors; owner decision.
- Full `npm test`, browser flow, live generation (no deps/network/keys). Injection, durable storage, debug payloads, memoRABLE: untouched.

## Next runnable task
Add comparison-aware retrieval in retrieve-core (test first with pqueue-eval + an ordinary-"and" negative),
then retry heading-level section splitting and re-measure.

## Session 3 (2026-11-14 evening) — PRs + design pass
- PR #113 (this branch): chunking fixes + tests + eval/STATUS. Opened, not merged.
- PR #114 `design/quieter-chrome`: removed faux macOS window dots on demo panels; "Architecture"/"Watch demo" now muted text links. No build/preview run (no deps).
- memoRABLE PR #117 `design/splash-copy-and-entrance`: splash tagline matches "A daily log for engineers"; dropped 6px blur from `hx-rise`. Not built/tested.
- Reviewed live sites in the browser pane (800x600 only; mobile not checked).
- Open design notes (not changed): IntelliRAG header has 8 controls in 4 styles ("Extractive" status pill reads like a button);
  the 3-checkmark trust row under the hero is a stock pattern; sticky composer covers the hero demo on short screens.
  memoRABLE splash plays on every reload (tests depend on it); e2e workbench.spec.ts:62 expects an old heading.
- Next: CI results for #113/#114/#117; then comparison-aware retrieval (see above).
