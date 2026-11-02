import { contentTokens } from "./text";

/**
 * Okapi BM25 over an inverted index. Scores are identical to scoring every
 * document term by term (same terms, same order of addition, same tie order),
 * but a query only touches the documents that contain one of its terms, and
 * term frequencies are counted once at build time instead of on every query.
 */
export class BM25Index {
  private k1 = 1.5;
  private b = 0.75;
  private ids: string[] = [];
  private texts: string[] = [];
  private lengths: number[] = [];
  private avgLen = 0;
  private df = new Map<string, number>();
  // term -> parallel arrays of document index (ascending) and term frequency
  private postings = new Map<string, { docs: number[]; tf: number[] }>();

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
      for (const [term, freq] of tf) {
        let p = this.postings.get(term);
        if (!p) this.postings.set(term, (p = { docs: [], tf: [] }));
        p.docs.push(i);
        p.tf.push(freq);
      }
    }
    const n = this.ids.length;
    if (!n) return;
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / n;
    for (const [term, p] of this.postings) this.df.set(term, p.docs.length);
  }

  get size(): number {
    return this.ids.length;
  }

  search(query: string, topK: number): Array<{ id: string; text: string; score: number }> {
    const q = contentTokens(query);
    const n = this.ids.length;
    if (!q.length || !n) return [];
    const scores = new Float64Array(n);
    const touched: number[] = [];
    for (const term of q) {
      const p = this.postings.get(term);
      if (!p) continue;
      const df = p.docs.length;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let j = 0; j < p.docs.length; j += 1) {
        const i = p.docs[j]!;
        const freq = p.tf[j]!;
        const denom = freq + this.k1 * (1 - this.b + (this.b * this.lengths[i]!) / this.avgLen);
        if (scores[i] === 0) touched.push(i);
        scores[i] += idf * ((freq * (this.k1 + 1)) / denom);
      }
    }
    touched.sort((a, b) => a - b);
    const scored = touched.filter((i) => scores[i]! > 0).map((i) => ({ i, score: scores[i]! }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ i, score }) => ({
      id: this.ids[i]!,
      text: this.texts[i]!,
      score,
    }));
  }
}
