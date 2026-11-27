// Input contract: required arguments are enforced, rejections preserve state.
// node mcp/test/input-contract.mjs   (no network: indexes this repository's eval fixture)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC_TIMEOUT_MS = 15000;
const KILL_GRACE_MS = 5000;

// SIGTERM, escalate to SIGKILL after graceMs, and fail loudly if the child
// still has not closed by boundMs. Never resolves without a real close, so a
// survivor can never be reported as a clean shutdown.
const boundedShutdown = (server, closed, graceMs = KILL_GRACE_MS, boundMs = KILL_GRACE_MS * 2 + 1000) => {
  if (server.exitCode === null && server.signalCode === null) server.kill();
  return new Promise((resolve, reject) => {
    const grace = setTimeout(() => { try { server.kill("SIGKILL"); } catch { /* already gone */ } }, graceMs);
    const hard = setTimeout(() => {
      clearTimeout(grace);
      reject(new Error("server did not close within the shutdown bound; child may still be running and temporary state was left in place"));
    }, boundMs);
    closed.then(() => { clearTimeout(grace); clearTimeout(hard); resolve(); });
  });
};

const attachClient = (server) => {
  let buf = "";
  const waiting = new Map();
  let fatal = null;
  const failAll = (err) => {
    if (!fatal) fatal = err;
    for (const [, w] of waiting) { clearTimeout(w.timer); w.reject(fatal); }
    waiting.clear();
  };
  // Established now so cleanup can await close even for an already-exited child.
  const closed = new Promise((resolve) => server.once("close", resolve));
  server.on("error", (err) => failAll(new Error(`server process error: ${err.message}`)));
  server.on("exit", (code, signal) => failAll(new Error(`server exited with code ${code} signal ${signal}`)));
  server.stdin.on("error", (err) => failAll(new Error(`server stdin error: ${err.message}`)));
  server.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const w = waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); clearTimeout(w.timer); w.resolve(msg); }
    }
  });
  let next = 1;
  const rpc = (method, params) => {
    if (fatal) return Promise.reject(fatal);
    return new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`RPC timeout after ${RPC_TIMEOUT_MS}ms: ${method}`));
      }, RPC_TIMEOUT_MS);
      waiting.set(id, { resolve, reject, timer });
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  };
  const stop = (graceMs, boundMs) => boundedShutdown(server, closed, graceMs, boundMs);
  return { rpc, stop, closed };
};

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms)),
]);

const home = mkdtempSync(join(tmpdir(), "intellirag-"));
const server = spawn(process.execPath, [fileURLToPath(new URL("../dist/intellirag-mcp.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, INTELLIRAG_HOME: home } });
const client = attachClient(server);
const tool = async (name, args) => (await client.rpc("tools/call", { name, arguments: args })).result;
const text = (r) => r.content?.[0]?.text ?? "";

try {
  await client.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "input-contract", version: "0" } });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const fixture = fileURLToPath(new URL("../../eval/repo-support/fixtures", import.meta.url));
  const indexed = await tool("index_folder", { path: fixture, include: "docs" });
  assert.equal(indexed.isError, undefined, text(indexed));

  // Absent and non-string required arguments are rejected as tool errors the
  // model can correct (the server's existing error-result convention, aligned
  // with the clarified MCP guidance for tool validation errors).
  for (const bad of [{}, { question: null }, { question: 42 }, { question: { q: "x" } }]) {
    const r = await tool("ask", bad);
    assert.equal(r.isError, true, `ask ${JSON.stringify(bad)} must fail`);
    assert.match(text(r), /question/, text(r));
  }
  for (const bad of [{}, { query: null }, { query: 42 }, { query: { q: "x" } }]) {
    const r = await tool("search", bad);
    assert.equal(r.isError, true, `search ${JSON.stringify(bad)} must fail`);
    assert.match(text(r), /query/, text(r));
  }

  // Rejections leave corpus state exactly as it was, and session state intact.
  const corpusBefore = (await tool("sources", {})).structuredContent.result;
  const first = await tool("ask", { question: "How do I cancel a queued task with an AbortSignal?", session: "s" });
  assert.equal(first.structuredContent.result.refused, false, text(first));
  const rejected = await tool("ask", { session: "s" });
  assert.equal(rejected.isError, true);
  const rejectedSearch = await tool("search", {});
  assert.equal(rejectedSearch.isError, true);
  const corpusAfter = (await tool("sources", {})).structuredContent.result;
  assert.deepEqual(corpusAfter, corpusBefore, "corpus registry and current pointer exactly unchanged by rejected calls");
  const follow = await tool("ask", { question: "What if it is already running?", session: "s" });
  assert.equal(follow.structuredContent.result.reading.mode, "follow-up", "session state must survive a rejected call");

  // Behavior intentionally left unchanged.
  const emptyQuestion = await tool("ask", { question: "" });
  assert.equal(emptyQuestion.structuredContent.result.refused, true, "empty string still reaches the support gate");
  const defaultLimit = await tool("search", { query: "cancel task", limit: 0 });
  assert.equal(defaultLimit.structuredContent.result.length, 8, "limit normalization unchanged");
  const clampedLow = await tool("search", { query: "cancel task", limit: -5 });
  assert.equal(clampedLow.structuredContent.result.length, 1, "limit clamp unchanged");
  const noSession = await tool("feedback", {});
  assert.match(text(noSession), /Ask something/, "feedback no-op text unchanged");

  // Harness failure paths, proven against controlled child fixtures so the
  // lifecycle does not rest on happy-path inspection alone.
  // (a) A child that exits immediately rejects a pending RPC with the exit error.
  const exitChild = attachClient(spawn(process.execPath, ["-e", "process.exit(1)"], { stdio: ["pipe", "pipe", "inherit"] }));
  try {
    await assert.rejects(exitChild.rpc("ping", {}), /exited/, "pending RPC must reject on child exit");
    // (b) The terminal failure latches: later RPCs reject at once instead of
    // waiting out the RPC timeout.
    await assert.rejects(exitChild.rpc("ping", {}), /exited/, "terminal child failure must latch for later RPCs");
  } finally {
    await exitChild.stop();
  }
  // (c) A child that ignores SIGTERM is escalated to SIGKILL and its close is
  // genuinely awaited (short grace so the escalation path runs fast). The
  // child announces readiness first so the handler is installed before
  // SIGTERM, and the readiness wait is itself bounded.
  const stubborn = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('ready')"], { stdio: ["pipe", "pipe", "inherit"] });
  const stubbornClosed = new Promise((resolve) => stubborn.once("close", resolve));
  try {
    const ready = new Promise((resolve) => stubborn.stdout.once("data", resolve));
    await withTimeout(ready, 5000, "stubborn fixture readiness");
    await boundedShutdown(stubborn, stubbornClosed, 300, 5000);
    assert.equal(stubborn.signalCode, "SIGKILL", "SIGTERM-ignoring child must end by SIGKILL escalation, not the initial SIGTERM");
  } finally {
    if (stubborn.exitCode === null && stubborn.signalCode === null) stubborn.kill("SIGKILL");
    await withTimeout(stubbornClosed, 5000, "stubborn fixture close");
  }
  // (d) If close never comes, the hard bound rejects instead of reporting a
  // clean shutdown, and no termination or state removal is claimed.
  const fakeServer = { exitCode: null, signalCode: null, kill() {} };
  await assert.rejects(boundedShutdown(fakeServer, new Promise(() => {}), 50, 200), /did not close/, "hard shutdown bound must fail loudly");

  console.log("input-contract: all assertions passed");
} finally {
  await client.stop();
  rmSync(home, { recursive: true, force: true });
}
process.exit(0);
