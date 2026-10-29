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
  maxResponseBytes = 100000,
  timeoutMs = 30000,
}) {
  if (!apiKey || !model || !endpoint)
    throw Error("Explicit credential, model and endpoint required.");
  for (const [name, value, limit] of [
    ["maxInputCharacters", maxInputCharacters, 1000000],
    ["maxOutputTokens", maxOutputTokens, 32768],
    ["maxResponseBytes", maxResponseBytes, 1000000],
    ["timeoutMs", timeoutMs, 120000],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > limit)
      throw Error(`${name} requires a positive integer in range 1..${limit}.`);
  }
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw Error("HTTPS endpoint without embedded credentials required.");
  const provider = async ({
    instructions,
    question,
    sources,
    signal,
    onReceipt,
    onRequest,
  }) => {
    const content = JSON.stringify({ question, sources });
    if (content.length + instructions.length > maxInputCharacters)
      throw Error("Input exceeds approved request bound.");
    if (signal?.aborted) throw signal.reason || Error("Aborted");
    const controller = new AbortController();
    const effectiveSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    let reader;
    let timer;
    let abortListener;
    const aborted = new Promise((_, reject) => {
      abortListener = () => reject(effectiveSignal.reason || Error("Aborted"));
      effectiveSignal.addEventListener("abort", abortListener, { once: true });
      if (effectiveSignal.aborted) abortListener();
      timer = setTimeout(
        () => controller.abort(Error("Synthesis deadline exceeded.")),
        timeoutMs,
      );
    });
    aborted.catch(() => {});
    const bounded = (promise) => Promise.race([promise, aborted]);
    try {
      if (effectiveSignal.aborted) throw effectiveSignal.reason;
      const body = JSON.stringify({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content },
        ],
        temperature: 0.2,
        max_tokens: maxOutputTokens,
        response_format: { type: "json_object" },
        provider: { allow_fallbacks: false, data_collection: "deny" },
      });
      if (onRequest)
        await bounded(
          Promise.resolve(
            onRequest({ method: "POST", endpoint: url.href, body }),
          ),
        );
      const response = await bounded(
        fetchImpl(url, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body,
          signal: effectiveSignal,
        }),
      );
      if (!response.ok)
        throw Error(
          `Synthesis request failed (${response.status}); no retry or fallback made.`,
        );
      if (!response.body) throw Error("Provider returned no response body.");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let raw = "";
      let bytes = 0;
      while (true) {
        const { done, value } = await bounded(reader.read());
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxResponseBytes)
          throw Error("Provider response exceeds review bound.");
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw Error("Provider returned an invalid response envelope.");
      }

      if (onReceipt)
        await bounded(
          Promise.resolve(
            onReceipt({ usage: data.usage ?? null, envelope: data }),
          ),
        );
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
    } finally {
      clearTimeout(timer);
      effectiveSignal.removeEventListener("abort", abortListener);
      controller.abort();
      if (reader) reader.cancel().catch(() => {});
    }
  };
  Object.defineProperty(provider, "auditConfig", {
    value: Object.freeze({
      model,
      endpoint: url.href,
      maxInputCharacters,
      maxOutputTokens,
      maxResponseBytes,
      timeoutMs,
      temperature: 0.2,
      responseFormat: "json_object",
      allowFallbacks: false,
      dataCollection: "deny",
      redirect: "error",
    }),
  });
  return provider;
}
