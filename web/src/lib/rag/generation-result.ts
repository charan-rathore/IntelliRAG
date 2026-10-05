/** Provider completion is a protocol outcome, not just a string of tokens. */
export type GenerationFailure = "output_budget_exhausted" | "content_filtered" | "empty_output" | "incomplete_stream" | "invalid_response" | "unexpected_stop";
export class GenerationError extends Error {
  constructor(public reason: GenerationFailure, public usage?: Record<string, unknown>) {
    const messages: Record<GenerationFailure, string> = {
      output_budget_exhausted: "The answer exceeded the model's output budget. It was not saved as a complete answer.",
      content_filtered: "The provider blocked this answer. Try a different question.",
      empty_output: "The model completed without an answer. Try again.",
      incomplete_stream: "The answer stream ended before completion. Try again.",
      invalid_response: "The provider returned an invalid answer event. Try again.",
      unexpected_stop: "The model stopped without completing an answer. Try again.",
    };
    super(messages[reason]);
  }
}
export type Completion = { text: string; stopReason?: string | null; usage?: Record<string, unknown> };
export function validateCompletion(result: Completion): string {
  const stop = result.stopReason?.toLowerCase();
  if (stop === "length" || stop === "max_tokens") throw new GenerationError("output_budget_exhausted", result.usage);
  if (["content_filter", "safety", "recitation", "blocklist", "prohibited_content", "spii", "language", "escalation"].includes(stop ?? "")) throw new GenerationError("content_filtered", result.usage);
  if (!stop) throw new GenerationError("incomplete_stream", result.usage);
  if (stop !== "stop") throw new GenerationError("unexpected_stop", result.usage);
  if (!result.text.trim()) throw new GenerationError("empty_output", result.usage);
  return result.text.trim();
}
export function decodeCompletion(value: unknown, provider: "google" | "openai", streaming = false): Completion {
  if (!value || typeof value !== "object") throw new GenerationError("invalid_response");
  const body = value as Record<string, unknown>;
  const usage = (provider === "google" ? body.usageMetadata : body.usage) as Record<string, unknown> | undefined;
  if (body.error) throw new GenerationError("invalid_response", usage);
  if (provider === "google") {
    const candidates = body.candidates as Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> | undefined;
    const feedback = body.promptFeedback as { blockReason?: string } | undefined;
    if (feedback?.blockReason) throw new GenerationError("content_filtered", usage);
    return { text: candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? "").join("") ?? "", stopReason: candidates?.[0]?.finishReason, usage };
  }
  const choices = body.choices as Array<{ error?: unknown; finish_reason?: string | null; delta?: { content?: string | null }; message?: { content?: string } }> | undefined;
  if (choices?.[0]?.error) throw new GenerationError("invalid_response", usage);
  return { text: streaming ? choices?.[0]?.delta?.content ?? choices?.[0]?.message?.content ?? "" : choices?.[0]?.message?.content ?? "", stopReason: choices?.[0]?.finish_reason, usage };
}
/** SSE framing handles split chunks, CRLF and an unterminated final event. */
export async function readGenerationStream(body: ReadableStream<Uint8Array>, provider: "google" | "openai", onToken: (text: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const result: Completion = { text: "" };
  const consume = (event: string) => {
    const data = event.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { throw new GenerationError("invalid_response", result.usage); }
    const next = decodeCompletion(parsed, provider, true);
    if (next.usage) result.usage = next.usage;
    if (next.stopReason) result.stopReason = next.stopReason;
    result.text += next.text;
    if (next.text) onToken(next.text);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer.replace(/\r\n/g, "\n"));
    return validateCompletion(result);
  } catch (error) {
    if (error instanceof GenerationError) { error.usage ??= result.usage; throw error; }
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
    throw new GenerationError("incomplete_stream", result.usage);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
