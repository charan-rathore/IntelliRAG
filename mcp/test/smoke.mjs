// Drives the built server over stdio the way an agent's MCP client does.
// node mcp/test/smoke.mjs   (no network: indexes this repository's eval fixture)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const server = spawn(process.execPath, [fileURLToPath(new URL("../dist/intellirag-mcp.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const waiting = new Map();
server.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
  }
});
let next = 1;
const rpc = (method, params) => new Promise((res) => { const id = next++; waiting.set(id, res); server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const tool = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); return r.result; };

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
assert.equal(init.result.serverInfo.name, "intellirag");
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = (await rpc("tools/list", {})).result.tools.map((t) => t.name);
assert.deepEqual(tools, ["index_folder", "index_github", "ask", "search", "feedback", "new_topic", "sources"]);

const fixture = fileURLToPath(new URL("../../eval/repo-support/fixtures", import.meta.url));
const indexed = await tool("index_folder", { path: fixture, include: "docs" });
assert.ok(indexed.structuredContent.result.passages > 10, indexed.content[0].text);

const first = await tool("ask", { question: "How do I cancel a queued task with an AbortSignal?", session: "s" });
assert.equal(first.structuredContent.result.refused, false);
const follow = await tool("ask", { question: "What if it is already running?", session: "s" });
const r = follow.structuredContent.result;
assert.equal(r.reading.mode, "follow-up");
assert.ok(r.passages.some((p) => p.text.includes("the signal will need to be handled by the operation itself")), follow.content[0].text);

const refused = await tool("ask", { question: "What exact production database password does this repository specify?", session: "t" });
assert.equal(refused.structuredContent.result.refused, true);
assert.match(refused.content[0].text, /REFUSED/);

const fb = await tool("feedback", { session: "s", ref: r.passages[0].ref, helpful: true });
assert.equal(fb.structuredContent.result.ok, true);
const bad = await tool("ask", { question: "anything", corpus: "nope" });
assert.equal(bad.isError, true);
const unknown = await rpc("does/not/exist", {});
assert.equal(unknown.error.code, -32601);

server.kill();
console.log("mcp smoke: ok —", tools.length, "tools; follow-up read as", r.reading.mode, "→", r.passages[0].file, "›", r.passages[0].heading);
