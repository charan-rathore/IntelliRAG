import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { importBundle, answer, draft } from "./dist/engine.mjs";
import { createVoiceAdapter } from "./voice-adapter.mjs";
export function createLocalServer({
  voice = createVoiceAdapter(),
  port = Number(process.env.PORT || 4317),
} = {}) {
  const revokeVoice = (s) => {
    if (s.voiceToken) voice.revoke(s.voiceToken);
    s.voiceToken = null;
  };
  const sessions = new Map();
  const origin = `http://127.0.0.1:${port}`;
  function session(req, res) {
    let id = (req.headers.cookie || "")
      .split("; ")
      .find((c) => c.startsWith("vm="))
      ?.slice(3);
    if (!id || !sessions.has(id)) {
      id = randomBytes(32).toString("hex");
      sessions.set(id, {
        at: Date.now(),
        csrf: randomBytes(32).toString("hex"),
      });
      res.setHeader(
        "Set-Cookie",
        `vm=${id}; HttpOnly; SameSite=Strict; Path=/`,
      );
    }
    if (sessions.size > 50) {
      const oldest = sessions.keys().next().value;
      if (oldest !== id) {
        revokeVoice(sessions.get(oldest));
        sessions.delete(oldest);
      }
    }
    return sessions.get(id);
  }
  async function body(req) {
    const chunks = [];
    let bytes = 0;
    for await (const part of req) {
      const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
      bytes += buffer.length;
      if (bytes > 700000) throw Error("Upload too large.");
      chunks.push(buffer);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
    return JSON.parse(text);
  }
  const server = http.createServer(async (req, res) => {
    const disconnected = new AbortController();
    const abort = () => {
      if (!res.writableEnded) disconnected.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(403);
      res.end("Local host only");
      return;
    }
    for (const [id, s] of sessions)
      if (Date.now() - s.at > 3600000) {
        revokeVoice(s);
        sessions.delete(id);
      }
    const s = session(req, res);
    s.at = Date.now();
    try {
      if (
        req.method === "GET" &&
        ["/", "/app.js", "/style.css"].includes(req.url)
      ) {
        const file = req.url === "/" ? "index.html" : req.url.slice(1);
        res.setHeader(
          "Content-Type",
          file.endsWith("html")
            ? "text/html"
            : file.endsWith("js")
              ? "text/javascript"
              : "text/css",
        );
        res.end(await readFile(new URL("./public/" + file, import.meta.url)));
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET" && req.url === "/api/session") {
        res.end(JSON.stringify({ csrf: s.csrf }));
        return;
      }
      if (
        req.method !== "POST" ||
        req.headers.origin !== origin ||
        req.headers["x-csrf-token"] !== s.csrf
      ) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: "Session or origin check failed." }));
        return;
      }
      const data = await body(req);
      let out;
      if (req.url === "/api/import") {
        const bundle = importBundle(data.documents);
        revokeVoice(s);
        s.bundle = bundle;
        s.result = null;
        out = {
          sources: s.bundle.sources.map(({ id, title, hash, memory }) => ({
            id,
            title,
            hash,
            blocks: memory.blocks.length,
          })),
        };
      } else if (req.url === "/api/query") {
        if (!s.bundle) throw Error("Add documents first.");
        out = s.result = answer(data.question, s.bundle);
      } else if (req.url === "/api/draft") {
        if (!s.bundle || !s.result) throw Error("Ask a question first.");
        out = draft(s.result, s.bundle);
      } else if (req.url === "/api/voice/start") {
        if (!s.bundle) throw Error("Add documents first.");
        revokeVoice(s);
        s.voiceToken = voice.bind(s.bundle);
        out = {
          ready: true,
          mode: "local-contract",
          audioConnected: false,
          synthesisConnected: false,
        };
      } else if (req.url === "/api/voice/turn") {
        if (!s.voiceToken)
          throw Error("Start a local voice-contract session first.");
        const response = await voice.handle(
          new Request(origin + "/v1/chat/completions", {
            signal: disconnected.signal,
            method: "POST",
            headers: { authorization: "Bearer " + s.voiceToken },
            body: JSON.stringify(data),
          }),
        );
        res.writeHead(response.status, {
          "Content-Type": response.headers.get("content-type"),
        });
        if (!response.body) {
          res.end();
          return;
        }
        const reader = response.body.getReader();
        try {
          while (!disconnected.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(value))
              await new Promise((resolve) => {
                res.once("drain", resolve);
                res.once("close", resolve);
              });
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (!res.destroyed) res.end();
        return;
      } else if (req.url === "/api/voice/last") {
        out = { turn: s.voiceToken ? voice.lastTurn(s.voiceToken) : null };
      } else if (req.url === "/api/reset") {
        revokeVoice(s);
        s.bundle = null;
        s.result = null;
        out = { reset: true };
      } else {
        res.writeHead(404);
        out = { error: "Not found." };
      }
      res.end(JSON.stringify(out));
    } catch (err) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(400);
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Request failed.",
        }),
      );
    }
  });
  return server;
}
export const server = createLocalServer();
if (process.argv[1] === new URL(import.meta.url).pathname)
  server.listen(Number(process.env.PORT || 4317), "127.0.0.1", () =>
    console.log("Local voice-memory ready"),
  );
