import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestText, htmlToText, assertNotPdf, fetchRemoteDocument } from "./ingest.server.ts";

describe("ingestion guards", () => {
  it("rejects PDF bodies explicitly", async () => {
    await assert.rejects(
      ingestText({ title: "paper", body: "%PDF-1.7 binary junk that is long enough to matter here", sourceType: "markdown" }),
      /PDF ingestion is not supported/,
    );
  });

  it("rejects a PDF whose header sits within the first 1024 bytes", () => {
    const prefixed = "﻿\n%PDF-1.7 binary junk that is long enough to matter here";
    assert.throws(() => assertNotPdf(prefixed), /PDF ingestion is not supported/);
    const bomPrefixed = "\uFEFF%PDF-1.7 binary junk that is long enough to matter here";
    assert.throws(() => assertNotPdf(bomPrefixed), /PDF ingestion is not supported/);
  });

  it("accepts ordinary text mentioning %PDF- past the first 1024 bytes", () => {
    const filler = "plain prose about document formats. ".repeat(40);
    const body = filler + "a %PDF- marker appears late in this text, well past the header window";
    assert.doesNotThrow(() => assertNotPdf(body));
    assert.doesNotThrow(() => assertNotPdf("just some plain text without any marker at all"));
  });

  it("stops reading a remote response once its download limit is exceeded", async () => {
    const originalFetch = globalThis.fetch;
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(new Uint8Array(240_001).fill(0x61));
          else {
            controller.enqueue(new Uint8Array([0x61]));
            controller.close();
          }
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    globalThis.fetch = async () =>
      new Response(body, { headers: { "content-type": "text/plain" } });
    try {
      await assert.rejects(
        fetchRemoteDocument("https://1.1.1.1/large.txt"),
        /supported import size/,
      );
      assert.equal(pulls, 1, "the response reader should stop after the oversized chunk");
      assert.equal(
        cancelled,
        true,
        "the response stream should be cancelled after the limit is reached",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects oversized documents instead of silently truncating", async () => {
    await assert.rejects(
      ingestText({ title: "big", body: "x".repeat(70_000), sourceType: "markdown" }),
      /exceeds the supported import size/,
    );
  });

  it("converts HTML to text instead of indexing markup", () => {
    const html = "<!doctype html><html><head><title>T</title><style>body{color:red}</style></head><body><h1>Hello</h1><p>World &amp; friends</p><script>alert(1)</script></body></html>";
    const text = htmlToText(html);
    assert.ok(text.includes("Hello"));
    assert.ok(text.includes("World & friends"));
    assert.ok(!text.includes("alert"), text);
    assert.ok(!text.includes("<"), text);
  });
});

describe("GitHub repository file names survive raw URL construction", () => {
  it("imports a tree entry containing hash, percent and spaces instead of treating them as URL syntax", async () => {
    const original = globalThis.fetch;
    const seen: string[] = [];
    const body = "Repository source text must preserve special characters in file names. ".repeat(3);
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      seen.push(url.href);
      if (url.hostname === "api.github.com" && url.pathname.endsWith("/git/trees/main")) return Response.json({ sha: "abc1234", tree: [{ path: "docs/hash#percent% space.md", type: "blob", size: body.length }] });
      if (url.hostname === "raw.githubusercontent.com" && url.pathname === "/probe/special-paths/main/docs/hash%23percent%25%20space.md" && !url.hash) return new Response(body);
      throw new Error(`unexpected URL ${url.href}`);
    };
    try {
      const { ingestFromUrl } = await import("./ingest.server.ts");
      const result = await ingestFromUrl("https://github.com/probe/special-paths/tree/main");
      assert.equal(result.ingested, 1, JSON.stringify(seen));
      assert.equal(result.skipped, 0);
      const { getDocumentBySlug } = await import("./store.server.ts");
      const stored = await getDocumentBySlug(result.titles[0]!);
      assert.equal(stored?.body, body.trim());
    } finally { globalThis.fetch = original; }
  });
});

it("normalizes mixed-case HTML media types before real storage ingestion", async () => {
 const original=globalThis.fetch;
 const {ingestFromUrl}=await import("./ingest.server.ts");
 const {getDocumentBySlug}=await import("./store.server.ts");
 globalThis.fetch=async()=>new Response('<section><h1>Media type normalization</h1><p>Useful document text remains available after stripping markup and script content.</p><script>UNWANTED_PAYLOAD()</script></section>',{headers:{"Content-Type":"Text/HTML; Charset=UTF-8"}});
 try {
 const result=await ingestFromUrl("https://1.1.1.1/mixed-html");
 const doc=await getDocumentBySlug(result.titles[0]!);
 assert.ok(doc?.body.includes("Useful document"));
 assert.ok(!doc?.body.includes("UNWANTED_PAYLOAD"),doc?.body);
 assert.ok(!doc?.body.includes("<section>"),doc?.body);
 } finally {globalThis.fetch=original;}
});
