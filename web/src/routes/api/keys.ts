import { createFileRoute } from "@tanstack/react-router";
import {
  hydrateKeysFromRequest,
  keyStatus,
  labKeySetCookieHeaders,
  setMemoryKeys,
} from "@/lib/rag/keys.server";

function jsonWithKeyCookies(body: unknown, status = 200) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const line of labKeySetCookieHeaders()) headers.append("Set-Cookie", line);
  return new Response(JSON.stringify(body), { status, headers });
}

export const Route = createFileRoute("/api/keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        hydrateKeysFromRequest(request);
        return jsonWithKeyCookies(keyStatus());
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
