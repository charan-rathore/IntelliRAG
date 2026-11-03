/**
 * In-memory nearest-neighbour search over L2-normalised embeddings, with no
 * dependencies and no vector database.
 *
 * Vectors live in one contiguous Float32Array (dim * n), so an exact search
 * is a single pass of dot products. For larger corpora a 1-bit sign code per
 * dimension (binary quantisation) gives a Hamming-distance first pass that
 * reads 32x less memory; the best `rescore` candidates are then re-scored
 * exactly with the float vectors, so the returned scores are always true
 * cosine similarities. Exact search is used below `binaryFrom` vectors,
 * where it is already fast.
 */
export type VectorHit = { id: string; score: number };

const POP8 = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) POP8[i] = (i & 1) + POP8[i >> 1]!;
function popcount32(x: number): number {
  return POP8[x & 255]! + POP8[(x >>> 8) & 255]! + POP8[(x >>> 16) & 255]! + POP8[x >>> 24]!;
}

export class VectorIndex {
  readonly dim: number;
  readonly ids: string[];
  private vecs: Float32Array;
  private codes: Uint32Array;
  private words: number;

  constructor(ids: string[], vectors: ArrayLike<number>[]) {
    if (ids.length !== vectors.length) throw new Error("ids and vectors differ in length");
    this.ids = [...ids];
    this.dim = vectors[0]?.length ?? 0;
    const n = vectors.length;
    this.vecs = new Float32Array(n * this.dim);
    this.words = Math.ceil(this.dim / 32);
    this.codes = new Uint32Array(n * this.words);
    for (let i = 0; i < n; i += 1) {
      const v = vectors[i]!;
      if (v.length !== this.dim)
        throw new Error(`vector ${i} has ${v.length} dimensions, expected ${this.dim}`);
      let norm = 0;
      for (let d = 0; d < this.dim; d += 1) norm += v[d]! * v[d]!;
      norm = Math.sqrt(norm) || 1;
      const off = i * this.dim;
      for (let d = 0; d < this.dim; d += 1) {
        const x = v[d]! / norm;
        this.vecs[off + d] = x;
        if (x > 0) this.codes[i * this.words + (d >>> 5)]! |= 1 << (d & 31);
      }
    }
  }

  get size(): number {
    return this.ids.length;
  }

  /** Bytes held by the float vectors and the sign codes. */
  get bytes(): { float: number; binary: number } {
    return { float: this.vecs.byteLength, binary: this.codes.byteLength };
  }

  private normalised(query: ArrayLike<number>): Float32Array {
    if (query.length !== this.dim)
      throw new Error(`query has ${query.length} dimensions, expected ${this.dim}`);
    let norm = 0;
    for (let d = 0; d < this.dim; d += 1) norm += query[d]! * query[d]!;
    norm = Math.sqrt(norm) || 1;
    const q = new Float32Array(this.dim);
    for (let d = 0; d < this.dim; d += 1) q[d] = query[d]! / norm;
    return q;
  }

  private dot(q: Float32Array, i: number): number {
    const off = i * this.dim;
    let s = 0;
    for (let d = 0; d < this.dim; d += 1) s += q[d]! * this.vecs[off + d]!;
    return s;
  }

  /** Exact top k by cosine similarity. */
  exact(query: ArrayLike<number>, k: number): VectorHit[] {
    const q = this.normalised(query);
    const n = this.ids.length;
    const scores = new Float32Array(n);
    for (let i = 0; i < n; i += 1) scores[i] = this.dot(q, i);
    return topK(scores, k).map((i) => ({ id: this.ids[i]!, score: scores[i]! }));
  }

  /**
   * Hamming first pass over sign codes, then exact rescoring of the best
   * `rescore` candidates (default max(10k, 100)).
   */
  binary(query: ArrayLike<number>, k: number, rescore = Math.max(10 * k, 100)): VectorHit[] {
    const q = this.normalised(query);
    const w = this.words;
    const qc = new Uint32Array(w);
    for (let d = 0; d < this.dim; d += 1) if (q[d]! > 0) qc[d >>> 5]! |= 1 << (d & 31);
    const n = this.ids.length;
    // similarity = matching bits; higher is closer
    const sim = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      let diff = 0;
      const off = i * w;
      for (let j = 0; j < w; j += 1) diff += popcount32((qc[j]! ^ this.codes[off + j]!) >>> 0);
      sim[i] = this.dim - diff;
    }
    const pool = topK(sim, Math.min(n, rescore));
    const exact = new Float32Array(pool.length);
    pool.forEach((i, j) => (exact[j] = this.dot(q, i)));
    return topK(exact, k).map((j) => ({ id: this.ids[pool[j]!]!, score: exact[j]! }));
  }

  /** Exact below `binaryFrom` vectors, binary first pass with rescoring above. */
  search(
    query: ArrayLike<number>,
    k: number,
    opts: { binaryFrom?: number; rescore?: number } = {},
  ): VectorHit[] {
    return this.ids.length >= (opts.binaryFrom ?? 20000)
      ? this.binary(query, k, opts.rescore)
      : this.exact(query, k);
  }
}

/** Indices of the k largest values, best first; ties keep index order. */
export function topK(values: ArrayLike<number>, k: number): number[] {
  const n = values.length;
  k = Math.max(0, Math.min(k, n));
  if (!k) return [];
  // bounded min-heap of indices
  const heap: number[] = [];
  const worse = (a: number, b: number) =>
    values[a]! < values[b]! || (values[a] === values[b] && a > b);
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!worse(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && worse(heap[l]!, heap[m]!)) m = l;
      if (r < heap.length && worse(heap[r]!, heap[m]!)) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m]!, heap[i]!];
      i = m;
    }
  };
  for (let i = 0; i < n; i += 1) {
    if (heap.length < k) {
      heap.push(i);
      up(heap.length - 1);
    } else if (worse(heap[0]!, i)) {
      heap[0] = i;
      down(0);
    }
  }
  return heap.sort((a, b) => values[b]! - values[a]! || a - b);
}
