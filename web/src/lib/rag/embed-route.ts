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

/**
 * Resolves the route for a live operation. The local probe is a callback so
 * a hosted key short-circuits WITHOUT probing: probing loads the model
 * pipeline (tens of MB on first use), and a hosted deployment must never
 * pay that just to choose.
 */
export async function resolveEmbedRoute(
  hostedAvailable: boolean,
  probeLocal: () => Promise<boolean>,
): Promise<EmbedRoute> {
  if (hostedAvailable) return "hosted";
  return chooseEmbedRoute(false, await probeLocal());
}
