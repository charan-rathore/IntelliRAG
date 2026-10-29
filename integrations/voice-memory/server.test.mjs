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
