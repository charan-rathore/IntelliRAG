import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BM25Index } from "./bm25.ts";
import { SEED_DOCUMENTS } from "./corpus.ts";
import { contentTokens } from "./text.ts";
import { VectorIndex, topK } from "./vector-index.ts";

// The scoring loop BM25Index used before the inverted index, kept as the
// reference: the inverted index must return the same ids, order and scores.
function referenceSearch(chunks: Array<{ id: string; text: string }>, query: string, k: number) {
  const docs = chunks
    .map((c) => ({ id: c.id, tokens: contentTokens(c.text) }))
    .filter((d) => d.tokens.length);
  const n = docs.length;
  const avg = docs.reduce((a, d) => a + d.tokens.length, 0) / n;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = contentTokens(query);
  const out: Array<{ id: string; score: number }> = [];
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      const dfi = df.get(term);
      if (!dfi || !f) continue;
      const idf = Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5));
      score += idf * ((f * 2.5) / (f + 1.5 * (1 - 0.75 + (0.75 * d.tokens.length) / avg)));
    }
    if (score > 0) out.push({ id: d.id, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe("BM25 inverted index", () => {
  it("scores exactly like the per-document loop on the seed corpus", () => {
    const chunks = SEED_DOCUMENTS.flatMap((d, i) =>
      d.body.split(/\n\n+/).map((p, j) => ({ id: `${i}:${j}`, text: `${d.title}\n${p}` })),
    );
    const index = new BM25Index(chunks);
    const queries = [
      "how do I rotate an API key",
      "rate limit retry backoff",
      "billing invoice",
      "nothing-matches-zzz",
      "the the a",
    ];
    for (const q of queries) {
      const got = index.search(q, 20).map(({ id, score }) => ({ id, score }));
      assert.deepEqual(got, referenceSearch(chunks, q, 20), q);
    }
  });

  it("scores exactly like the per-document loop on random text, repeated terms included", () => {
    const r = rng(7);
    const words = Array.from({ length: 300 }, (_, i) => `term${i}`);
    const chunks = Array.from({ length: 400 }, (_, i) => ({
      id: `c${i}`,
      text: Array.from(
        { length: 5 + Math.floor(r() * 60) },
        () => words[Math.floor(r() ** 2 * words.length)],
      ).join(" "),
    }));
    const index = new BM25Index(chunks);
    for (let k = 0; k < 30; k += 1) {
      const q = Array.from(
        { length: 1 + Math.floor(r() * 6) },
        () => words[Math.floor(r() * words.length)],
      ).join(" ");
      assert.deepEqual(
        index.search(q, 50).map(({ id, score }) => ({ id, score })),
        referenceSearch(chunks, q, 50),
        q,
      );
    }
  });
});

describe("vector index", () => {
  const r = rng(11);
  const dim = 64;
  const vecs = Array.from({ length: 3000 }, () => Array.from({ length: dim }, () => r() * 2 - 1));
  const ids = vecs.map((_, i) => `v${i}`);
  const index = new VectorIndex(ids, vecs);

  it("exact search returns true cosine similarities, best first", () => {
    const q = vecs[42]!.map((x) => x * 3); // scale does not matter
    const hits = index.exact(q, 5);
    assert.equal(hits[0]!.id, "v42");
    assert.ok(Math.abs(hits[0]!.score - 1) < 1e-5);
    for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i - 1]!.score >= hits[i]!.score);
    // brute force agreement
    const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    const cos = vecs.map((v) => v.reduce((a, x, d) => a + x * q[d]!, 0) / (norm(v) * norm(q)));
    const want = topK(cos, 5).map((i) => ids[i]);
    assert.deepEqual(
      hits.map((h) => h.id),
      want,
    );
  });

  it("binary first pass with rescoring finds the exact neighbours and keeps exact scores", () => {
    let agree = 0;
    for (let t = 0; t < 50; t += 1) {
      const base = vecs[Math.floor(r() * vecs.length)]!;
      const q = base.map((x) => x + (r() - 0.5) * 0.4);
      const exact = index.exact(q, 10);
      const bin = index.binary(q, 10, 300);
      assert.equal(bin[0]!.id, exact[0]!.id);
      agree += bin.filter((h) => exact.some((e) => e.id === h.id)).length;
      for (const h of bin) {
        const e = index.exact(q, 3000).find((x) => x.id === h.id)!;
        assert.ok(Math.abs(e.score - h.score) < 1e-6);
      }
    }
    assert.ok(agree / 500 > 0.9, `recall@10 ${agree / 500}`);
    assert.equal(index.bytes.float / index.bytes.binary, 32);
  });

  it("rejects mismatched dimensions", () => {
    assert.throws(() => index.exact([1, 2, 3], 1), /dimensions/);
    assert.throws(() => new VectorIndex(["a", "b"], [[1, 0], [1]]), /dimensions/);
  });

  it("topK keeps index order on ties", () => {
    assert.deepEqual(topK([1, 3, 3, 2, 3], 3), [1, 2, 4]);
    assert.deepEqual(topK([], 3), []);
  });
});
