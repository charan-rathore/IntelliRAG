import { contentTokens } from "./text";

// Okapi BM25 over an inverted index. Term frequencies and postings are
// computed once at build time; a query scores only the chunks that contain
// at least one query term (a chunk with none scores 0 and was dropped before
// too), so per-query cost is O(postings of the query terms), not O(corpus).
// Scores are numerically identical to the previous per-query recount.
export class BM25Index {
  private k1 = 1.5;
  private b = 0.75;
  private ids: string[] = [];
  private texts: string[] = [];
  private tfs: Map<string, number>[] = [];
  private lengths: number[] = [];
  private avgLen = 0;
  private df = new Map<string, number>();
  private postings = new Map<string, number[]>();

  constructor(chunks: Array<{ id: string; text: string }>) {
    for (const chunk of chunks) {
      const tokens = contentTokens(chunk.text);
      if (!tokens.length) continue;
      const i = this.ids.length;
      this.ids.push(chunk.id);
      this.texts.push(chunk.text);
      this.lengths.push(tokens.length);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.tfs.push(tf);
      for (const term of tf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
        let list = this.postings.get(term);
        if (!list) this.postings.set(term, (list = []));
        list.push(i);
      }
    }
    const n = this.ids.length;
    if (!n) return;
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / n;
  }

  search(query: string, topK: number): Array<{ id: string; text: string; score: number }> {
    const q = contentTokens(query);
    if (!q.length || !this.ids.length) return [];
    const candidates = new Set<number>();
    for (const term of q) for (const i of this.postings.get(term) ?? []) candidates.add(i);
    const scored: Array<{ i: number; score: number }> = [];
    for (const i of [...candidates].sort((a, b) => a - b)) {
      const score = this.score(q, this.tfs[i]!, this.lengths[i]!);
      if (score > 0) scored.push({ i, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ i, score }) => ({
      id: this.ids[i]!,
      text: this.texts[i]!,
      score,
    }));
  }

  private score(query: string[], tf: Map<string, number>, len: number): number {
    let score = 0;
    const n = this.ids.length;
    for (const term of query) {
      const df = this.df.get(term);
      if (!df) continue;
      const freq = tf.get(term) ?? 0;
      if (!freq) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denom = freq + this.k1 * (1 - this.b + (this.b * len) / this.avgLen);
      score += idf * ((freq * (this.k1 + 1)) / denom);
    }
    return score;
  }
}
