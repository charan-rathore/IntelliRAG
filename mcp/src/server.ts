/**
 * IntelliRAG as an MCP server (stdio, JSON-RPC 2.0). No dependencies: the
 * protocol is a few messages, and the retrieval is web/src/lib/rag bundled in.
 *
 *   claude mcp add intellirag -- npx -y github:charan-rathore/IntelliRAG
 *   codex: [mcp_servers.intellirag] command = "npx", args = ["-y", "github:charan-rathore/IntelliRAG"]
 *   hermes: mcp_servers: { intellirag: { command: npx, args: [-y, github:charan-rathore/IntelliRAG] } }
 */
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { folderCorpus, githubCorpus, type Corpus } from "./corpus";
import { ask, feedback, resetSession, search } from "./engine";

const VERSION = "0.1.0";
const PROTOCOL = "2025-06-18";
const corpora = new Map<string, Corpus>();
let current: Corpus | null = null;

const corpusArg = { type: "string", description: "Corpus id from index_folder or index_github. Defaults to the last one indexed." };
const TOOLS = [
  {
    name: "index_folder",
    description: "Index a folder on this machine (docs and source) so questions can be answered from it. Use the repository you are working in.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Folder to index. Defaults to the server's working directory." }, include: { type: "string", enum: ["all", "docs"], description: "all: docs and source (default). docs: Markdown and text only." } } },
  },
  {
    name: "index_github",
    description: "Index a public GitHub repository pinned to one commit. Docs only by default; include all to add source files.",
    inputSchema: { type: "object", required: ["repo"], properties: { repo: { type: "string", description: "owner/repo" }, ref: { type: "string", description: "Branch, tag or commit. Default: the default branch's head." }, include: { type: "string", enum: ["docs", "all"] } } },
  },
  {
    name: "ask",
    description: "Supported evidence for a question, or a refusal when the corpus does not support an answer. Pass the same session for follow-ups: they are read with the earlier questions on their topic. Cite passages by file and heading; never answer past what they say.",
    inputSchema: { type: "object", required: ["question"], properties: { question: { type: "string" }, session: { type: "string", description: "Any stable id for this task's conversation." }, corpus: corpusArg } },
  },
  {
    name: "search",
    description: "Ranked candidate passages before the support gate, for exploring a corpus. Not evidence: use ask for anything you will state as fact.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 20 }, corpus: corpusArg } },
  },
  {
    name: "feedback",
    description: "Mark a passage from this session's answers helpful or not. Later follow-ups lean toward helpful passages and away from unhelpful ones.",
    inputSchema: { type: "object", required: ["session", "ref", "helpful"], properties: { session: { type: "string" }, ref: { type: "string", description: "A passage ref from ask." }, helpful: { type: "boolean" } } },
  },
  {
    name: "new_topic",
    description: "Forget a session's earlier questions, so the next one is searched on its own.",
    inputSchema: { type: "object", required: ["session"], properties: { session: { type: "string" } } },
  },
  {
    name: "sources",
    description: "The corpora indexed in this session: id, origin (path or owner/repo@sha), files and passages.",
    inputSchema: { type: "object", properties: {} },
  },
];

function pick(id?: string): Corpus {
  const c = id ? corpora.get(id) : current;
  if (!c) throw new Error(id ? `No corpus "${id}". Call sources to list them.` : "Nothing indexed yet. Call index_folder or index_github first.");
  return c;
}

function keep(c: Corpus) {
  corpora.set(c.id, c);
  current = c;
  return { corpus: c.id, origin: c.origin, files: c.files, passages: c.rows.length };
}

function render(answer: ReturnType<typeof ask>): string {
  const lines: string[] = [];
  if (answer.reading?.mode && answer.reading.mode !== "fresh") lines.push(`Reading: ${answer.reading.why}`);
  if (answer.refused) {
    lines.push(`REFUSED. ${answer.reason}`, "Say the source does not establish this. Do not answer from memory.");
  } else {
    lines.push(`${answer.passages.length} supported passage${answer.passages.length === 1 ? "" : "s"} from ${answer.origin}:`);
    for (const p of answer.passages) lines.push("", `[${p.ref}] ${p.file}${p.heading ? ` › ${p.heading}` : ""}${p.symbol ? ` (${p.symbol})` : ""}`, p.text);
    if (answer.coverage?.missing.length) lines.push("", `Not mentioned in any passage: ${answer.coverage.missing.join(", ")}. Don't claim those parts.`);
  }
  return lines.join("\n");
}

async function call(name: string, a: any): Promise<{ text: string; data: unknown }> {
  switch (name) {
    case "index_folder": { const r = keep(folderCorpus(resolve(a.path ?? process.cwd()), a.include ?? "all")); return { text: `Indexed ${r.files} files (${r.passages} passages) as ${r.corpus}.`, data: r }; }
    case "index_github": { const r = keep(await githubCorpus(a.repo, { ref: a.ref, include: a.include, token: process.env.GITHUB_TOKEN })); return { text: `Indexed ${r.files} files (${r.passages} passages) from ${r.origin} as ${r.corpus}.`, data: r }; }
    case "ask": { const r = ask(pick(a.corpus), String(a.question), a.session); return { text: render(r), data: r }; }
    case "search": { const r = search(pick(a.corpus), String(a.query), Math.min(20, Math.max(1, Number(a.limit) || 8))); return { text: r.map((p) => `[${p.ref}] ${p.score} ${p.file}${p.heading ? ` › ${p.heading}` : ""}`).join("\n") || "No candidates.", data: r }; }
    case "feedback": { const ok = feedback(String(a.session), String(a.ref), Boolean(a.helpful)); return { text: ok ? "Noted." : "That passage isn't in this session's recent answers.", data: { ok } }; }
    case "new_topic": { resetSession(String(a.session)); return { text: "The next question will be searched on its own.", data: { ok: true } }; }
    case "sources": { const r = [...corpora.values()].map((c) => ({ corpus: c.id, origin: c.origin, files: c.files, passages: c.rows.length, current: c === current })); return { text: r.map((c) => `${c.current ? "*" : " "} ${c.corpus}  ${c.origin}  ${c.files} files`).join("\n") || "Nothing indexed yet.", data: r }; }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");

async function handle(msg: any) {
  const { id, method, params } = msg ?? {};
  if (id === undefined) return; // notifications (initialized, cancelled) need no reply
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "intellirag", version: VERSION },
        instructions: "Index a folder or a GitHub repo, then ask. Answers are supported passages or a refusal; cite them and never go past them. Reuse one session id per task so follow-ups are understood.",
      } });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      try {
        const out = await call(params?.name, params?.arguments ?? {});
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: out.text }], structuredContent: { result: out.data } } });
      } catch (e) {
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true } });
      }
    }
    return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    return send({ jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
  }
}

// One request at a time, in order: an "ask" sent right after "index_github"
// must see the corpus that call is still building.
let chain: Promise<unknown> = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg: unknown;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  chain = chain.then(() => handle(msg));
});
if (process.env.INTELLIRAG_INDEX) {
  try { keep(folderCorpus(resolve(process.env.INTELLIRAG_INDEX))); } catch { /* indexed on first call instead */ }
}
