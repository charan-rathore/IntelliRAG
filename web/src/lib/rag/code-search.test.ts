import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CodeSearchIndex, DEFAULT_SEARCH, codeTokens, didYouMean, learnAssociations, parseSearchQuery, snippet, splitIdentifier, suggest, surfaceVocab, type SearchDoc } from "./code-search.ts";

const DOCS: SearchDoc[] = [
  { id: "a", path: "src/queue.ts", lang: "ts", kind: "code", body: "export function pauseQueue(q) {\n  // stop pulling new jobs\n  q.isPaused = true;\n}" },
  { id: "b", path: "src/queue.ts", lang: "ts", kind: "code", body: "export function resumeQueue(q) {\n  q.isPaused = false;\n  drain(q);\n}" },
  { id: "c", path: "lib/http_client.py", lang: "py", kind: "code", body: "def parse_json_response(resp):\n    \"\"\"Decode a JSON body.\"\"\"\n    return json.loads(resp.text)" },
  { id: "d", path: "docs/README.md", lang: "md", kind: "prose", body: "Pause the queue to hold jobs; resume to drain them again." },
];

describe("tokenizing code", () => {
  it("splits camelCase, snake_case and acronyms", () => {
    assert.deepEqual(splitIdentifier("parseJSONResponse"), ["parse", "json", "response"]);
    assert.deepEqual(splitIdentifier("http_client"), ["http", "client"]);
  });
  it("keeps the whole identifier alongside its parts when asked", () => {
    const t = codeTokens("pauseQueue", { keepWhole: true });
    assert.ok(t.includes("pause") && t.includes("queue") && t.includes("pausequeue"));
  });
});

describe("operators", () => {
  it("parses filters, phrases and exclusions like a search engine", () => {
    const p = parseSearchQuery('resume lang:ts path:src "isPaused = false" -drain sym:resume kind:code');
    assert.deepEqual(p.words, ["resume"]);
    assert.deepEqual(p.phrases, ["isPaused = false"]);
    assert.deepEqual(p.exclude, ["drain"]);
    assert.equal(p.lang, "ts");
    assert.equal(p.path, "src");
    assert.equal(p.symbol, "resume");
    assert.equal(p.kind, "code");
  });
  it("leaves unknown key:value words as text", () => {
    assert.deepEqual(parseSearchQuery("http://x").words, ["http://x"]);
  });
});

describe("ranking and filters", () => {
  const idx = new CodeSearchIndex(DOCS);
  it("finds a function from a natural-language query via its identifier", () => {
    assert.equal(idx.search("pause queue")[0]!.id, "a");
    assert.equal(idx.search("parse json response")[0]!.id, "c");
  });
  it("applies lang, path, kind and exclusion filters", () => {
    assert.ok(idx.search("queue lang:py").every((h) => h.id === "c") );
    assert.deepEqual(idx.search("queue kind:prose").map((h) => h.id), ["d"]);
    assert.ok(!idx.search("queue -drain").some((h) => h.id === "b" || h.id === "d"));
    assert.ok(idx.search("queue path:src").every((h) => h.id === "a" || h.id === "b"));
  });
  it("requires quoted phrases", () => {
    assert.deepEqual(idx.search('queue "isPaused = false"').map((h) => h.id), ["b"]);
  });
  it("reports which typed terms matched", () => {
    assert.ok(idx.search("resume queue")[0]!.matched.includes("resume"));
  });
});

describe("learned associations", () => {
  it("lets a confirmed wording reach code that shares none of its words", () => {
    const pairs = [
      ...Array.from({ length: 4 }, () => ({ query: "freeze worker", doc: DOCS[0]!.body })),
      ...Array.from({ length: 4 }, () => ({ query: "decode body", doc: DOCS[2]!.body })),
    ];
    const assoc = learnAssociations(pairs, { minCount: 2 });
    const plain = new CodeSearchIndex(DOCS).search("freeze worker");
    const learned = new CodeSearchIndex(DOCS, DEFAULT_SEARCH, assoc).search("freeze worker");
    assert.equal(plain.length, 0);
    assert.equal(learned[0]?.id, "a");
  });
});

describe("did you mean, suggest, snippet", () => {
  const vocab = surfaceVocab(DOCS);
  it("corrects a typo to a corpus word and stays quiet when spelled right", () => {
    assert.equal(didYouMean("pasue queue", vocab), "pause queue");
    assert.equal(didYouMean("pause queue", vocab), null);
  });
  it("completes prefixes, preferring questions people asked", () => {
    const s = suggest("pa", vocab, { asked: ["pause the queue on deploy"] });
    assert.equal(s[0], "pause the queue on deploy");
    assert.ok(s.some((x) => x.startsWith("pa")));
  });
  it("cuts the best window and marks the hits", () => {
    const sn = snippet(DOCS[1]!.body, ["drain"], 2);
    assert.ok(sn.text.includes("drain(q)"));
    const [s, e] = sn.marks[0]!;
    assert.equal(sn.text.slice(s, e).toLowerCase(), "drain");
  });
});
