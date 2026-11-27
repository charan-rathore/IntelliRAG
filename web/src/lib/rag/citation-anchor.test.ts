import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAnswerHtml, formatSourceExcerptsHtml } from "./answer.tsx";
import { citationAnchorId, citationAnchorHref } from "./citation-anchor";
import type { Citation } from "./types";

const citations: Citation[] = [
  {
    sourceIndex: 1,
    title: "Distinct source",
    chunkId: "chunk",
    documentId: "doc",
    textSnippet: "Distinct source",
  },
];

describe("conversation citation targets", () => {
  it("keeps the same source number local to its answer", () => {
    const first = formatAnswerHtml("First answer [Source 1]", citations, "turn-first");
    const second = formatAnswerHtml("Second answer [Source 1]", citations, "turn-second");
    assert.match(first, /href="#cite-turn-first-1"/);
    assert.match(second, /href="#cite-turn-second-1"/);
    assert.ok(!second.includes('href="#cite-turn-first-1"'));
    assert.match(second, />\[1\]<\/a>/);
  });

  it("scopes literal excerpt chips as well as answer chips", () => {
    const html = formatSourceExcerptsHtml(
      [{ text: "Literal [Source 2] <tag>", title: "Source" }],
      "turn-second",
    );
    assert.match(html, /href="#cite-turn-second-1"/);
    assert.equal((html.match(/cite-chip/g) ?? []).length, 1);
    assert.match(html, /Literal \[Source 2\] &lt;tag&gt;/);
  });

  it("does not create chips inside code when a scope is supplied", () => {
    const html = formatAnswerHtml("`[Source 1]` then [Source 1]", citations, "turn-first");
    assert.equal((html.match(/cite-chip/g) ?? []).length, 1);
    assert.match(html, /<code>\[Source 1\]<\/code>/);
    assert.match(html, /href="#cite-turn-first-1"/);
  });

  it("encodes punctuation, Unicode, quotes and HTML-looking scope text without collisions", () => {
    for (const scope of [
      "turn space",
      "turn%20space",
      "turn/#?&",
      'turn" onclick="alert(1)',
      "turn-测试-🪐",
      "<script>",
    ]) {
      const id = citationAnchorId(1, scope);
      const href = citationAnchorHref(1, scope);
      assert.equal(decodeURIComponent(href.slice(1)), id);
      assert.equal(/\s|"|<|>/.test(id), false);
      const html = formatAnswerHtml("[Source 1]", citations, scope);
      assert.ok(html.includes(`href="${href}"`));
      assert.equal((html.match(/<a /g) ?? []).length, 1);
      assert.ok(
        formatSourceExcerptsHtml([{ text: "Text", title: "Source" }], scope).includes(
          `href="${href}"`,
        ),
      );
    }
    assert.notEqual(citationAnchorId(1, "turn space"), citationAnchorId(1, "turn%20space"));
  });

  it("carries scope through lists, notes and fenced-code boundaries", () => {
    const html = formatAnswerHtml(
      "- item [Source 1]\n_note [Source 1]_\n```\n[Source 1]\n```\nlast [Source 1]",
      citations,
      "turn-second",
    );
    assert.equal((html.match(/href="#cite-turn-second-1"/g) ?? []).length, 3);
    assert.match(html, /<code>\[Source 1\]<\/code>/);
  });

  it("preserves standalone rendering for callers without a conversation scope", () => {
    assert.match(formatAnswerHtml("[Source 1]", citations), /href="#cite-1"/);
    assert.match(formatSourceExcerptsHtml([{ text: "Text", title: "Source" }]), /href="#cite-1"/);
  });
});
