import { createFileRoute } from "@tanstack/react-router";
import { hydrateKeysFromRequest, keyStatus } from "@/lib/rag/keys.server";
import { embedPendingBatch, ingestFromUrl } from "@/lib/rag/ingest.server";
import { deleteDocument, listCorpora, listDocuments, pendingEmbeddingCount } from "@/lib/rag/store.server";
import { getStorageStatus } from "@/lib/rag/storage";
import { EMBEDDING_MODEL } from "@/lib/rag/types";

export const Route = createFileRoute("/api/lab")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        hydrateKeysFromRequest(request);
        const documents = await listDocuments();
        const pendingEmbeddings = await pendingEmbeddingCount(EMBEDDING_MODEL);
        const corpora = await listCorpora();
        return Response.json({
          documents,
          pendingEmbeddings,
          corpora,
          storage: getStorageStatus(),
          ...keyStatus(),
        });
      },
      POST: async ({ request }) => {
        hydrateKeysFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
          url?: string;
        };
        if (body.action === "embed") {
          try {
            const result = await embedPendingBatch();
            return Response.json(result);
          } catch (err) {
            return Response.json(
              { error: err instanceof Error ? err.message : "embed failed" },
              { status: 500 },
            );
          }
        }
        if (body.action === "ingest" && body.url) {
          try {
            const result = await ingestFromUrl(body.url);
            return Response.json(result);
          } catch (err) {
            return Response.json(
              { error: err instanceof Error ? err.message : "ingest failed" },
              { status: 500 },
            );
          }
        }
        if (body.action === "purge-empty") {
          const documents = await listDocuments();
          let removed = 0;
          for (const doc of documents) {
            if (doc.chunkCount === 0) {
              await deleteDocument(doc.id);
              removed += 1;
            }
          }
          return Response.json({ removed });
        }
        return Response.json({ error: "unknown action" }, { status: 400 });
      },
    },
  },
});
