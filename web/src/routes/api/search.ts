import { createFileRoute } from "@tanstack/react-router";
import { searchCorpus, suggestCorpus } from "@/lib/rag/search.server";

/**
 * GET /api/search?q=…&corpus=…&limit=… — ranked passages with highlighted
 * snippets, operators (path: lang: kind: sym: "phrase" -word) and did-you-mean.
 * GET /api/search?suggest=… — completions for the word being typed.
 */
export const Route = createFileRoute("/api/search")({ server: { handlers: {
  GET: async ({ request }) => {
    const params = new URL(request.url).searchParams;
    const corpus = params.get("corpus");
    const prefix = params.get("suggest");
    if (prefix !== null) return Response.json({ suggestions: await suggestCorpus({ prefix: prefix.slice(0, 200), corpus }) });
    const q = (params.get("q") ?? "").trim().slice(0, 500);
    if (!q) return Response.json({ error: "Pass q, the search text." }, { status: 400 });
    const limit = Math.max(1, Math.min(50, Number(params.get("limit")) || 20));
    return Response.json(await searchCorpus({ q, corpus, limit }), { headers: { "Cache-Control": "no-store" } });
  },
} } });
