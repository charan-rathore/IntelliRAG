# STATUS — audit remediation (session 2026-11-14)

Worked from a fresh GitHub clone of `main` (ab5baf7); unpushed local changes on the owner's Mac are NOT included.
Nothing pushed or deployed. No secrets read or printed. No model/API calls made.

## Done (commit: see `git log -1` — "fix(rag): section-aware chunking + heading in BM25")
1. `chunking.ts`: H5/H6 headings now set section ownership (regex `#{1,4}` → `#{1,6}`).
2. `chunking.ts`: overlap no longer begins mid-word (`overlapTail` advances to whitespace).
3. `chunking.ts`: overlap no longer crosses a section — a piece opening with a heading gets no overlap
   (shared `overlapFor`, used by both the text assembly and the table-span analysis so offsets stay consistent).
4. `retrieve-core.ts`: BM25 index text now includes `chunk.heading` (both index sites).

### Evidence (probe, not the vitest suite)
Command (node 22, strip-types; imports rewritten to `.ts` in a temp copy):
`node --experimental-strip-types audit/probe-chunking-sections.mjs <copy>/chunking.ts`
- before: heads `["Guide","Guide > Events"]` (H5/H6 lost), cross-section overlap 1, chunks starting `mma.` (mid-word)
- after:  heads `["Guide","Guide > Concurrency","Guide > Concurrency > Rate limit","Guide > Events"]`, cross-section 0, no mid-word starts

## NOT run / unverified
- Vitest suite NOT run: no `node_modules` and package installs are blocked in this session (network off).
  Existing chunking tests (chunking.test.ts, chunk-*-persistence tests, persistence fingerprints) may need
  snapshot updates because chunk text/headings changed — distinguish regressions vs expected changes.
- The audit's "12 failing tests" were not reproduced (audit/REPORT.md not yet read in full).
- Concurrency queries ("can i bump how many run at once mid-flight", "How do I change concurrency while jobs are queued?",
  onEmpty vs onIdle, rate-limit) NOT yet run against the p-queue corpus.
- Not started: generation/OpenRouter wiring (P1.1), prompt-injection handling + span-verified citations (P1.3),
  durable vectors/imports (P1.4), debug-candidate removal (P1.5), all memoRABLE items (P2).

## Next runnable task
`cd web && npm ci && npx vitest run src/lib/rag` → triage chunking-related failures, then run the p-queue
concurrency queries through `retrieve-core` before/after this commit.
