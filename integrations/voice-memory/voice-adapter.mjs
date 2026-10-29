/** OpenAI-compatible streaming contract for a future Bolna custom LLM.
 * Disabled unless explicitly instantiated by a caller. No public listener,
 * credential creation, account configuration or real calls in this module.
 * Each opaque bearer capability binds ONE server-owned bundle. Request body,
 * messages, model and user_data can never select another bundle.
 */
import { randomBytes } from "node:crypto";
import {
  answer,
  answerFromRetrieval,
  draft,
  validateEvidence,
} from "./dist/engine.mjs";
export function createVoiceAdapter({
  ttlMs = 120000,
  now = () => Date.now(),
  retrieval = null,
  bodyTimeoutMs = 5000,
} = {}) {
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1 ||
    !Number.isSafeInteger(bodyTimeoutMs) ||
    bodyTimeoutMs < 1 ||
    bodyTimeoutMs > 30000 ||
    (retrieval !== null &&
      (typeof retrieval.retrieve !== "function" ||
        !["keyword", "dense", "hybrid"].includes(retrieval.actualMode) ||
        (retrieval.actualMode !== "keyword" && !retrieval.embeddingModel)))
  )
    throw Error("Invalid voice adapter config.");
  const grants = new Map();
  return {
    bind(bundle) {
      const token = randomBytes(32).toString("hex");
      grants.set(token, {
        bundle,
        expires: now() + ttlMs,
        last: null,
        sequence: 0,
      });
      return token;
    },
    revoke(token) {
      grants.delete(token);
    },
    async handle(req) {
      if (req.method !== "POST")
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      const token =
        req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      const grant = grants.get(token);
      if (!grant || grant.expires <= now()) {
        grants.delete(token);
        return Response.json(
          { error: "Invalid or expired session capability" },
          { status: 401 },
        );
      }
      const sequence = ++grant.sequence;
      let data;
      try {
        const raw = await boundedBody(req, bodyTimeoutMs);
        data = JSON.parse(raw);
      } catch {
        return Response.json({ error: "Invalid request" }, { status: 400 });
      }
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !Array.isArray(data.messages)
      ) {
        return Response.json(
          { error: "Invalid message list" },
          { status: 400 },
        );
      }
      if (grants.get(token) !== grant || grant.expires <= now()) {
        grants.delete(token);
        return Response.json(
          { error: "Invalid or expired session capability" },
          { status: 401 },
        );
      }
      const last = data.messages.at(-1);
      if (
        data.stream !== true ||
        last?.role !== "user" ||
        typeof last.content !== "string" ||
        !last.content.trim() ||
        last.content.length > 4000
      )
        return Response.json(
          {
            error: "A streaming request with a final user message is required",
          },
          { status: 400 },
        );
      if (req.signal.aborted) return new Response(null, { status: 499 });
      let spoken, turn;
      if (
        /^\s*(turn (that|this|the brief) into (an? )?email|draft (an? )?email)\s*[.!]?\s*$/i.test(
          last.content,
        )
      ) {
        if (!grant.last || grant.last.refused)
          spoken =
            "Ask a question with supporting evidence first. I have not created or sent an email.";
        else {
          const reviewDraft = draft(grant.last, grant.bundle);
          turn = { draft: reviewDraft };
          spoken =
            "A review draft is ready on screen. Check decisions, conditions and open items before using it. Nothing has been sent.";
        }
      } else {
        const result = retrieval
          ? answerFromRetrieval(
              last.content,
              grant.bundle,
              await retrieval.retrieve(last.content, grant.bundle, {
                signal: req.signal,
              }),
              {
                actualMode: retrieval.actualMode,
                embeddingModel: retrieval.embeddingModel,
              },
            )
          : answer(last.content, grant.bundle);
        if (
          !result ||
          typeof result.refused !== "boolean" ||
          !Array.isArray(result.evidence) ||
          (!result.refused && !result.evidence.length)
        )
          throw Error("Invalid retrieval result.");
        for (const evidence of result.evidence)
          validateEvidence(evidence, grant.bundle);
        if (req.signal.aborted) return new Response(null, { status: 499 });
        if (grants.get(token) !== grant || grant.expires <= now())
          return Response.json(
            { error: "Invalid or expired session capability" },
            { status: 401 },
          );
        if (sequence !== grant.sequence)
          return Response.json({ error: "Superseded turn" }, { status: 409 });
        grant.last = result;
        turn = { result };
        spoken = grant.last.unresolved
          ? "Relevant passages need review, but this question is unresolved. No supported answer or draft is available. Review the original passages on screen."
          : grant.last.refused
            ? "I could not find supporting evidence in these documents."
            : `I found ${grant.last.evidence.length} relevant source passages. This local build shows excerpts rather than a synthesized answer. Review the sources on screen, including any conditions or differing decision statements.`;
      }
      const encoder = new TextEncoder(),
        id = "local-contract-" + randomBytes(8).toString("hex");
      const stream = new ReadableStream({
        start(controller) {
          for (const content of spoken.match(/.{1,64}(?:\s|$)|.{1,64}/g) ||
            []) {
            controller.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify({
                    id,
                    object: "chat.completion.chunk",
                    choices: [
                      { index: 0, delta: { content }, finish_reason: null },
                    ],
                  }) +
                  "\n\n",
              ),
            );
          }
          controller.enqueue(
            encoder.encode(
              "data: " +
                JSON.stringify({
                  id,
                  object: "chat.completion.chunk",
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                }) +
                "\n\ndata: [DONE]\n\n",
            ),
          );
          controller.close();
        },
      });
      grant.turn = turn;
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
        },
      });
    },
    lastTurn(token) {
      const g = grants.get(token);
      if (!g || g.expires <= now()) return null;
      return g.turn;
    },
  };
}

async function boundedBody(req, timeoutMs) {
  if (req.signal.aborted) throw Error("Aborted");
  if (!req.body) throw Error("Missing body");
  const reader = req.body.getReader();
  let timer, listener;
  const stopped = new Promise((_, reject) => {
    listener = () => reject(Error("Aborted"));
    req.signal.addEventListener("abort", listener, { once: true });
    timer = setTimeout(() => reject(Error("Body deadline")), timeoutMs);
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "",
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16000) throw Error("Body too large");
      raw += decoder.decode(value, { stream: true });
    }
    return raw + decoder.decode();
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", listener);
    reader.cancel().catch(() => {});
  }
}
