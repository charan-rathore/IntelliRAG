import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QUERY_STOPWORDS, GENERIC_OPS_TERMS, contentTokens, tokenize, stemToken } from "./text.ts";
import { isQueryStopword, isGenericOpsTerm } from "./perfect-sets.generated.ts";

// Exhaustive short-string universe: every lowercase string up to length 3,
// plus digits, forces the lookup through occupied and empty slots alike.
function* shortStrings(): Generator<string> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  yield "";
  for (const a of alphabet) yield a;
  for (const a of alphabet) for (const b of alphabet) yield a + b;
  for (const a of alphabet) for (const b of alphabet) for (const c of alphabet) yield a + b + c;
}

function nearMisses(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    out.push(w + "s", w + "ing", w.slice(1), w.slice(0, -1), "x" + w, w.toUpperCase());
    if (w.length > 2) out.push(w[1] + w[0] + w.slice(2)); // transpose first two chars
  }
  return out;
}

describe("perfect-hash token sets", () => {
  it("finds every member of both sets", () => {
    for (const w of QUERY_STOPWORDS) assert.ok(isQueryStopword(w), `stopword ${w}`);
    for (const w of GENERIC_OPS_TERMS) assert.ok(isGenericOpsTerm(w), `ops term ${w}`);
  });

  it("matches Set.has exactly on the exhaustive short-string universe", () => {
    for (const s of shortStrings()) {
      assert.equal(isQueryStopword(s), QUERY_STOPWORDS.has(s), `stopword(${JSON.stringify(s)})`);
      assert.equal(isGenericOpsTerm(s), GENERIC_OPS_TERMS.has(s), `ops(${JSON.stringify(s)})`);
    }
  });

  it("matches Set.has on near-misses, case variants and unicode", () => {
    const probes = [
      ...nearMisses([...QUERY_STOPWORDS]),
      ...nearMisses([...GENERIC_OPS_TERMS]),
      "münchen", "naïve", "東京", "\u0000", "a\u0308", "thé", "THE", "The",
    ];
    for (const s of probes) {
      assert.equal(isQueryStopword(s), QUERY_STOPWORDS.has(s), `stopword(${JSON.stringify(s)})`);
      assert.equal(isGenericOpsTerm(s), GENERIC_OPS_TERMS.has(s), `ops(${JSON.stringify(s)})`);
    }
  });

  it("contentTokens keeps exact behavior after the swap", () => {
    const samples = [
      "How do I handle timeouts and memory limits in the cluster?",
      "The quick brown fox jumps over 13 lazy dogs, München-style!",
      "please describe the failure pattern between nodes and servers",
      "",
      "a an in on of to do be by it is as or we me my i",
    ];
    for (const s of samples) {
      const viaSet = s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
      const expected = viaSet.filter((t) => t.length > 1 && !QUERY_STOPWORDS.has(t));
      const actual = (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? []).filter(
        (t) => t.length > 1 && !isQueryStopword(t),
      );
      assert.deepEqual(actual, expected, s);
    }
    // end-to-end equivalence of the real function against a Set-based copy
    const reference = (text: string) =>
      tokenize(text)
        .filter((t) => t.length > 1 && !QUERY_STOPWORDS.has(t))
        .map(stemToken);
    for (const s of samples) {
      assert.deepEqual(
        contentTokens(s).map((t) => t),
        reference(s).map((t) => t),
        `contentTokens(${JSON.stringify(s)}) filter stage`,
      );
    }
  });
});
