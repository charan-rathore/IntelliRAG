/** Multi-repository retrieval diagnostic: IntelliRAG keyword pipeline vs plain BM25 under the same token budget.
 * Run from web: npx tsx scripts/multi-repo-eval.ts [--json out.json]
 * Reports required-evidence recall per split (development vs locked holdout), paired bootstrap CI, refusal on unanswerable probes. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chunkDocument } from "../src/lib/rag/chunking";
import { retrieveFromRows, type SearchRow } from "../src/lib/rag/retrieve-core";
import { BM25Index } from "../src/lib/rag/bm25";

const evalRoot = resolve(import.meta.dirname, "../../eval");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
type Evidence = { quote: string };
type Case = {
  id: string;
  source: string;
  split: string;
  answerable: boolean;
  question: string;
  evidence: Evidence[];
};

const multi = JSON.parse(readFileSync(evalRoot + "/multi-repo/dataset.json", "utf8"));
const pq = JSON.parse(readFileSync(evalRoot + "/repo-support/dataset.json", "utf8"));
const sources: Record<string, { text: string; split: string }> = {};
for (const [name, s] of Object.entries<any>(multi.sources)) {
  const text = readFileSync(evalRoot + "/multi-repo/" + s.file, "utf8");
  if (hash(text) !== s.sha256) throw Error("Fixture hash mismatch: " + name);
  sources[name] = { text, split: s.split };
}
const pqText = readFileSync(evalRoot + "/repo-support/fixtures/p-queue.md", "utf8");
if (hash(pqText) !== pq.source.sha256) throw Error("p-queue hash mismatch");
sources["p-queue"] = { text: pqText, split: "development" };
const cases: Case[] = [
  ...pq.cases.map((c: any) => ({
    id: "p-queue:" + c.id,
    source: "p-queue",
    split: "development",
    answerable: c.answerable,
    question: c.question,
    evidence: c.evidence,
  })),
  ...multi.cases,
];

const indexes: Record<
  string,
  { rows: SearchRow[]; bm25: BM25Index; byId: Map<string, SearchRow> }
> = {};
for (const [name, s] of Object.entries(sources)) {
  const rows: SearchRow[] = chunkDocument(s.text, { filepath: "readme.md" }).map((c) => ({
    title: name + " README",
    slug: name,
    indexedAt: null,
    corpusId: "eval-" + name,
    chunk: {
      id: `${name}:${c.ordinal}`,
      document_id: name,
      ordinal: c.ordinal,
      text: c.text,
      token_count: c.tokenCount,
      heading: c.heading,
      embedding: null,
      embedding_model: null,
      content_hash: hash(c.text),
      created_at: "",
      filepath: c.filepath,
      language: c.language,
      symbol: c.symbol,
      chunk_kind: c.chunkKind,
      corpus_id: "eval-" + name,
    } as any,
  }));
  indexes[name] = {
    rows,
    byId: new Map(rows.map((r) => [r.chunk.id, r])),
    bm25: new BM25Index(rows.map((r) => ({ id: r.chunk.id, text: `${r.title}\n${r.chunk.text}` }))),
  };
}
const recallText = (texts: string[], gold: Evidence[]) =>
  gold.filter((e) => texts.some((t) => normalize(t).includes(normalize(e.quote)))).length /
  gold.length;

const rows: any[] = [];
for (const c of cases) {
  const ix = indexes[c.source];
  let tokens = 0;
  const base = ix.bm25
    .search(c.question, 8)
    .map((r) => r.id)
    .filter((id) => {
      const n = ix.byId.get(id)!.chunk.token_count;
      if (tokens + n > 1400) return false;
      tokens += n;
      return true;
    });
  const res = retrieveFromRows({
    query: c.question,
    queryVector: null,
    mode: "keyword",
    topK: 8,
    embeddingModel: null,
    rows: ix.rows,
    corpusScope: { kind: "corpus", corpusId: "eval-" + c.source },
    storage: { backend: "ephemeral", durable: false, denseAvailable: false, warning: null },
  });
  const ids = res.chunks.map((x) => x.chunkId);
  const lean = retrieveFromRows({
    query: c.question,
    queryVector: null,
    mode: "keyword",
    topK: 8,
    embeddingModel: null,
    rows: ix.rows,
    compactMinUnitShare: 0.2,
    corpusScope: { kind: "corpus", corpusId: "eval-" + c.source },
    storage: { backend: "ephemeral", durable: false, denseAvailable: false, warning: null },
  });
  rows.push({
    id: c.id,
    source: c.source,
    split: c.split,
    answerable: c.answerable,
    bm25: c.answerable
      ? recallText(
          base.map((id) => ix.byId.get(id)!.chunk.text),
          c.evidence,
        )
      : null,
    rag: c.answerable
      ? recallText(
          res.chunks.map((x) => x.text),
          c.evidence,
        )
      : null,
    leanRag: c.answerable
      ? recallText(
          lean.chunks.map((x) => x.text),
          c.evidence,
        )
      : null,
    leanTokens: lean.contextTokens,
    refused: res.evidence === "insufficient",
    bm25Tokens: tokens,
    ragTokens: res.contextTokens,
    ragChunks: ids.length,
  });
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
function boot(diffs: number[]) {
  // seeded paired bootstrap of mean difference
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const m: number[] = [];
  for (let i = 0; i < 10000; i++) {
    let t = 0;
    for (let j = 0; j < diffs.length; j++) t += diffs[Math.floor(rnd() * diffs.length)];
    m.push(t / diffs.length);
  }
  m.sort((a, b) => a - b);
  return [m[250], m[9749]];
}
const pct = (x: number) => (x * 100).toFixed(1) + "%";
const summary: any = {};
const final = process.argv.includes("--final");
for (const group of final ? ["development", "holdout", "all"] : ["development"]) {
  const sel = rows.filter((r) => group === "all" || r.split === group);
  const ans = sel.filter((r) => r.answerable),
    un = sel.filter((r) => !r.answerable);
  const diffs = ans.map((r) => r.rag - r.bm25);
  const [lo, hi] = boot(diffs);
  summary[group] = {
    answerable: ans.length,
    bm25: mean(ans.map((r) => r.bm25)),
    rag: mean(ans.map((r) => r.rag)),
    diff: mean(diffs),
    ci95: [lo, hi],
    bm25Complete: ans.filter((r) => r.bm25 === 1).length,
    ragComplete: ans.filter((r) => r.rag === 1).length,
    wins: diffs.filter((d) => d > 0).length,
    losses: diffs.filter((d) => d < 0).length,
    unanswerable: un.length,
    refused: un.filter((r) => r.refused).length,
    answerableWronglyRefused: ans.filter((r) => r.refused).length,
    bm25Tokens: mean(ans.map((r) => r.bm25Tokens)),
    ragTokens: mean(ans.map((r) => r.ragTokens)),
    lean: mean(ans.map((r) => r.leanRag)),
    leanTokens: mean(ans.map((r) => r.leanTokens)),
  };
  console.log(
    `${group.padEnd(12)} n=${ans.length} BM25 ${pct(summary[group].bm25)} (${summary[group].bm25Complete} complete) | IntelliRAG ${pct(summary[group].rag)} (${summary[group].ragComplete} complete) | diff ${(summary[group].diff * 100).toFixed(1)}pp CI[${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}] W/L ${summary[group].wins}/${summary[group].losses} | refused ${summary[group].refused}/${un.length} unanswerable, wrongly refused ${summary[group].answerableWronglyRefused} answerable | mean context tokens BM25 ${summary[group].bm25Tokens.toFixed(0)} vs IntelliRAG ${summary[group].ragTokens.toFixed(0)}\n             lean mode (compactMinUnitShare 0.2): recall ${pct(summary[group].lean)} at ${summary[group].leanTokens.toFixed(0)} tokens`,
  );
}
const bySource: Record<string, number[]> = {};
for (const r of rows.filter((r) => r.answerable && (final || r.split === "development")))
  (bySource[r.source] ??= []).push(r.rag - r.bm25);
console.log(
  "per-source mean diff (pp):",
  Object.entries(bySource)
    .map(([k, v]) => `${k} ${(mean(v) * 100).toFixed(1)}`)
    .join(", "),
);
const out = process.argv.indexOf("--json");
if (out > 0)
  writeFileSync(
    process.argv[out + 1],
    JSON.stringify(
      { summary, rows: final ? rows : rows.filter((r) => r.split === "development") },
      null,
      1,
    ),
  );
if (process.argv.includes("--rows"))
  for (const r of rows.filter((r) => r.split === "development" && r.answerable && r.rag !== r.bm25))
    console.log("DIFF", r.id, r.bm25, r.rag);
