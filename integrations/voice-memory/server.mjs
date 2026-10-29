import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { importBundle, answer, draft } from "./dist/engine.mjs";
const sessions = new Map();
const port = Number(process.env.PORT || 4317);
const origin = `http://127.0.0.1:${port}`;
function session(req, res) {
  let id = (req.headers.cookie || "")
    .split("; ")
    .find((c) => c.startsWith("vm="))
    ?.slice(3);
  if (!id || !sessions.has(id)) {
    id = randomBytes(32).toString("hex");
    sessions.set(id, { at: Date.now(), csrf: randomBytes(32).toString("hex") });
    res.setHeader("Set-Cookie", `vm=${id}; HttpOnly; SameSite=Strict; Path=/`);
  }
  if (sessions.size > 50) {
    const oldest = sessions.keys().next().value;
    if (oldest !== id) sessions.delete(oldest);
  }
  return sessions.get(id);
}
async function body(req) {
  let text = "";
  for await (const part of req) {
    text += part;
    if (Buffer.byteLength(text) > 700000) throw Error("Upload too large.");
  }
  return JSON.parse(text);
}
export const server = http.createServer(async (req, res) => {
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
    if (Date.now() - s.at > 3600000) sessions.delete(id);
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
      s.bundle = importBundle(data.documents);
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
    } else if (req.url === "/api/reset") {
      s.bundle = null;
      s.result = null;
      out = { reset: true };
    } else {
      res.writeHead(404);
      out = { error: "Not found." };
    }
    res.end(JSON.stringify(out));
  } catch (err) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Request failed.",
      }),
    );
  }
});
if (process.argv[1] === new URL(import.meta.url).pathname)
  server.listen(port, "127.0.0.1", () => console.log(origin));
