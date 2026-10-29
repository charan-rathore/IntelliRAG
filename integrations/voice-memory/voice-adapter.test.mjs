import { test } from "node:test";
import assert from "node:assert/strict";
import { createVoiceAdapter } from "./voice-adapter.mjs";
import { importBundle } from "./dist/engine.mjs";
const b = () =>
  importBundle([
    {
      title: "Security review",
      text: "Pilot launch is proposed for Tuesday. Security sign-off is pending. Maya owns the security review.",
    },
  ]);
const request = (token, text, extra = {}) =>
  new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + token },
    body: JSON.stringify({
      stream: true,
      messages: [{ role: "user", content: text }],
      ...extra,
    }),
  });
test("SSE streams OpenAI deltas and DONE, separately retains source proof", async () => {
  const a = createVoiceAdapter(),
    t = a.bind(b()),
    r = await a.handle(request(t, "pilot launch security review"));
  const text = await r.text();
  assert.match(text, /chat.completion.chunk/);
  assert.match(text, /data: \[DONE\]/);
  assert.ok(a.lastTurn(t).result.evidence.length);
});
test("caller-supplied scope cannot access another bundle", async () => {
  const a = createVoiceAdapter(),
    t = a.bind(b());
  const r = await a.handle(
    request(t, "payroll salaries", {
      corpus: "all",
      user_data: { corpus: "secret" },
    }),
  );
  assert.equal(r.status, 200);
  assert.equal(a.lastTurn(t).result.refused, true);
});
test("missing, expired and revoked capabilities denied", async () => {
  let n = 0;
  const a = createVoiceAdapter({ ttlMs: 1, now: () => n }),
    t = a.bind(b());
  assert.equal((await a.handle(request("bad", "security"))).status, 401);
  n = 2;
  assert.equal((await a.handle(request(t, "security"))).status, 401);
  const t2 = a.bind(b());
  a.revoke(t2);
  assert.equal((await a.handle(request(t2, "security"))).status, 401);
});
test("draft command never sends and needs prior supported turn", async () => {
  const a = createVoiceAdapter(),
    t = a.bind(b());
  assert.match(
    await (await a.handle(request(t, "turn this into an email"))).text(),
    /supporting evidence/,
  );
  await a.handle(request(t, "pilot launch security review"));
  await a.handle(request(t, "turn this into an email"));
  assert.match(a.lastTurn(t).draft.notice, /Nothing sent/);
});
test("request limits and invalid final roles rejected", async () => {
  const a = createVoiceAdapter(),
    t = a.bind(b());
  assert.equal(
    (await a.handle(request(t, "security", { stream: false }))).status,
    400,
  );
  assert.equal(
    (
      await a.handle(
        request(t, "security", {
          messages: [{ role: "system", content: "secret" }],
        }),
      )
    ).status,
    400,
  );
});

test("malformed top-level and message-list shapes return400 rather than throwing", async () => {
  const a = createVoiceAdapter(),
    t = a.bind(b());
  for (const data of [
    null,
    [],
    {},
    { stream: true, messages: {} },
    { stream: true, messages: "fake" },
    { stream: true, messages: [null] },
  ]) {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer " + t },
      body: JSON.stringify(data),
    });
    assert.equal((await a.handle(req)).status, 400);
  }
});

test("capability expiration or revocation during pending body is rechecked", async () => {
  for (const operation of ["expire", "revoke"]) {
    let clock = 0;
    const a = createVoiceAdapter({ ttlMs: 10, now: () => clock }),
      t = a.bind(b());
    let controller;
    const body = new ReadableStream({
      start(c) {
        controller = c;
      },
    });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer " + t },
      body,
      duplex: "half",
    });
    const pending = a.handle(req);
    if (operation === "expire") clock = 20;
    else a.revoke(t);
    controller.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          stream: true,
          messages: [{ role: "user", content: "security pilot" }],
        }),
      ),
    );
    controller.close();
    assert.equal((await pending).status, 401);
    assert.equal(a.lastTurn(t), null);
  }
});
