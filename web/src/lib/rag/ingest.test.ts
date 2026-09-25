import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestText, htmlToText } from "./ingest.server.ts";

describe("ingestion guards", () => {
  it("rejects PDF bodies explicitly", async () => {
    await assert.rejects(
      ingestText({ title: "paper", body: "%PDF-1.7 binary junk that is long enough to matter here", sourceType: "markdown" }),
      /PDF ingestion is not supported/,
    );
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
