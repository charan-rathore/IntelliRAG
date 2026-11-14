import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "./chunking.ts";

// Audit regressions: H5/H6 sections, overlap word boundaries, section bleed.
const words = (prefix: string, n: number, sep = " ") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(sep);

describe("section-aware overlap", () => {
  it("level 5 and 6 headings own their sections", () => {
    const doc = `# Guide\n\n${words("intro", 200)}\n\n##### Concurrency\n\n${words("conc", 200)}\n\n###### Rate limit\n\n${words("rate", 200)}`;
    const chunks = chunkDocument(doc, { chunkSize: 120, overlap: 20 });
    const conc = chunks.find((c) => c.text.includes("conc150"));
    const rate = chunks.find((c) => c.text.includes("rate150"));
    assert.equal(conc?.heading, "Guide > Concurrency");
    assert.equal(rate?.heading, "Guide > Concurrency > Rate limit");
  });

  it("overlap never bleeds into the next section", () => {
    const doc = `## Alpha\n\n${words("alpha", 300)}\n\n## Beta\n\n${words("beta", 300)}`;
    const chunks = chunkDocument(doc, { chunkSize: 120, overlap: 30 });
    const beta = chunks.find((c) => /\bbeta0\b/.test(c.text));
    assert.ok(beta);
    assert.doesNotMatch(beta.text, /alpha\d/);
  });

  it("repeated identical headings are separate section occurrences", () => {
    const doc = `## Notes\n\n${words("first", 300)}\n\n## Notes\n\n${words("second", 300)}`;
    const chunks = chunkDocument(doc, { chunkSize: 120, overlap: 30 });
    const opener = chunks.filter((c) => c.text.startsWith("## Notes"));
    assert.equal(opener.length, 2);
    assert.doesNotMatch(opener[1]!.text, /first\d/);
  });

  for (const [name, sep] of [["spaces", " "], ["tabs", "\t"], ["newlines", "\n"]] as const) {
    it(`headingless prose keeps whole-word overlap (${name})`, () => {
      const doc = words("w", 2000, sep);
      const chunks = chunkDocument(doc, { chunkSize: 120, overlap: 30 });
      assert.ok(chunks.length > 2);
      const vocab = new Set(doc.split(/\s+/));
      for (const c of chunks.slice(1)) {
        const first = c.text.split(/\s+/)[0]!;
        assert.ok(vocab.has(first), `chunk starts mid-word: ${JSON.stringify(first)}`);
      }
      // overlap still present: chunk i+1 starts with words from chunk i
      const firstWord = chunks[1]!.text.split(/\s+/)[0]!;
      assert.ok(chunks[0]!.text.includes(firstWord), "headingless prose lost its overlap");
    });
  }

  it("unspaced scripts keep overlap and never split a surrogate pair", () => {
    const doc = Array.from({ length: 6000 }, (_, i) => String.fromCodePoint(i % 2 ? 0x4e00 + i : 0x1f300 + (i % 700))).join("");
    const chunks = chunkDocument(doc, { chunkSize: 120, overlap: 30 });
    assert.ok(chunks.length > 2);
    for (const c of chunks) {
      assert.equal(c.text, c.text.toWellFormed(), "lone surrogate in chunk text");
    }
    const head = chunks[1]!.text.slice(0, 6);
    assert.ok(chunks[0]!.text.includes(head), "unspaced text lost its overlap");
  });
});
