# ADR-001 · Evidence Core: one evidence model under two products

- **Status:** Accepted for implementation (contracts landed; storage migration pending)
- **Date:** 2026-11-12
- **Applies to:** `charan-rathore/IntelliRAG` (web/) and `charan-rathore/memoRABLE`
- **Contract:** `evidence-core/1` — `web/src/lib/evidence-core/contracts.ts` here, `src/evidence-core/contracts.ts` in memoRABLE, byte-identical

## Context

Both products already value provenance over fluency. They encode it differently:

| | memoRABLE | IntelliRAG |
| --- | --- | --- |
| Unit of output | six blocks per document | an answer with citations |
| Where evidence points | `provenance.locator` ("lines 6–9", "blocks[1]") + 240-char excerpt | `Citation.excerptRange`, offsets into the **packed chunk**, not the document |
| Version identity | `contentHash` of the canonical memory document | `documents.version` integer + chunk `content_hash` |
| Ownership | local browser library | one global corpus; graph state in a single `id = 'default'` row |

So a passage cannot yet be named the same way in both products, a brief claim cannot open the passage an answer cites, and nothing is scoped to a workspace. The public IntelliRAG host also stores on ephemeral serverless memory (fixed in PR #104 by refusing to pretend otherwise).

## Decision

Keep two product surfaces. Put one **Evidence Core** underneath them. It owns identity, provenance and trust rules. The products own layout and workflow.

```
┌──────────────────────────── Control plane ────────────────────────────┐
│ auth · workspace · roles · usage budgets · audit · deployment posture │
└───────────────────────────────────┬───────────────────────────────────┘
 memoRABLE UI                       │                        IntelliRAG UI
 brief from one source              ▼                        ask a source / corpus
 local deterministic pass ──► ┌──────────────────────┐ ◄── Product mode
 explicit remote improve      │ Evidence Core         │     Lab mode / evals
                              │ SourceVersion (immut.)│
                              │ EvidenceSpan (exact)  │
                              │ Claim (visible status)│
                              │ AnswerTrace (bound)   │
                              └──────────┬───────────┘
             Postgres + pgvector + object storage ◄─┼─► durable job queue → parse · OCR · embed
                                                    │
                        Provider boundary: model gateway · budgets · retries · traces
```

### Trust boundaries (the Air Agents rule)

Every capability runs where its trust, latency and ownership make sense:

1. **Next to the user:** reading a file, the deterministic first pass, consent to send anything remote, export. memoRABLE's local parser stays local.
2. **Orchestration (server):** retrieval, the evidence gate and answer composition, as **one turn with four typed tools**: `retrieve`, `inspect_span`, `draft`, `request_confirmation`. There is no general agent loop.
3. **Provider boundary:** model calls go through one gateway that holds budgets, retries and per-call traces. Only an explicit, minimal source slice crosses it.
4. **Control planes:** identity, workspace isolation, billing and audit are verified independently of the model loop. They are never UI settings inside the RAG process. `deployment.mode` is the first of these; it is derived from storage facts on the server.

## Contracts (`evidence-core/1`)

| Contract | Minimum fields | Invariant enforced by `validateEvidencePackage` |
| --- | --- | --- |
| `SourceVersion` | workspaceId, sourceId, contentHash (hex SHA-256), parserVersion, storageUri, createdAt, unreadable[] | Immutable. Re-ingestion creates a new version. Unreadable regions are recorded, never dropped. |
| `EvidenceSpan` | sourceVersionId, locator (`lines` / `page` / `offset` / `json-path`), exactText, extractionMethod, confidence | Resolves inside one declared version; carries the source's own characters. |
| `Claim` | workspaceId, sourceVersionId, evidenceSpanIds, type, status, authoredBy | `supported` needs non-OCR, ≥0.8-confidence, not-only-model evidence. OCR → `needs_review`. No evidence → `unsupported`, and only then. |
| `AnswerTrace` | workspaceId, corpusId, sourceVersionIds, policyVersion, modelVersion, citations, outcome, cost, latency, cacheKey | Citations resolve to declared versions. `answered` must cite. `cacheKey = answerCacheKey(trace)`, so a cache can never cross workspace, corpus, version, policy or model. |

`locateExactText()` turns cited text into a document locator. IntelliRAG needs it because chunk offsets are not document offsets. `intellirag-adapter.ts` recovers the source's exact characters from whitespace-collapsed snippets and returns `null` when the source does not contain them. The caller must then render the sentence as unsupported.

**Shared vocabulary without a package.** The contract file has no imports. Both repos vendor it byte-for-byte and test its SHA-256 against `evidence-package.fixture.json`. Changing one copy fails CI until the other matches. The fixture is anchored to the real pinned p-queue README (line 49), and in it a memoRABLE brief claim and an IntelliRAG answer cite the **same** span.

## Ownership and retention

- Every row carries `workspace_id`, derived from the authenticated session and never from request input. Postgres row-level security enforces it.
- Public demo hosts (`deployment.mode = demo`) accept no custom sources and no visitor secrets.
- memoRABLE stays local-first. Workspace sync is opt-in, and a brief exported before sync keeps its `SourceVersion` id, so it can be verified later.

## Migration path

| Step | Change | Done when |
| --- | --- | --- |
| 0 ✅ | Demo truth (IntelliRAG #104) | Public host says *demo*, refuses persistence and keys; the release gate checks it. |
| 1 ✅ | This ADR + `evidence-core/1` contracts + fixtures in both repos | Both products serialize and validate the same package. |
| 2 | Auth + `workspace_id` on documents, chunks, corpora, graph state, cache, traces, feedback; RLS | Two-account test: zero cross-workspace reads, writes or cache hits. |
| 3 | `source_versions` table + object storage. `documents.version` becomes a pointer, not a mutation. | Re-import creates a version; old briefs still resolve. |
| 4 | Durable jobs (parse / OCR / embed) with idempotency keys | A 50-page scan completes async; retries never duplicate chunks. |
| 5 | Emit `EvidencePackage` from both products; render `needs_review` inline | A copied brief claim opens the exact span an answer cites. |
| 6 | pgvector + lexical index in DB; version-aware cache; budget gateway | p95 latency, cost and refusal rate are visible per policy/version. |

## Consequences

- **Freeze:** no new end-to-end RAG work in `rag-platform/` (Python). It remains a benchmark and evaluation asset. The TypeScript web app is the only customer-facing runtime.
- **Not now:** multi-agent orchestration, the graph as a product requirement (it stays a Lab diagnostic), vector-store scale work before tenancy exists.
- **Cost:** two vendored copies of one file. We accept this until a third consumer appears; then publish `@evidence-core/contracts`.

## Revisit when

- A third product needs the contract → extract a package.
- Human eval shows the deterministic gate's false positives/negatives are unacceptable → add a model judge for uncertain cases only.
- A repeated workflow proves it needs multi-step planning with measurable success → reconsider the agent surface.
