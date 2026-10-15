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
