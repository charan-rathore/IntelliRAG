/**
 * Server-Sent Events stream plumbing for the query route.
 *
 * A client that disconnects mid-stream cancels the ReadableStream; without
 * guards the next controller.enqueue / controller.close throws and the
 * upstream query keeps running to completion for nobody. Every write is
 * gated on a closed flag, and both a client cancel and the request's own
 * abort signal stop the upstream work via a linked AbortController.
 */
import type { QueryEvent } from "./query.server";

export type QueryRun = (
  send: (event: QueryEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

export function createQuerySseStream(
  run: QueryRun,
  requestSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  const abort = new AbortController();
  const onRequestAbort = () => abort.abort();
  if (requestSignal) {
    if (requestSignal.aborted) abort.abort();
    else requestSignal.addEventListener("abort", onRequestAbort, { once: true });
  }
  const detach = () => {
    requestSignal?.removeEventListener("abort", onRequestAbort);
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: QueryEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // The client went away between our flag check and the write.
          closed = true;
          abort.abort();
        }
      };
      try {
        await run(send, abort.signal);
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Query failed",
        });
      } finally {
        detach();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // The client cancelled while the final event was in flight.
          }
        }
      }
    },
    cancel() {
      closed = true;
      detach();
      abort.abort();
    },
  });
}
