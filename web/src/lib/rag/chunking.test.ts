import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "./chunking.ts";
import { contentTokens } from "./text.ts";

describe("code boundaries (java/c): call sites are not symbols", () => {
  it("java: only declarations open chunks; bare statements do not", () => {
    const src = [
      "public class Queue {",
      "  public static int computeValue(int x) {",
      "    return helper(x);",
      "  }",
      "  public void run() {",
      "    int y = computeValue(1);",
      "  }",
      "}",
    ].join("\n");
    const chunks = chunkDocument(src, { kind: "code", language: "java", chunkSize: 20, overlap: 0 });
    const symbols = chunks.map((c) => c.symbol).filter(Boolean);
    assert.ok(symbols.includes("computeValue"), JSON.stringify(symbols));
    assert.ok(symbols.includes("run"), JSON.stringify(symbols));
    assert.ok(!symbols.includes("helper"), "call site must not become a symbol");
  });

  it("c: return-call lines do not open chunks; definitions do", () => {
    const src = [
      "static int compute(int x) {",
      "  return helper(x);",
      "}",
      "char *get_name(void) {",
      "  return compute (1);",
      "}",
    ].join("\n");
    const chunks = chunkDocument(src, { kind: "code", language: "c", chunkSize: 20, overlap: 0 });
    const symbols = chunks.map((c) => c.symbol).filter(Boolean);
    assert.deepEqual(symbols, ["compute", "get_name"], JSON.stringify(symbols));
  });
});

describe("heading paths", () => {
  it("chunks deep in a section inherit the full heading path", () => {
    const body = [
      "# Guide",
      "",
      "## Install",
      "",
      "Step one explains the download. ".repeat(40),
      "Step two explains the verify. ".repeat(40),
      "",
      "## Usage",
      "",
      "Run it daily.",
    ].join("\n");
    const chunks = chunkDocument(body, { chunkSize: 60, overlap: 0 });
    const installChunks = chunks.filter((c) => c.text.includes("Step two"));
    assert.ok(installChunks.length >= 1);
    assert.equal(installChunks[0]!.heading, "Guide > Install");
    const usage = chunks.find((c) => c.text.includes("Run it daily"));
    assert.equal(usage!.heading, "Guide > Usage");
  });
});

describe("large markdown tables", () => {
  it("keeps column headers with table rows in every chunk", () => {
    const table = [
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from({ length: 20 }, (_, index) => `| Item ${index} | Value ${index} |`),
    ].join("\n");
    const chunks = chunkDocument(table, { chunkSize: 20, overlap: 0 });
    const tableChunks = chunks.filter((chunk) => /\| Item \d+ \|/.test(chunk.text));

    assert.ok(tableChunks.length > 1, "the test table should span multiple chunks");
    assert.ok(
      tableChunks.every((chunk) => chunk.text.includes("| Name | Value |")),
      "each table chunk should retain its column labels",
    );
  });
});

describe("table header propagation edge cases", () => {
  it("does not borrow another table's header for an identical row", () => {
    const doc = [
      "| Name | Value |",
      "| --- | --- |",
      "| Status | Active |",
      ...Array.from({ length: 12 }, (_, i) => `| Alpha ${i} | ${i} |`),
      "",
      ...Array.from({ length: 30 }, (_, i) => `Filler prose line ${i} to push the second table into later chunks.`),
      "| City | State |",
      "| --- | --- |",
      ...Array.from({ length: 12 }, (_, i) => `| Beta ${i} | ${i} |`),
      "| Status | Active |",
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const first = chunks.filter((c) => c.text.includes("| Alpha"));
    assert.ok(first.length >= 1);
    assert.ok(
      first.every((c) => !c.text.includes("| City | State |")),
      "rows in the first table must not inherit the second table's header",
    );
  });

  it("detects tables written without outer pipes", () => {
    const doc = [
      "Name | Value",
      "--- | ---",
      ...Array.from({ length: 20 }, (_, i) => `Item ${i} | Value ${i}`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const rows = chunks.filter((c) => /Item \d+ \|/.test(c.text));
    assert.ok(rows.length > 1, "the pipeless table should span multiple chunks");
    assert.ok(
      rows.every((c) => c.text.includes("Name | Value")),
      "each chunk should retain the pipeless header",
    );
  });

  it("carries headers onto fragments of an over-long row", () => {
    const longCell = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const doc = [
      "| Name | Description |",
      "| --- | --- |",
      ...Array.from({ length: 10 }, (_, i) => `| Item ${i} | short ${i} |`),
      `| Big | ${longCell} |`,
      ...Array.from({ length: 10 }, (_, i) => `| Tail ${i} | short ${i} |`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const frags = chunks.filter((c) => /word\d+/.test(c.text));
    assert.ok(frags.length > 1, "the long row should split into fragments");
    assert.ok(
      frags.every((c) => c.text.includes("| Name | Description |")),
      "every fragment of the long row should carry the header",
    );
  });

  it("ignores table-shaped lines inside fenced code", () => {
    const doc = [
      "Some prose to start the document body.",
      "",
      "```",
      "| key | value |",
      "| --- | --- |",
      ...Array.from({ length: 20 }, (_, i) => `| cfg_${i} | ${i} |`),
      "```",
      "",
      ...Array.from({ length: 25 }, (_, i) => `Trailing prose line ${i} keeps the document long enough to split.`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const codeChunks = chunks.filter((c) => c.text.includes("| cfg_"));
    assert.ok(codeChunks.length >= 1);
    assert.ok(
      codeChunks.every((c) => !c.text.startsWith("| key | value |")),
      "fenced code rows must not gain a prepended table header",
    );
  });

  it("does not restart a table at a delimiter-shaped data row", () => {
    const doc = [
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from({ length: 8 }, (_, i) => `| Item ${i} | ${i} |`),
      "| --- | --- |",
      ...Array.from({ length: 20 }, (_, i) => `| After ${i} | ${i} |`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const after = chunks.filter((c) => c.text.includes("| After"));
    assert.ok(after.length >= 1);
    assert.ok(
      after.every((c) => c.text.includes("| Name | Value |")),
      "rows after a delimiter-shaped data row keep the real header",
    );
    assert.ok(
      after.every((c) => !c.text.includes(`| Item 7 | 7 |\n| --- | --- |`) || c.text.indexOf("| Name | Value |") < c.text.indexOf("| Item 7 | 7 |")),
      "the delimiter data row must not turn the previous row into a header",
    );
  });
});

describe("unicode tokenizer", () => {
  it("keeps non-ASCII letters as tokens", () => {
    const tokens = contentTokens("Déploiement café 日本語 réseau");
    assert.ok(tokens.includes("déploiement"), JSON.stringify(tokens));
    assert.ok(tokens.includes("café"), JSON.stringify(tokens));
    assert.ok(tokens.includes("日本語"), JSON.stringify(tokens));
  });

  it("ascii behavior is unchanged", () => {
    assert.deepEqual(contentTokens("Redis cache stampede"), ["redi", "cache", "stampede"]);
  });
});

describe("table edges, final round", () => {
  it("does not toggle out of a fence on the other marker", () => {
    const doc = [
      "Intro prose line that stays outside the fence.",
      "```",
      "~~~",
      "| key | value |",
      "| --- | --- |",
      ...Array.from({ length: 20 }, (_, i) => `| cfg_${i} | ${i} |`),
      "```",
      "",
      ...Array.from({ length: 25 }, (_, i) => `Trailing prose line ${i} keeps the document long enough to split.`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const codeChunks = chunks.filter((c) => c.text.includes("| cfg_"));
    assert.ok(codeChunks.length >= 1);
    assert.ok(
      codeChunks.every((c) => !c.text.startsWith("| key | value |")),
      "a tilde run inside a backtick fence must not expose fenced rows to table detection",
    );
  });

  it("does not tag prose that quotes a sentence from a long row", () => {
    const quoted = "The quick brown fox jumps over the lazy dog again";
    const filler = Array.from({ length: 12 }, (_, i) => `padword${i}`).join(" ");
    const doc = [
      "| Name | Description |",
      "| --- | --- |",
      ...Array.from({ length: 8 }, (_, i) => `| Item ${i} | short ${i} |`),
      `| Big | ${quoted} and ${filler} |`,
      "",
      ...Array.from({ length: 30 }, (_, i) => `More trailing prose line ${i} to make the document long enough.`),
      "",
      quoted,
      "",
      ...Array.from({ length: 15 }, (_, i) => `Final prose line ${i} after the quoted sentence.`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const prose = chunks.filter((c) => c.text.includes(quoted) && !c.text.includes("| Big |"));
    assert.ok(prose.length >= 1, "expected a standalone prose chunk with the quoted sentence");
    assert.ok(
      prose.every((c) => !c.text.includes("| Name | Description |")),
      "a prose line quoting a table cell must not gain the table header",
    );
  });

  it("carries headers onto a short tail fragment of an over-long row", () => {
    const words = Array.from({ length: 38 }, (_, i) => `word${i}`).join(" ");
    const doc = [
      "| Name | Description |",
      "| --- | --- |",
      ...Array.from({ length: 6 }, (_, i) => `| Item ${i} | short ${i} |`),
      `| Big | ${words} end |`,
      ...Array.from({ length: 14 }, (_, i) => `| Tail ${i} | short ${i} |`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const frags = chunks.filter((c) => /word\d+|end/.test(c.text) && !c.text.includes("| Big |"));
    assert.ok(frags.length >= 1, "the long row should split into fragments");
    assert.ok(
      frags.every((c) => c.text.includes("| Name | Description |")),
      "every fragment of the long row should carry the header, even a short tail",
    );
  });

  it("stops the table scan at a heading containing a pipe", () => {
    const doc = [
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from({ length: 8 }, (_, i) => `| Item ${i} | ${i} |`),
      "## Next | Steps",
      "",
      ...Array.from({ length: 25 }, (_, i) => `Section body line ${i} explains the follow-up work in plain words.`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const section = chunks.filter((c) => c.text.includes("Section body line 0"));
    assert.ok(section.length >= 1);
    assert.ok(
      section.every((c) => !c.text.includes("| Name | Value |")),
      "a heading after the table must not be absorbed as a table row",
    );
  });

  it("does not treat indented code as a pipeless table", () => {
    const doc = [
      "Opening prose for context.",
      "",
      "    Name | Value",
      "    --- | ---",
      ...Array.from({ length: 20 }, (_, i) => `    code_${i} | ${i}`),
      "",
      ...Array.from({ length: 25 }, (_, i) => `Trailing prose line ${i} keeps the document long enough to split.`),
    ].join("\n");
    const chunks = chunkDocument(doc, { chunkSize: 20, overlap: 0 });
    const codeChunks = chunks.filter((c) => c.text.includes("code_5"));
    assert.ok(codeChunks.length >= 1);
    assert.ok(
      codeChunks.every((c) => !c.text.trimStart().startsWith("Name | Value\n")),
      "indented code must not gain a synthetic table header",
    );
  });
});
