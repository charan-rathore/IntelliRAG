import { createFileRoute } from "@tanstack/react-router";
import { hydrateKeysFromRequest } from "@/lib/rag/keys.server";
import { loadLastEval, runRagasEval } from "@/lib/rag/eval.server";

export const Route = createFileRoute("/api/eval")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        hydrateKeysFromRequest(request);
        const report = loadLastEval();
        if (!report) return Response.json({ verdict: "none" });
        return Response.json(report);
      },
      POST: async ({ request }) => {
        hydrateKeysFromRequest(request);
        try {
          const report = await runRagasEval();
          return Response.json(report);
        } catch (err) {
          return Response.json(
            { verdict: "error", message: err instanceof Error ? err.message : "Eval failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
