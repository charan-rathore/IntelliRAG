/** Explicitly configured OpenAI-compatible synthesis transport.
 * No key lookup, defaults, fallback, retry, top-up or call at module load.
 * This is not spend authorization. Caller must establish it before injection.
 */
export function createSynthesisProvider({
  apiKey,
  model,
  endpoint,
  fetchImpl = fetch,
  maxInputCharacters = 32000,
  maxOutputTokens = 1500,
}) {
  if (!apiKey || !model || !endpoint)
    throw Error("Explicit credential, model and endpoint required.");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw Error("HTTPS endpoint without embedded credentials required.");
  return async ({ instructions, question, sources, signal }) => {
    const content = JSON.stringify({ question, sources });
    if (content.length + instructions.length > maxInputCharacters)
      throw Error("Input exceeds approved request bound.");
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content },
        ],
        temperature: 0.2,
        max_tokens: maxOutputTokens,
        response_format: { type: "json_object" },
        provider: { allow_fallbacks: false, data_collection: "deny" },
      }),
      signal,
    });
    if (!response.ok)
      throw Error(
        `Synthesis request failed (${response.status}); no retry or fallback made.`,
      );
    const raw = await response.text();
    if (raw.length > 100000)
      throw Error("Provider response exceeds review bound.");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw Error("Provider returned an invalid response envelope.");
    }

    if (data.error)
      throw Error("Provider returned an error; no retry or fallback made.");
    if (data.choices?.[0]?.finish_reason === "length")
      throw Error(
        "Synthesis exceeded output bound; review failed, not partially accepted.",
      );
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string")
      throw Error("Provider did not return synthesis text.");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw Error("Provider returned invalid JSON; no retry made.");
    }
    return parsed;
  };
}
