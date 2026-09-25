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
