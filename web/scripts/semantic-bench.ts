/**
 * Semantic search vs BM25 on outside-authored retrieval benchmarks (BEIR:
 * corpora, questions and relevance judgements written by others), through
 * the product's own BM25Index, rrfFuse and VectorIndex.
 *
 *   npx tsx scripts/semantic-bench.ts --data <beir dir> [--datasets scifact,nfcorpus,fiqa] [--out file.json]
 *
 * Arms: BM25 (product), dense exact (bge-small, local), dense binary first
 * pass + exact rescoring, hybrid (product RRF of dense + BM25), and hybrid
 * with a cross-encoder over its top 20. Every setting is fixed before the
 * run (model-card pooling and query instruction, product RRF constant,
 * depth 100, rerank depth 20); nothing is tuned on these test judgements.
 * Requires @huggingface/transformers (installed by the bench workflow) and
 * network access to Hugging Face for the first model download.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { BM25Index } from "../src/lib/rag/bm25";
import { linearFuse, rrfFuse } from "../src/lib/rag/ranking";
import { VectorIndex } from "../src/lib/rag/vector-index";
import { LOCAL_EMBED_MODEL, localEmbed, localEmbedStatus } from "../src/lib/rag/local-embed.server";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1]! : d;
};
const dataDir = resolve(arg("--data", ".cache/beir")!);
const datasets = arg("--datasets", "scifact,nfcorpus,fiqa")!.split(",").filter(Boolean);
const outFile = resolve(arg("--out", "semantic-bench.json")!);
const cacheDir = resolve(process.env.RAG_MODEL_CACHE || ".cache/models");
const DEPTH = 100;
const RERANK_DEPTH = 20;
const RERANK_MODEL = process.env.RAG_RERANK_MODEL || "Xenova/ms-marco-MiniLM-L-6-v2";

async function* lines(file: string) {
  for await (const l of createInterface({ input: createReadStream(file) })) if (l.trim()) yield l;
}

async function loadBeir(name: string) {
  const dir = join(dataDir, name);
  const corpus: Array<{ id: string; text: string }> = [];
  for await (const l of lines(join(dir, "corpus.jsonl"))) {
    const d = JSON.parse(l);
    corpus.push({ id: String(d._id), text: `${d.title ?? ""}\n${d.text ?? ""}`.trim() });
  }
  const qrels = new Map<string, Map<string, number>>();
  let header = true;
  for await (const l of lines(join(dir, "qrels", "test.tsv"))) {
    if (header) {
      header = false;
      if (/^query-id/i.test(l)) continue;
    }
    const [q, d, s] = l.split("\t");
    const rel = Number(s);
    if (!q || !d || !(rel > 0)) continue;
    if (!qrels.has(q)) qrels.set(q, new Map());
    qrels.get(q)!.set(d, rel);
  }
  const queries: Array<{ id: string; text: string }> = [];
  for await (const l of lines(join(dir, "queries.jsonl"))) {
    const q = JSON.parse(l);
    if (qrels.has(String(q._id))) queries.push({ id: String(q._id), text: String(q.text) });
  }
  return { corpus, queries, qrels };
}

function metrics(ranked: string[], rel: Map<string, number>) {
  let dcg = 0;
  for (let i = 0; i < Math.min(10, ranked.length); i += 1)
    dcg += (rel.get(ranked[i]!) ?? 0) / Math.log2(i + 2);
  const ideal = [...rel.values()].sort((a, b) => b - a).slice(0, 10);
  const idcg = ideal.reduce((a, g, i) => a + g / Math.log2(i + 2), 0);
  const firstHit = ranked.slice(0, 10).findIndex((id) => rel.has(id));
  const top100 = new Set(ranked.slice(0, 100));
  return {
    ndcg10: idcg ? dcg / idcg : 0,
    mrr10: firstHit < 0 ? 0 : 1 / (firstHit + 1),
    recall100: [...rel.keys()].filter((id) => top100.has(id)).length / rel.size,
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
// paired bootstrap of the mean difference, fixed seed
function pairedCI(a: number[], b: number[], reps = 2000) {
  let seed = 12345;
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const d = a.map((x, i) => x - b[i]!);
  const means: number[] = [];
  for (let k = 0; k < reps; k += 1) {
    let s = 0;
    for (let i = 0; i < d.length; i += 1) s += d[Math.floor(r() * d.length)]!;
    means.push(s / d.length);
  }
  return { diff: mean(d), lo: pct(means, 0.025), hi: pct(means, 0.975) };
}

// Bench-only cross-encoder (the product's reranker is the calibrated heuristic in ranking.ts).
let ce: { tok: any; model: any } | null = null;
async function crossScores(q: string, passages: string[]) {
  if (!ce) {
    const name = "@huggingface/transformers";
    const t: any = await import(/* @vite-ignore */ name);
    t.env.cacheDir = cacheDir;
    ce = {
      tok: await t.AutoTokenizer.from_pretrained(RERANK_MODEL),
      model: await t.AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
        dtype: "q8",
      }),
    };
  }
  const out: number[] = [];
  for (let i = 0; i < passages.length; i += 10) {
    const batch = passages.slice(i, i + 10);
    const inputs = ce.tok(new Array(batch.length).fill(q), {
      text_pair: batch,
      padding: true,
      truncation: true,
      max_length: 384,
    });
    const { logits } = await ce.model(inputs);
    const w = logits.dims.at(-1) ?? 1;
    for (let j = 0; j < batch.length; j += 1) out.push(Number(logits.data[j * w + w - 1]));
  }
  return out;
}

async function docVectors(name: string, corpus: Array<{ id: string; text: string }>) {
  const status = localEmbedStatus();
  const key = `${name}-${LOCAL_EMBED_MODEL.replace(/\W+/g, "_")}-${status.pooling}-${status.dtype}`;
  const file = join(cacheDir, "vectors", key + ".f32");
  mkdirSync(join(cacheDir, "vectors"), { recursive: true });
  if (existsSync(file)) {
    const buf = readFileSync(file);
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const dim = all.length / corpus.length;
    if (Number.isInteger(dim))
      return {
        vectors: corpus.map((_, i) => all.subarray(i * dim, (i + 1) * dim)),
        ms: 0,
        cached: true,
      };
  }
  const t = performance.now();
  const vectors = await localEmbed(
    corpus.map((d) => d.text),
    "document",
  );
  const ms = performance.now() - t;
  const flat = new Float32Array(vectors.length * vectors[0]!.length);
  vectors.forEach((v, i) => flat.set(v, i * v.length));
  writeFileSync(file, Buffer.from(flat.buffer));
  return { vectors, ms, cached: false };
}

const asChunks = (hits: Array<{ id: string; score: number }>) =>
  hits.map((h, i) => ({ chunkId: h.id, score: h.score, rank: i + 1 }) as any);

const report: any = {
  at: new Date().toISOString(),
  model: LOCAL_EMBED_MODEL,
  embed: localEmbedStatus(),
  rerankModel: RERANK_MODEL,
  node: process.version,
  datasets: {},
};

for (const name of datasets) {
  if (!existsSync(join(dataDir, name, "corpus.jsonl"))) {
    console.log(`${name}: not downloaded, skipped`);
    continue;
  }
  const { corpus, queries, qrels } = await loadBeir(name);
  const text = new Map(corpus.map((d) => [d.id, d.text]));
  let t = performance.now();
  const bm25 = new BM25Index(corpus);
  const bm25BuildMs = performance.now() - t;
  const { vectors, ms: embedDocsMs, cached } = await docVectors(name, corpus);
  t = performance.now();
  const index = new VectorIndex(
    corpus.map((d) => d.id),
    vectors,
  );
  const indexBuildMs = performance.now() - t;

  const arms = ["bm25", "dense", "denseBinary", "hybrid", "hybridRerank"] as const;
  const per: Record<string, Array<ReturnType<typeof metrics>>> = Object.fromEntries(
    arms.map((a) => [a, []]),
  );
  const lat: Record<string, number[]> = {
    bm25: [],
    embedQuery: [],
    dense: [],
    denseBinary: [],
    fuse: [],
    rerank: [],
  };
  let binaryAgree = 0;
  const lists: Array<{ dense: Array<{ id: string; score: number }>; kw: Array<{ id: string; score: number }> }> = [];
  for (const q of queries) {
    const rel = qrels.get(q.id)!;
    t = performance.now();
    const kw = bm25.search(q.text, DEPTH);
    lat.bm25!.push(performance.now() - t);
    t = performance.now();
    const [qv] = await localEmbed([q.text], "query");
    lat.embedQuery!.push(performance.now() - t);
    t = performance.now();
    const dense = index.exact(qv!, DEPTH);
    lat.dense!.push(performance.now() - t);
    t = performance.now();
    const bin = index.binary(qv!, DEPTH, 10 * DEPTH);
    lat.denseBinary!.push(performance.now() - t);
    const top10 = new Set(dense.slice(0, 10).map((h) => h.id));
    binaryAgree +=
      bin.slice(0, 10).filter((h) => top10.has(h.id)).length /
      Math.max(1, Math.min(10, dense.length));
    t = performance.now();
    const fused = rrfFuse(asChunks(dense), asChunks(kw), DEPTH).fused.map(
      (c) => c.chunkId as string,
    );
    lat.fuse!.push(performance.now() - t);
    t = performance.now();
    const head = fused.slice(0, RERANK_DEPTH);
    const s = await crossScores(
      q.text,
      head.map((id) => text.get(id)!),
    );
    const reranked = [
      ...head
        .map((id, i) => ({ id, s: s[i]! }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.id),
      ...fused.slice(RERANK_DEPTH),
    ];
    lat.rerank!.push(performance.now() - t);
    per.bm25!.push(
      metrics(
        kw.map((h) => h.id),
        rel,
      ),
    );
    per.dense!.push(
      metrics(
        dense.map((h) => h.id),
        rel,
      ),
    );
    per.denseBinary!.push(
      metrics(
        bin.map((h) => h.id),
        rel,
      ),
    );
    lists.push({ dense, kw });
    per.hybrid!.push(metrics(fused, rel));
    per.hybridRerank!.push(metrics(reranked, rel));
  }
  const summary: any = {
    docs: corpus.length,
    queries: queries.length,
    build: {
      bm25Ms: bm25BuildMs,
      embedDocsMs: cached ? null : embedDocsMs,
      vectorIndexMs: indexBuildMs,
      vectorBytes: index.bytes,
    },
    binaryTop10AgreementWithExact: binaryAgree / queries.length,
    arms: {},
    vsBm25Ndcg10: {},
    latencyMs: Object.fromEntries(
      Object.entries(lat).map(([k, v]) => [k, { p50: pct(v, 0.5), p95: pct(v, 0.95) }]),
    ),
  };
  for (const a of arms) {
    const m = per[a]!;
    summary.arms[a] = {
      ndcg10: mean(m.map((x) => x.ndcg10)),
      mrr10: mean(m.map((x) => x.mrr10)),
      recall100: mean(m.map((x) => x.recall100)),
    };
    if (a !== "bm25")
      summary.vsBm25Ndcg10[a] = pairedCI(
        m.map((x) => x.ndcg10),
        per.bm25!.map((x) => x.ndcg10),
      );
  }

  // Linear fusion with a corpus-level dense weight. Odd-indexed queries are the
  // dev split used to choose alpha; even-indexed queries are the held-out split
  // every arm is compared on. No test query influences alpha.
  const ALPHAS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const isDev = (i: number) => i % 2 === 1;
  const ndcgFor = (alpha: number, idx: number[]) =>
    mean(
      idx.map((i) =>
        metrics(
          linearFuse(lists[i]!.dense, lists[i]!.kw, alpha, DEPTH).map((h) => h.id),
          qrels.get(queries[i]!.id)!,
        ).ndcg10,
      ),
    );
  const devIdx = queries.map((_, i) => i).filter(isDev);
  const holdIdx = queries.map((_, i) => i).filter((i) => !isDev(i));
  const devScores = ALPHAS.map((a) => ({ alpha: a, ndcg10: ndcgFor(a, devIdx) }));
  const bestAlpha = devScores.reduce((b, x) => (x.ndcg10 > b.ndcg10 ? x : b)).alpha;
  const hold = (a: string) => holdIdx.map((i) => per[a]![i]!);
  const holdLinear = holdIdx.map((i) =>
    metrics(
      linearFuse(lists[i]!.dense, lists[i]!.kw, bestAlpha, DEPTH).map((h) => h.id),
      qrels.get(queries[i]!.id)!,
    ),
  );
  summary.holdout = {
    queries: holdIdx.length,
    alpha: bestAlpha,
    devScores,
    arms: {} as Record<string, any>,
  };
  const holdArms: Record<string, Array<ReturnType<typeof metrics>>> = {
    bm25: hold("bm25"),
    dense: hold("dense"),
    hybridRRF: hold("hybrid"),
    hybridLinear: holdLinear,
  };
  for (const [a, m] of Object.entries(holdArms)) {
    summary.holdout.arms[a] = {
      ndcg10: mean(m.map((x) => x.ndcg10)),
      mrr10: mean(m.map((x) => x.mrr10)),
      recall100: mean(m.map((x) => x.recall100)),
      vsBm25: a === "bm25" ? null : pairedCI(m.map((x) => x.ndcg10), holdArms.bm25!.map((x) => x.ndcg10)),
      vsDense: a === "dense" || a === "bm25" ? null : pairedCI(m.map((x) => x.ndcg10), holdArms.dense!.map((x) => x.ndcg10)),
    };
  }
  report.datasets[name] = summary;
  writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
  console.log(`\n### ${name} (${corpus.length} docs, ${queries.length} test queries)\n`);
  console.log("| arm | nDCG@10 | MRR@10 | Recall@100 | nDCG@10 vs BM25 (95% CI) |");
  console.log("|---|---|---|---|---|");
  for (const a of arms) {
    const r = summary.arms[a];
    const c = summary.vsBm25Ndcg10[a];
    console.log(
      `| ${a} | ${r.ndcg10.toFixed(3)} | ${r.mrr10.toFixed(3)} | ${r.recall100.toFixed(3)} | ${c ? `${c.diff >= 0 ? "+" : ""}${c.diff.toFixed(3)} [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}]` : "-"} |`,
    );
  }

  console.log(`\nHeld-out half (${holdIdx.length} queries), alpha=${bestAlpha} chosen on the other half (dev nDCG@10 by alpha: ${devScores.map((d) => `${d.alpha}:${d.ndcg10.toFixed(3)}`).join(" ")})\n`);
  console.log("| arm | nDCG@10 | MRR@10 | Recall@100 | vs BM25 (95% CI) | vs dense (95% CI) |");
  console.log("|---|---|---|---|---|---|");
  const fmt = (c: any) => (c ? `${c.diff >= 0 ? "+" : ""}${c.diff.toFixed(3)} [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}]` : "-");
  for (const [a, r] of Object.entries<any>(summary.holdout.arms)) {
    console.log(`| ${a} | ${r.ndcg10.toFixed(3)} | ${r.mrr10.toFixed(3)} | ${r.recall100.toFixed(3)} | ${fmt(r.vsBm25)} | ${fmt(r.vsDense)} |`);
  }
  const L = summary.latencyMs;
  console.log(
    `\nPer query (ms, p50/p95): BM25 ${L.bm25.p50.toFixed(2)}/${L.bm25.p95.toFixed(2)}; embed query ${L.embedQuery.p50.toFixed(1)}/${L.embedQuery.p95.toFixed(1)}; dense exact ${L.dense.p50.toFixed(2)}/${L.dense.p95.toFixed(2)}; dense binary+rescore ${L.denseBinary.p50.toFixed(2)}/${L.denseBinary.p95.toFixed(2)}; fuse ${L.fuse.p50.toFixed(2)}; cross-encoder top ${RERANK_DEPTH} ${L.rerank.p50.toFixed(0)}/${L.rerank.p95.toFixed(0)}.`,
  );
  console.log(
    `Index: ${(index.bytes.float / 1048576).toFixed(1)} MB float, ${(index.bytes.binary / 1048576).toFixed(2)} MB binary; binary top-10 agreement with exact ${(summary.binaryTop10AgreementWithExact * 100).toFixed(1)}%; documents embedded in ${cached ? "cache" : (embedDocsMs / 1000).toFixed(0) + " s"}.`,
  );
}
writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
console.log(`\nSaved ${outFile}`);
