# Voice Memory local integration

Private development checkpoint, not the finished Bolna submission.

## Run

Clone memoRABLE as a sibling of IntelliRAG, pinned to c5bde3ea41e578aa004af744d8da9403d31506c6. From this directory: `npm ci`, `npm run build`, `npm start`. Open the printed local address. `npm test` runs real engine integration tests; `node --test server.test.mjs` runs HTTP security/session tests. `node browser-check.mjs` checks the UI using installed Google Chrome.

Uses memoRABLE's actual text parser and IntelliRAG's actual chunking, keyword retrieval, evidence gate and extractive output. Original text and hashes are retained separately from memory export. Repeated or transformed chunks that cannot map unambiguously to an original span are excluded. Memory blocks are currently generated but questions retrieve original text, not memory block payloads. No generated semantic synthesis or model calls. Drafts quote evidence and are local downloads, not messages.

Session state is in RAM, cleared on restart or after an hour without requests. Server binds loopback only; host, origin and CSRF checks are required. Do not expose directly to the internet. The small-session implementation is a local prototype, not hardened hosted authentication. No secrets, model credentials or user docs committed.

Bolna microphone/audio transport is not connected yet. No simulated browser speech is passed off as Bolna. Missing evidence refusal, exact-span integrity and proposal/approval wording in original passages are tested; semantic entailment and arbitrary document interpretation are not guaranteed. The full existing app typecheck/test suite has not run for this checkpoint. No public push or deployment is implied.

`voice-adapter.mjs` implements a locally contract-tested OpenAI SSE response with per-bundle short-lived bearer capabilities. It is not wired into the local HTTP server or exposed publicly. `node --test voice-adapter.test.mjs` verifies SSE termination, scope ownership, expiry/revocation, draft command and limits. No actual Bolna SDK session or audio was exercised. Voice responses currently explain the excerpt limitation rather than pretending to speak synthesized insights.

## Quality state

Run `npm run verify` for formatting, focused TypeScript, build, 13 engine tests, 14 HTTP/SSE/synthesis contract tests and a browser journey. This does not replace the full existing app suite. `evaluation/baseline-review.md` records actual baseline failures. The rule-review draft scans all documents and can include unrelated material; it is not the final insight feature. `synthesis.mjs` has no configured provider and its fixture tests prove only the boundary. No actual model quality score exists.

The source dependency is intentionally a sibling checkout at the pinned memoRABLE revision. Do not ship a bundle without reviewing that dependency, licensing, the target deployment's authentication and the documented capability/session limitations. Public hosting, paid inference and Bolna account configuration are separate gated steps.

Next-stage transport and evaluation additions are separate from the independently reviewed foundation. The transport requires explicit credential/model/HTTPS endpoint injection, refuses request/response bounds, and never retries or chooses a fallback. No API key is loaded automatically. An evaluation runner separates development from held-out cases and persists raw failed/reviewable outputs without fabricating semantic scores. Fixture providers are not actual model tests. Read-only account recovery did not establish an inference budget or usable general key; no live model request is enabled by default.

Evaluation safety additions: transport budgets must be positive safe integers within documented code limits. Redirects are forbidden, response bytes are streamed within a bound, and a provider-owned deadline applies even without caller cancellation. Evaluation uses stable case IDs from `evaluation/splits.json`, records logical source/hash/UTF-16 offset packets plus exact credential-free wire body before network, and records the returned envelope/usage before semantic validation. The caller must supply a private durable sink that retains phase records rather than overwriting them. Usage is provider-reported, not billing proof; no scores are assigned automatically. No live model evaluation has run.
