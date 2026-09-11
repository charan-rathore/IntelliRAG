import { createFileRoute } from "@tanstack/react-router";
import { hydrateKeysFromRequest } from "@/lib/rag/keys.server";
import { runQueryStream, type QueryEvent } from "@/lib/rag/query.server";
import { z } from "zod";
import { graphEditsSchema } from "@/lib/rag/graphify/edits";

export const Route = createFileRoute("/api/query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        hydrateKeysFromRequest(request);
        const parsed = z.object({
          question: z.string().trim().min(1).max(4000),
          retrievalMode: z.enum(["hybrid", "keyword", "dense"]).optional(),
          topK: z.number().int().min(1).max(20).optional(),
          skipCache: z.boolean().optional(),
          corpus: z.string().max(600).nullable().optional(),
          graphEdits: graphEditsSchema.optional(),
        }).safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid query or graph edits" }, { status: 400 });
        const body = parsed.data;
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
                  graphEdits: body.graphEdits,
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
