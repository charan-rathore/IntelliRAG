import { createFileRoute } from "@tanstack/react-router";
import { hydrateKeysFromRequest } from "@/lib/rag/keys.server";
import { runQueryStream, type QueryEvent } from "@/lib/rag/query.server";
import type { RetrievalMode } from "@/lib/rag/types";

export const Route = createFileRoute("/api/query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        hydrateKeysFromRequest(request);
        const body = (await request.json()) as {
          question?: string;
          retrievalMode?: RetrievalMode;
          topK?: number;
          skipCache?: boolean;
          corpus?: string | null;
        };
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: QueryEvent) => {
              controller.enqueue(
                encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
              );
            };
            try {
              await runQueryStream(
                {
                  question: body.question ?? "",
                  retrievalMode: body.retrievalMode,
                  topK: body.topK,
                  skipCache: body.skipCache,
                  corpus: body.corpus,
                },
                send,
                request.signal,
              );
            } catch (err) {
              send({
                type: "error",
                message: err instanceof Error ? err.message : "Query failed",
              });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
