/**
 * Which embedding backend the app uses, when dense retrieval is possible at
 * all. A hosted key (Gemini or OpenRouter) always wins; the local bge-small
 * pipeline is the no-key fallback so dense retrieval works without spending
 * or sending text anywhere. Neither means BM25-only.
 */
export type EmbedRoute = "hosted" | "local" | "none";

export function chooseEmbedRoute(hostedAvailable: boolean, localAvailable: boolean): EmbedRoute {
  if (hostedAvailable) return "hosted";
  if (localAvailable) return "local";
  return "none";
}
