import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkPreview } from "./chunk-preview.ts";

describe("chunkPreview", () => {
  it("passes plain prose through unchanged", () => {
    const plain = "The concurrency option limits how many things run at the same time.";
    assert.equal(chunkPreview(plain), plain);
  });

  it("strips heading hashes but keeps the heading words", () => {
    assert.equal(chunkPreview("## FAQ"), "FAQ");
    assert.equal(chunkPreview("#### How do the options interact?"), "How do the options interact?");
  });

  it("cleans the exact live p-queue card text", () => {
    const raw =
      "eClass}); ``` `p-queue` will call corresponding methods to put and get operations from this queue.## FAQ #### How do the `concurrency` and `intervalCap` options affect each other?";
    assert.equal(
      chunkPreview(raw),
      "eClass}); p-queue will call corresponding methods to put and get operations from this queue. FAQ How do the concurrency and intervalCap options affect each other?",
    );
  });

  it("keeps code content from fenced blocks, drops fences and language tags", () => {
    assert.equal(
      chunkPreview("Run it:\n```ts\nawait queue.add(() => fetch());\n```\nDone."),
      "Run it: await queue.add(() => fetch()); Done.",
    );
  });

  it("keeps link text and image alt text", () => {
    assert.equal(chunkPreview("See [the guide](https://example.com/g) now."), "See the guide now.");
    assert.equal(chunkPreview("![architecture diagram](https://example.com/a.png)"), "architecture diagram");
  });

  it("removes emphasis markers without eating the words", () => {
    assert.equal(chunkPreview("This is **important** and *subtle*."), "This is important and subtle.");
  });

  it("collapses whitespace left by removals", () => {
    assert.equal(chunkPreview("a  \n\n  b"), "a b");
  });


  it("keeps multiplication and pointer operators intact", () => {
    assert.equal(chunkPreview("2 * 3 * 4 = 24"), "2 * 3 * 4 = 24");
    assert.equal(chunkPreview("int *p = &x;"), "int *p = &x;");
  });

  it("keeps code tokens that look like markdown", () => {
    assert.equal(chunkPreview("C# is fine, and #include <stdio.h> too"), "C# is fine, and #include <stdio.h> too");
  });

  it("passes bare URLs and file paths through unchanged", () => {
    const u = "See https://example.com/docs/v2?q=1 or src/lib/rag/chunking.ts.";
    assert.equal(chunkPreview(u), u);
  });

  it("keeps shell flags and dashed options", () => {
    assert.equal(chunkPreview("run with --max-count 3 and -q"), "run with --max-count 3 and -q");
  });

  it("strips real emphasis even tight against punctuation", () => {
    assert.equal(chunkPreview("Really **yes**, truly *that*."), "Really yes, truly that.");
  });

  it("is idempotent", () => {
    const raw = "## Title `code` **bold** [link](https://x.example)";
    const once = chunkPreview(raw);
    assert.equal(chunkPreview(once), once);
  });
});
