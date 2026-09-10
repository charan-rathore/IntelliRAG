import { createFileRoute } from "@tanstack/react-router";
import { getSql, vercelWithoutDatabase } from "@/lib/db";
import { getStorageStatus } from "@/lib/rag/storage";
import { keyStatus } from "@/lib/rag/keys.server";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "@/lib/rag/types";
const instanceId = crypto.randomUUID();

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const storage = getStorageStatus();
        const base = {
          instanceId,
          checkedAt: new Date().toISOString(),
          storage,
          embeddingModel: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIMENSIONS,
          ...keyStatus(),
        };
        if (vercelWithoutDatabase())
          return Response.json(
            {
              ...base,
              status: "setup-required",
              databaseReachable: false,
              reason:
                "Configure persistent Postgres before indexing and production acceptance tests.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        try {
          const sql = await getSql();
          const rows = await sql<{
            documents: number;
            chunks: number;
            embedded: number;
            current_model: number;
          }>`select (select count(*)::int from documents) as documents, count(*)::int as chunks, count(embedding)::int as embedded, count(*) filter (where embedding is not null and embedding_model = ${EMBEDDING_MODEL})::int as current_model from chunks`;
          const migrations = await sql<{
            name: string;
          }>`select name from _migrations order by name`;
          const dimensions = await sql<{
            dimension: number;
            count: number;
          }>`select jsonb_array_length(embedding::jsonb) as dimension, count(*)::int as count from chunks where embedding is not null group by 1`;
          const fingerprint = await sql<{
            hash: string;
          }>`select md5(coalesce(string_agg(id || ':' || content_hash || ':' || coalesce(embedding_model,'') || ':' || md5(coalesce(embedding,'')), ',' order by id),'')) as hash from chunks`;
          const counts = rows[0];
          const vectorsReady =
            counts.chunks > 0 &&
            counts.chunks === counts.current_model &&
            dimensions.every((d) => d.dimension === EMBEDDING_DIMENSIONS);
          return Response.json(
            {
              ...base,
              status: vectorsReady ? "index-ready" : "index-incomplete",
              databaseReachable: true,
              indexFingerprint: fingerprint[0].hash,
              counts,
              storedDimensions: dimensions,
              migrations: migrations.map((m) => m.name),
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            {
              ...base,
              status: "database-error",
              databaseReachable: false,
              reason: "Check database connectivity and applied migrations.",
            },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
