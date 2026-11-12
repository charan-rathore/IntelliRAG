import { createFileRoute } from "@tanstack/react-router";
import {
  hydrateKeysFromRequest,
  keyStatus,
  labKeySetCookieHeaders,
  setMemoryKeys,
} from "@/lib/rag/keys.server";
import { currentPosture } from "@/lib/rag/deployment-posture.server";
import { DemoModeRefusal } from "@/lib/rag/deployment-mode";

function jsonWithKeyCookies(body: unknown, status = 200) {
  const headers = new Headers({ "content-type": "application/json", "Cache-Control": "no-store" });
  for (const line of labKeySetCookieHeaders()) headers.append("Set-Cookie", line);
  return new Response(JSON.stringify(body), { status, headers });
}

export const Route = createFileRoute("/api/keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        hydrateKeysFromRequest(request);
        return Response.json(keyStatus(), { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        hydrateKeysFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as {
          gemini?: string;
          openrouter?: string;
          clearGemini?: boolean;
          clearOpenRouter?: boolean;
        };
        const gemini = typeof body.gemini === "string" ? body.gemini.slice(0, 2000) : undefined;
        const openrouter =
          typeof body.openrouter === "string" ? body.openrouter.slice(0, 2000) : undefined;
        // Clearing is always allowed; accepting a visitor's secret is not, on a demo host.
        if ((gemini?.trim() || openrouter?.trim()) && !currentPosture().visitorKeys) {
          const refusal = new DemoModeRefusal("Adding a model key");
          return Response.json(
            { error: refusal.message, code: refusal.code },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        }
        const status = setMemoryKeys({
          gemini,
          openrouter,
          clearGemini: Boolean(body.clearGemini),
          clearOpenRouter: Boolean(body.clearOpenRouter),
        });
        return jsonWithKeyCookies(status);
      },
    },
  },
});
