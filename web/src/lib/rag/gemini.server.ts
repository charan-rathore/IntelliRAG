import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_MODEL_OPENROUTER,
  GENERATION_MODEL,
  GENERATION_MODEL_OPENROUTER,
  GENERATION_MODEL_XAI,
  type KeyProvider,
} from "./types";
import { resolveRuntime } from "./keys.server";
import { l2Normalize } from "./text";

const GEMINI_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_ROOT = "https://openrouter.ai/api/v1";
const XAI_ROOT = "https://api.x.ai/v1";

function geminiUrl(path: string, apiKey: string, extra = "") {
  return `${GEMINI_ROOT}/${path}?key=${encodeURIComponent(apiKey)}${extra}`;
}

function openRouterHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "IntelliRAG",
  };
}

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof body.error === "string") return body.error;
    return body.error?.message || body.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

function documentEmbedText(title: string, text: string) {
  return `title: ${title} | text: ${text}`;
}

function queryEmbedText(query: string) {
  return `task: search result | query: ${query}`;
}

type EmbedRequest = { title?: string; text: string; task: "document" | "query" };

function formattedText(item: EmbedRequest) {
  return item.task === "query"
    ? queryEmbedText(item.text)
    : documentEmbedText(item.title || "Document", item.text);
}

function assertDimension(values: number[]) {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new GeminiError(
      `Embedding size ${values.length} does not match the index (${EMBEDDING_DIMENSIONS}). Re-index with ${EMBEDDING_MODEL}.`,
    );
  }
  return l2Normalize(values);
}

async function embedOneGoogle(apiKey: string, item: EmbedRequest): Promise<number[]> {
  const res = await fetch(geminiUrl(`${EMBEDDING_MODEL}:embedContent`, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: formattedText(item) }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) throw new GeminiError(await readError(res), res.status);
  const body = (await res.json()) as { embedding?: { values?: number[] } };
  return assertDimension(body.embedding?.values ?? []);
}

async function embedBatchGoogle(apiKey: string, items: EmbedRequest[]): Promise<number[][]> {
  const requests = items.map((item) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text: formattedText(item) }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  }));
  const res = await fetch(geminiUrl(`${EMBEDDING_MODEL}:batchEmbedContents`, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    if (items.length <= 8) {
      const out: number[][] = [];
      for (const item of items) out.push(await embedOneGoogle(apiKey, item));
      return out;
    }
    throw new GeminiError(await readError(res), res.status);
  }
  const body = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
  const vectors = body.embeddings ?? [];
  if (vectors.length !== items.length) {
    throw new GeminiError("Embedding batch size mismatch");
  }
  return vectors.map((e) => assertDimension(e.values ?? []));
}

const OPENROUTER_EMBED_PROVIDER = {
  order: ["google-ai-studio", "google-vertex"],
  allow_fallbacks: false,
};

async function embedBatchOpenRouter(apiKey: string, items: EmbedRequest[]): Promise<number[][]> {
  const input = items.map(formattedText);
  const run = async (pinProvider: boolean) => {
    const res = await fetch(`${OPENROUTER_ROOT}/embeddings`, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: EMBEDDING_MODEL_OPENROUTER,
        input,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
        ...(pinProvider ? { provider: OPENROUTER_EMBED_PROVIDER } : {}),
      }),
    });
    return res;
  };
  let res = await run(true);
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    res = await run(false);
  }
  if (!res.ok) {
    if (items.length > 1 && items.length <= 8) {
      const out: number[][] = [];
      for (const item of items) {
        const one = await embedBatchOpenRouter(apiKey, [item]);
        out.push(one[0] ?? []);
      }
      return out;
    }
    throw new GeminiError(await readError(res), res.status);
  }
  const body = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== items.length) {
    throw new GeminiError("Embedding batch size mismatch");
  }
  return rows.map((row) => assertDimension(row.embedding ?? []));
}

export async function embedTexts(
  items: EmbedRequest[],
): Promise<{ model: string; vectors: number[][]; provider: KeyProvider }> {
  const runtime = resolveRuntime();
  if (!runtime.embed) {
    throw new GeminiError("Add a Gemini or OpenRouter API key to embed documents", 401);
  }
  if (!items.length) {
    return { model: EMBEDDING_MODEL, vectors: [], provider: runtime.embed.provider };
  }
  const vectors =
    runtime.embed.provider === "google"
      ? await embedBatchGoogle(runtime.embed.apiKey, items)
      : await embedBatchOpenRouter(runtime.embed.apiKey, items);
  return { model: EMBEDDING_MODEL, vectors, provider: runtime.embed.provider };
}

export async function embedQuery(query: string) {
  const { model, vectors, provider } = await embedTexts([{ text: query, task: "query" }]);
  return { model, vector: vectors[0] ?? [], provider };
}

function generationBody(system: string, user: string, withThinking: boolean) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1536,
      ...(withThinking ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
    },
  };
}

async function generateGoogle(opts: {
  apiKey: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<string> {
  const run = async (withThinking: boolean) => {
    const res = await fetch(geminiUrl(`${GENERATION_MODEL}:generateContent`, opts.apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(generationBody(opts.system, opts.user, withThinking)),
      signal: opts.signal,
    });
    if (!res.ok) throw new GeminiError(await readError(res), res.status);
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (
      body.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? ""
    );
  };
  try {
    return await run(true);
  } catch (err) {
    if (err instanceof GeminiError && err.status === 400) return run(false);
    throw err;
  }
}

async function generateOpenRouter(opts: {
  apiKey: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<string> {
  const send = async (pinProvider: boolean) =>
    fetch(`${OPENROUTER_ROOT}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(opts.apiKey),
      body: JSON.stringify({
        model: GENERATION_MODEL_OPENROUTER,
        temperature: 0.1,
        max_tokens: 1536,
        stream: false,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        ...(pinProvider
          ? { provider: { order: ["google-ai-studio", "google-vertex"], allow_fallbacks: false } }
          : {}),
      }),
      signal: opts.signal,
    });
  let res = await send(true);
  if (!res.ok && (res.status === 400 || res.status === 404)) res = await send(false);
  if (!res.ok) throw new GeminiError(await readError(res), res.status);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

async function streamGoogle(opts: {
  apiKey: string;
  system: string;
  user: string;
  onToken: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const run = async (withThinking: boolean) => {
    const res = await fetch(
      geminiUrl(`${GENERATION_MODEL}:streamGenerateContent`, opts.apiKey, "&alt=sse"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generationBody(opts.system, opts.user, withThinking)),
        signal: opts.signal,
      },
    );
    if (!res.ok) throw new GeminiError(await readError(res), res.status);
    if (!res.body) return generateGoogle(opts);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const line = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!line || line === "[DONE]") continue;
        try {
          const json = JSON.parse(line) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const piece =
            json.candidates?.[0]?.content?.parts
              ?.map((p) => p.text ?? "")
              .join("") ?? "";
          if (piece) {
            full += piece;
            opts.onToken(piece);
          }
        } catch {
          // ignore keepalives
        }
      }
    }
    return full.trim();
  };
  try {
    return await run(true);
  } catch (err) {
    if (err instanceof GeminiError && err.status === 400) return run(false);
    throw err;
  }
}

async function streamOpenRouter(opts: {
  apiKey: string;
  system: string;
  user: string;
  onToken: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const bodyFor = (pinProvider: boolean) =>
    JSON.stringify({
      model: GENERATION_MODEL_OPENROUTER,
      temperature: 0.1,
      max_tokens: 1536,
      stream: true,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      ...(pinProvider
        ? { provider: { order: ["google-ai-studio", "google-vertex"], allow_fallbacks: false } }
        : {}),
    });

  const send = async (pinProvider: boolean) =>
    fetch(`${OPENROUTER_ROOT}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(opts.apiKey),
      body: bodyFor(pinProvider),
      signal: opts.signal,
    });

  let res = await send(true);
  if (!res.ok && (res.status === 400 || res.status === 404)) res = await send(false);
  if (!res.ok) throw new GeminiError(await readError(res), res.status);
  if (!res.body) {
    const text = await generateOpenRouter({
      apiKey: opts.apiKey,
      system: opts.system,
      user: opts.user,
      signal: opts.signal,
    });
    if (text) opts.onToken(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const line = event
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!line || line === "[DONE]") continue;
      try {
        const json = JSON.parse(line) as {
          choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string } }>;
        };
        const piece = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
        if (piece) {
          full += piece;
          opts.onToken(piece);
        }
      } catch {
        // ignore keepalives
      }
    }
  }
  return full.trim();
}

async function generateXai(opts: {
  apiKey: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${XAI_ROOT}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GENERATION_MODEL_XAI,
      temperature: 0.1,
      max_tokens: 1024,
      stream: false,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new GeminiError(await readError(res), res.status);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

async function streamXai(opts: {
  apiKey: string;
  system: string;
  user: string;
  onToken: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${XAI_ROOT}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GENERATION_MODEL_XAI,
      temperature: 0.1,
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new GeminiError(await readError(res), res.status);
  if (!res.body) {
    const text = await generateXai({
      apiKey: opts.apiKey,
      system: opts.system,
      user: opts.user,
      signal: opts.signal,
    });
    if (text) opts.onToken(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const line = event
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!line || line === "[DONE]") continue;
      try {
        const json = JSON.parse(line) as {
          choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string } }>;
        };
        const piece = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
        if (piece) {
          full += piece;
          opts.onToken(piece);
        }
      } catch {
        // ignore keepalives
      }
    }
  }
  return full.trim();
}

export async function streamGenerate(opts: {
  system: string;
  user: string;
  onToken: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const runtime = resolveRuntime();
  if (!runtime.generate) {
    throw new GeminiError("Add a Gemini or OpenRouter API key to generate answers", 401);
  }
  if (runtime.generate.provider === "openrouter") {
    return streamOpenRouter({ ...opts, apiKey: runtime.generate.apiKey });
  }
  if (runtime.generate.provider === "xai") {
    return streamXai({ ...opts, apiKey: runtime.generate.apiKey });
  }
  return streamGoogle({ ...opts, apiKey: runtime.generate.apiKey });
}

export async function completeOnce(opts: {
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<string> {
  const runtime = resolveRuntime();
  if (!runtime.generate) {
    throw new GeminiError("Add a Gemini or OpenRouter API key to generate answers", 401);
  }
  if (runtime.generate.provider === "openrouter") {
    return generateOpenRouter({ ...opts, apiKey: runtime.generate.apiKey });
  }
  if (runtime.generate.provider === "xai") {
    return generateXai({ ...opts, apiKey: runtime.generate.apiKey });
  }
  return generateGoogle({ ...opts, apiKey: runtime.generate.apiKey });
}

export function generationModelLabel(provider: KeyProvider | null) {
  if (provider === "openrouter") return GENERATION_MODEL_OPENROUTER;
  if (provider === "xai") return GENERATION_MODEL_XAI;
  return GENERATION_MODEL;
}
