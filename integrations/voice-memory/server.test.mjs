import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const root = "http://127.0.0.1:4317";
before(async () => new Promise((r) => server.listen(4317, "127.0.0.1", r)));
after(async () => new Promise((r) => server.close(r)));
async function session() {
  const r = await fetch(root + "/api/session");
  return {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: (await r.json()).csrf,
  };
}
const post = (s, p, body, origin = root) =>
  fetch(root + "/api/" + p, {
    method: "POST",
    headers: {
      cookie: s.cookie,
      origin,
      "X-CSRF-Token": s.csrf,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("same origin, CSRF and session required", async () => {
  const s = await session();
  assert.equal(
    (await post(s, "import", {}, "https://evil.example")).status,
    403,
  );
  assert.equal((await post({ ...s, csrf: "bad" }, "query", {})).status, 403);
});
test("end-to-end local HTTP flow and isolated session", async () => {
  const a = await session(),
    b = await session();
  const docs = [
    {
      title: "Security review",
      text: "Pilot launch is not approved. Security sign-off remains pending. Maya owns the review. Budget review is due Friday.",
    },
  ];
  assert.equal((await post(a, "import", { documents: docs })).status, 200);
  assert.equal(
    (await post(b, "query", { question: "security review pilot launch" }))
      .status,
    400,
  );
  const r = await (
    await post(a, "query", { question: "security review pilot launch" })
  ).json();
  assert.equal(r.refused, false);
  assert.ok(r.evidence.length);
  assert.equal((await post(a, "draft", {})).status, 200);
  assert.equal((await post(a, "reset", {})).status, 200);
  assert.equal((await post(a, "draft", {})).status, 400);
});
test("source text cannot become HTML", async () => {
  const s = await session();
  const r = await post(s, "import", {
    documents: [
      {
        title: "<img src=x onerror=alert(1)>",
        text: 'This document is long enough to import. <script>fetch("https://evil.example")</script> Security is pending.',
      },
    ],
  });
  assert.equal(r.status, 200);
  const page = await fetch(root + "/");
  assert.match(
    page.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
});

test("split UTF-8 HTTP buffers preserve original rupee and emoji source bytes", async () => {
  const { request } = await import("node:http");
  const s = await session();
  for (const symbol of ["₹", "😀"]) {
    const text = `Security review budget is ${symbol}50000. Pilot security sign-off remains pending. Maya owns review.`;
    const raw = Buffer.from(
      JSON.stringify({ documents: [{ title: "Unicode source", text }] }),
    );
    const index = raw.indexOf(Buffer.from(symbol)) + 1;
    const response = await new Promise((resolve, reject) => {
      const req = request(
        root + "/api/import",
        {
          method: "POST",
          headers: {
            cookie: s.cookie,
            origin: root,
            "X-CSRF-Token": s.csrf,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
      req.write(raw.subarray(0, index));
      setTimeout(() => req.end(raw.subarray(index)), 10);
    });
    assert.equal(response.status, 200);
    const result = await (
      await post(s, "query", { question: "Security review budget" })
    ).json();
    assert.ok(
      result.evidence.some((e) => e.quote.includes(symbol + "50000")),
      JSON.stringify(result),
    );
    assert.ok(!JSON.stringify(result).includes("�"));
  }
});
test("local session voice bridge preserves evidence and resets on replacement without exposing bearer", async () => {
  const a = await session(),
    b = await session();
  await post(a, "import", {
    documents: [
      {
        title: "Pilot",
        text: "Pilot launch security review is pending. Maya owns security review and launch is not approved.",
      },
    ],
  });
  const start = await (await post(a, "voice/start", {})).json();
  assert.deepEqual(start, {
    ready: true,
    mode: "local-contract",
    audioConnected: false,
    synthesisConnected: false,
  });
  assert.equal(
    (
      await post(b, "voice/turn", {
        stream: true,
        messages: [{ role: "user", content: "security pilot" }],
      })
    ).status,
    400,
  );
  const r = await post(a, "voice/turn", {
    stream: true,
    messages: [{ role: "user", content: "security pilot" }],
  });
  assert.match(r.headers.get("content-type"), /event-stream/);
  assert.match(await r.text(), /\[DONE\]/);
  assert.ok(
    (await (await post(a, "voice/last", {})).json()).turn.result.evidence
      .length,
  );
  await post(a, "import", {
    documents: [
      {
        title: "Other",
        text: "The separate catering budget is under review. No pilot security decision is recorded in this document.",
      },
    ],
  });
  assert.equal((await (await post(a, "voice/last", {})).json()).turn, null);
  assert.equal(
    (
      await post(a, "voice/turn", {
        stream: true,
        messages: [{ role: "user", content: "security" }],
      })
    ).status,
    400,
  );
  await post(a, "voice/start", {});
  await post(a, "reset", {});
  assert.equal((await (await post(a, "voice/last", {})).json()).turn, null);
});
test("HTTP disconnect propagates abort and suppresses delayed retrieval state", async () => {
  const { createLocalServer } = await import("./server.mjs");
  const { createVoiceAdapter } = await import("./voice-adapter.mjs");
  const { request } = await import("node:http");
  let release, seen, token;
  const entered = new Promise((r) => (seen = r));
  const voice = createVoiceAdapter({
    retrieval: {
      actualMode: "keyword",
      embeddingModel: null,
      retrieve: async (q, bundle, { signal }) => {
        seen(signal);
        await new Promise((r) => (release = r));
        return {
          actualMode: "keyword",
          corpusId: bundle.scope,
          corpusScope: "corpus",
          evidence: "insufficient",
          chunks: [],
        };
      },
    },
  });
  const bind = voice.bind;
  voice.bind = (bundle) => (token = bind(bundle));
  const port = 4318,
    local = createLocalServer({ voice, port }),
    url = "http://127.0.0.1:" + port;
  await new Promise((r) => local.listen(port, "127.0.0.1", r));
  try {
    const r = await fetch(url + "/api/session");
    const cookie = r.headers.get("set-cookie").split(";")[0],
      csrf = (await r.json()).csrf;
    const headers = {
      cookie,
      origin: url,
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    await fetch(url + "/api/import", {
      method: "POST",
      headers,
      body: JSON.stringify({
        documents: [
          {
            title: "Source",
            text: "Pilot security review is pending. Maya owns the security review.",
          },
        ],
      }),
    });
    await fetch(url + "/api/voice/start", {
      method: "POST",
      headers,
      body: "{}",
    });
    const req = request(url + "/api/voice/turn", { method: "POST", headers });
    req.on("error", () => {});
    req.end(
      JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: "security" }],
      }),
    );
    const signal = await entered;
    req.destroy();
    await new Promise((r) =>
      signal.aborted
        ? r()
        : signal.addEventListener("abort", r, { once: true }),
    );
    assert.equal(signal.aborted, true);
    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(voice.lastTurn(token), undefined);
  } finally {
    release?.();
    await new Promise((r) => local.close(r));
  }
});
