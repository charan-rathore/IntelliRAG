# Request-abort SSE closure

Base: main 5ed378484d6aa9fb53ce4c3709d061eacc52e7d1, after #69 and #70.

## Problem and fix

Request abort propagated to the upstream query signal, but the output stream stayed open until the query returned. A stalled provider could therefore leave the response pending. A runner that ignored its signal could also enqueue late tokens, including from a synchronous upstream abort handler.

The request-abort handler now closes the output first, marks sends closed, detaches its request listener, then aborts upstream. Normal completion, client cancellation and generic error redaction remain unchanged. This cannot forcibly stop an upstream provider that ignores AbortSignal; it ensures that the response no longer waits for that provider or emits its later output.

## Reproduction and tests

Actual exported createQuerySseStream, ReadableStream reader and Response consumption, not a mock stream implementation. The controlled runner deliberately stays pending until released, or sends after ignoring cancellation.

- Original source with first two new tests: 2 assertion failures (read times out after request abort; late token arrives).
- An added synchronous abort-handler regression caught the first patch ordering: late token still arrived. Closing output before upstream abort fixes that case.
- Final focused SSE: 10 PASS (5 existing, 5 new).
- Final full RAG suite: 203 PASS.
- Other unchanged partitions from same base: generation 11 PASS, scripts 210 PASS, app/auth 32 PASS. Combined 456 PASS.
- Final typecheck, changed-source lint and production build PASS.

Five new controls cover pending upstream, ignored signal, pre-aborted request, abort-related rejection, and synchronous abort callbacks. Existing controls cover normal completion, client cancellation, request signal propagation and generic error frames.

No dependency, public API, retrieval, semantic scoring, evaluation threshold or permission changes. No live provider or deployed route claim: the route imports this exported stream helper, but the proof here runs the actual helper locally. Related prior cancellation behavior remains covered by sse.test.ts.
