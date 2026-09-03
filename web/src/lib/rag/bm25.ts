import { contentTokens } from "./text";

export class BM25Index {
  private k1 = 1.5;
  private b = 0.75;
  private ids: string[] = [];
  private texts: string[] = [];
  private docs: string[][] = [];
  private lengths: number[] = [];
  private avgLen = 0;
  private df = new Map<string, number>();

  constructor(chunks: Array<{ id: string; text: string }>) {
    for (const chunk of chunks) {
      const tokens = contentTokens(chunk.text);
      if (!tokens.length) continue;
      this.ids.push(chunk.id);
      this.texts.push(chunk.text);
      this.docs.push(tokens);
      this.lengths.push(tokens.length);
    }
    const n = this.docs.length;
    if (!n) return;
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / n;
    for (const tokens of this.docs) {
      for (const term of new Set(tokens)) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
  }

  search(query: string, topK: number): Array<{ id: string; text: string; score: number }> {
    const q = contentTokens(query);
    if (!q.length || !this.docs.length) return [];
    const scored: Array<{ i: number; score: number }> = [];
    for (let i = 0; i < this.docs.length; i += 1) {
      const score = this.score(q, this.docs[i]!, this.lengths[i]!);
      if (score > 0) scored.push({ i, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ i, score }) => ({
      id: this.ids[i]!,
      text: this.texts[i]!,
      score,
    }));
  }

  private score(query: string[], doc: string[], len: number): number {
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    const n = this.docs.length;
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
