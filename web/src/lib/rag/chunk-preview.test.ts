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

  it("cleans the live p-queue card text but leaves the mid-line fence marker visible", () => {
    // The ``` sits mid-line, so it is ambiguous as a fence: it stays
    // verbatim (markdown visible over altered evidence); only the clean
    // inline spans and heading hashes are cleaned.
    const raw =
      "eClass}); ``` `p-queue` will call corresponding methods to put and get operations from this queue.## FAQ #### How do the `concurrency` and `intervalCap` options affect each other?";
    assert.equal(
      chunkPreview(raw),
      "eClass}); ``` p-queue will call corresponding methods to put and get operations from this queue. FAQ How do the concurrency and intervalCap options affect each other?",
    );
  });

  it("keeps code content from fenced blocks, drops whole-line matching fences and language tags", () => {
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

  it("is single-pass: previews come from source, never from prior output", () => {
    // Explicit tradeoff: a code span whose content looks like markdown is
    // preserved verbatim on the first pass, but feeding the OUTPUT back in
    // would clean it (protection ends at the delimiters, which are gone).
    // Cards always render from source chunk text, so this never happens in
    // the app - literal preservation on the real pass is what matters.
    const raw = "Use `**bold**` for emphasis.";
    assert.equal(chunkPreview(raw), "Use **bold** for emphasis.");
  });
});

describe("chunkPreview code evidence preservation", () => {
  it("keeps dunder identifiers literal in prose (they are content, not bold)", () => {
    assert.equal(chunkPreview("The __init__ method calls __post_init__ here."), "The __init__ method calls __post_init__ here.");
  });

  it("keeps exponent operators inside fenced code verbatim", () => {
    assert.equal(
      chunkPreview("Compute:\n```python\nx = 2**3 + 4**5\n```\nDone."),
      "Compute: x = 2**3 + 4**5 Done.",
    );
  });

  it("keeps inline code spans verbatim while dropping the backticks", () => {
    assert.equal(chunkPreview("Call `__init__(**kw)` last."), "Call __init__(**kw) last.");
  });

  it("raw code chunks keep operators, dunders and comment markers", () => {
    assert.equal(
      chunkPreview("def __init__(self):  # ctor\n    return 2**3 * self.x", "code"),
      "def __init__(self): # ctor return 2**3 * self.x",
    );
    // markdown-looking tokens in a raw code chunk are still content
    assert.equal(chunkPreview("## not a heading in code", "code"), "## not a heading in code");
    assert.equal(chunkPreview("**not bold in code**", "code"), "**not bold in code**");
  });

  it("combined formatting: prose emphasis strips, code stays literal", () => {
    assert.equal(
      chunkPreview("**Summary:** uses `__init__` and `2**3`, see [docs](https://x.example)."),
      "Summary: uses __init__ and 2**3, see docs.",
    );
  });

  it("still strips real underscore emphasis phrases", () => {
    assert.equal(chunkPreview("This is __very important__ here."), "This is very important here.");
  });

  it("keeps multiplication inside fenced code even combined with prose emphasis", () => {
    assert.equal(
      chunkPreview("**Note:**\n```\na = 2**3 + 4**5  # exponents\n```"),
      "Note: a = 2**3 + 4**5 # exponents",
    );
  });

  it("treats content after an unterminated fence as code, verbatim", () => {
    assert.equal(
      chunkPreview("Intro\n```python\nx = 2**3  # **important**"),
      "Intro x = 2**3 # **important**",
    );
  });

  it("handles tilde fences like backtick fences", () => {
    assert.equal(
      chunkPreview("Run:\n~~~python\nx = 2**3\n~~~\nDone."),
      "Run: x = 2**3 Done.",
    );
  });

  it("handles language tags with symbols (c++)", () => {
    assert.equal(
      chunkPreview("```c++\nint *p = &x;\n```"),
      "int *p = &x;",
    );
  });
});

describe("chunkPreview ambiguity stays verbatim", () => {
  it("never drops bytes around real NUL characters", () => {
    //  escapes are real control bytes in these strings.
    const withNul = "before\u0000after `x = 1` end";
    assert.ok(withNul.includes("\u0000"), "test input really contains a NUL byte");
    assert.equal(chunkPreview(withNul), "before\u0000after x = 1 end");
    // NUL adjacent to a code span cannot alias or eat the span's content:
    const tricky = "0\u0000 `2**3` \u00001";
    assert.equal(chunkPreview(tricky), "0\u0000 2**3 \u00001");
  });

  it("a closing fence must use the same marker as the opening fence", () => {
    // backtick fence, tilde line inside: the ~~~ is code content, kept
    assert.equal(chunkPreview("```fence\nkeep~~~"), "keep~~~");
    assert.equal(chunkPreview("```fence\nkeep~~~\n```"), "keep~~~");
    // tilde fence, backtick line inside: the ``` is code content, kept
    assert.equal(chunkPreview("~~~fence\nkeep```"), "keep```");
    assert.equal(chunkPreview("~~~fence\nkeep```\n~~~"), "keep```");
  });

  it("a mid-line fence run inside code is not a closing fence", () => {
    assert.equal(
      chunkPreview("```\ncode with ``` inline\n```"),
      "code with ``` inline",
    );
  });

  it("mid-line fence markers in prose stay visible and delete nothing", () => {
    const t = "Prose before ~~~ literal ~~~after stays";
    assert.equal(chunkPreview(t), t);
    const b = "a ``` b";
    assert.equal(chunkPreview(b), b);
  });

  it("multi-backtick inline spans stay verbatim rather than being misquoted", () => {
    const t = "Call ``a`b`` now";
    assert.equal(chunkPreview(t), t);
    const t2 = "x `` code `` y";
    assert.equal(chunkPreview(t2), t2);
  });

  it("a stray unmatched single backtick stays visible", () => {
    const t = "it's a `stray one here";
    assert.equal(chunkPreview(t), t);
  });

  it("paired single-backtick spans still strip, one pair at a time", () => {
    assert.equal(chunkPreview("use `a` and `b` together"), "use a and b together");
  });
});


describe("source-card preview integration", () => {
  it("passes raw-code metadata at both preview render sites", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../components/rag/source-inspector.tsx", import.meta.url), "utf8");
    assert.match(source, /chunkPreview\(candidate\.text, candidate\.chunkKind\)/);
    assert.match(source, /chunkPreview\(c\.text, c\.chunkKind\)/);
  });
});
