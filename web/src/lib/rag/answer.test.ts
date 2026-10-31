import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAnswerHtml } from "./answer.tsx";
import { extractiveAnswer } from "./extractive.ts";
import type { RetrievedChunk } from "./types";

describe("formatAnswerHtml evidence preservation", () => {
  it("keeps exponent operators verbatim instead of bolding between them", () => {
    const html = formatAnswerHtml("x = 2**3 + 4**5  # exponents", []);
    assert.ok(html.includes("2**3 + 4**5"), `operators eaten: ${html}`);
    assert.ok(!html.includes("<strong>"), `phantom bold: ${html}`);
  });

  it("keeps emphasis markers inside words and code tokens verbatim", () => {
    assert.ok(formatAnswerHtml("a**b**c stays", []).includes("a**b**c"));
    assert.ok(formatAnswerHtml("2**3**4", []).includes("2**3**4"));
  });

  it("still converts real boundary emphasis to <strong>", () => {
    assert.ok(formatAnswerHtml("This is **important** here.", []).includes("<strong>important</strong>"));
    assert.ok(formatAnswerHtml("Really **yes**, truly.", []).includes("<strong>yes</strong>"));
  });

  it("converts bold next to a citation reference", () => {
    const html = formatAnswerHtml("[Source 1] **Note** follows", [
      { sourceIndex: 1, title: "Doc", slug: "doc" } as never,
    ]);
    assert.ok(html.includes("<strong>Note</strong>"), `missed chip-adjacent bold: ${html}`);
  });

  it("converts bold wrapped in real quotes, which escape to &quot; before this pass", () => {
    const html = formatAnswerHtml('She said "**yes**" twice.', []);
    assert.ok(html.includes("<strong>yes</strong>"), `missed quoted bold: ${html}`);
  });

  it("matched multi-backtick regions are protected as a whole", () => {
    // Content is verbatim escaped code; the region is never emphasis- or
    // chip-transformed, and inner single backticks keep every byte.
    const html = formatAnswerHtml("Call ``a`b`` now", []);
    assert.ok(html.includes("<code>a`b</code>"), `mangled: ${html}`);
    assert.ok(!html.includes("``"), `delimiters leaked: ${html}`);
  });

  it("a double-backtick region shields emphasis markers inside it", () => {
    const html = formatAnswerHtml("Call ``x **bold** y`` now", []);
    assert.ok(html.includes("<code>x **bold** y</code>"), `content transformed: ${html}`);
    assert.ok(!html.includes("<strong>"), `phantom bold: ${html}`);
  });

  it("a double-backtick region shields an inner single-backtick span", () => {
    const html = formatAnswerHtml("use `` `__init__` `` here", []);
    assert.ok(html.includes("<code> `__init__` </code>"), `inner ticks stripped: ${html}`);
  });

  it("an unmatched multi-backtick run stays literal prose", () => {
    const html = formatAnswerHtml("a `` stray", []);
    assert.ok(html.includes("``"), `unmatched run deleted: ${html}`);
    assert.ok(!html.includes("<code>"), `phantom code: ${html}`);
  });

  it("keeps line boundaries around fenced blocks so words never merge", () => {
    const html = formatAnswerHtml("Before\n```\nx = 2**3\n```\nAfter", []);
    assert.ok(html.includes("Before<br><code>x = 2**3</code><br>After"), `boundaries lost: ${html}`);
    assert.ok(!html.includes("<strong>"), `phantom bold: ${html}`);
  });

  it("still converts a clean single-backtick span to <code>", () => {
    assert.ok(formatAnswerHtml("Call `init()` last.", []).includes("<code>init()</code>"));
  });

  it("keeps a stray unmatched backtick visible", () => {
    assert.ok(formatAnswerHtml("it's a `stray one", []).includes("`stray"));
  });

  it("never applies emphasis inside an inline code span", () => {
    const html = formatAnswerHtml("use `x **bold** y` here", []);
    assert.ok(html.includes("<code>x **bold** y</code>"), `span corrupted: ${html}`);
    assert.ok(!html.includes("<strong>"), `phantom bold inside code: ${html}`);
  });

  it("never applies emphasis or chips inside a fenced block", () => {
    const html = formatAnswerHtml("before\n```\n**literal** and [Source 1]\n```\nafter", [
      { sourceIndex: 1, title: "Doc", slug: "doc" } as never,
    ]);
    assert.ok(html.includes("**literal**"), `fence content transformed: ${html}`);
    assert.ok(html.includes("[Source 1]"), `chip consumed inside code: ${html}`);
    assert.ok(!html.includes("<strong>"), `phantom bold from fence: ${html}`);
  });

  it("a citation reference inside a code span stays literal, no nested chip", () => {
    const html = formatAnswerHtml("see `[Source 1]` for that", [
      { sourceIndex: 1, title: "Doc", slug: "doc" } as never,
    ]);
    assert.ok(html.includes("<code>[Source 1]</code>"), `chip nested in code: ${html}`);
    assert.ok(!html.includes("cite-chip"), `chip generated from code content: ${html}`);
  });

  it("a citation title with markdown never gets transformed inside the attribute", () => {
    const html = formatAnswerHtml("[Source 1]", [
      { sourceIndex: 1, title: "Doc **hot** `x`", slug: "doc" } as never,
    ]);
    assert.equal((html.match(/<a class="cite-chip"/g) ?? []).length, 1, `chip count wrong: ${html}`);
    assert.ok(html.includes('title="Doc **hot** `x`"'), `title transformed: ${html}`);
    assert.ok(!html.includes("<strong>") && !html.includes("<code>"), `markup leaked into attribute: ${html}`);
  });
});

describe("extractive answer excerpts keep code evidence through formatting", () => {
  it("excerpt with exponent operators survives extractiveAnswer + formatAnswerHtml", () => {
    const chunks = [
      { text: "# Perf notes\n\nCompute x = 2**3 + 4**5 for the exponent benchmark before tuning the loop." },
    ] as RetrievedChunk[];
    const answer = extractiveAnswer("How is the exponent benchmark computed?", chunks);
    assert.ok(answer.includes("2**3 + 4**5"), `excerpt lost operators: ${answer}`);
    const html = formatAnswerHtml(answer, []);
    assert.ok(html.includes("2**3 + 4**5"), `formatter ate operators: ${html}`);
    assert.ok(!html.includes("<strong>"), `phantom bold in excerpt: ${html}`);
  });
});
