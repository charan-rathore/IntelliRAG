// Baseline-vs-candidate benchmark for the perfect-hash token membership swap.
// Scope: micro membership checks over tokens from this repo's own docs, plus
// the contentTokens filter stage. Not a SQL/auth/provider measurement; no
// broad production claim. Run: npx tsx scripts/perfect-set-benchmark.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { QUERY_STOPWORDS, GENERIC_OPS_TERMS, tokenize, stemToken } from "../src/lib/rag/text.ts";
import { isQueryStopword, isGenericOpsTerm } from "../src/lib/rag/perfect-sets.generated.ts";

function collect(dir: string, out: string[]): void {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e.startsWith(".")) continue;
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if ([".md", ".ts", ".mjs", ".cjs"].includes(extname(e)) && st.size < 500_000) out.push(readFileSync(p, "utf8"));
  }
}
const files: string[] = [];
collect(new URL("../src", import.meta.url).pathname, files);
collect(new URL("../docs", import.meta.url).pathname, files);
const corpus = files.join("\n");
const tokens = tokenize(corpus);
console.log(`corpus: ${files.length} files, ${corpus.length} chars, ${tokens.length} tokens`);

function bench(label: string, fn: (t: string) => boolean, iters: number): number {
  // warmup
  let acc = 0;
  for (const t of tokens) acc += fn(t) ? 1 : 0;
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) for (const t of tokens) acc += fn(t) ? 1 : 0;
  const ms = performance.now() - t0;
  const nsPerToken = (ms * 1e6) / (iters * tokens.length);
  console.log(`${label}: ${nsPerToken.toFixed(1)} ns/token (${ms.toFixed(1)} ms x ${iters} iters, acc ${acc})`);
  return nsPerToken;
}

const ITERS = 30;
// ABBA ordering to cancel drift.
const a1 = bench("Set.has(stopword)      A", (t) => QUERY_STOPWORDS.has(t), ITERS);
const b1 = bench("perfect(stopword)      B", isQueryStopword, ITERS);
const b2 = bench("perfect(stopword)      B", isQueryStopword, ITERS);
const a2 = bench("Set.has(stopword)      A", (t) => QUERY_STOPWORDS.has(t), ITERS);
const c1 = bench("Set.has(ops)           A", (t) => GENERIC_OPS_TERMS.has(t), ITERS);
const d1 = bench("perfect(ops)           B", isGenericOpsTerm, ITERS);
const d2 = bench("perfect(ops)           B", isGenericOpsTerm, ITERS);
const c2 = bench("Set.has(ops)           A", (t) => GENERIC_OPS_TERMS.has(t), ITERS);

const setStop = (a1 + a2) / 2, perfStop = (b1 + b2) / 2;
const setOps = (c1 + c2) / 2, perfOps = (d1 + d2) / 2;
console.log(`\nstopword: Set ${setStop.toFixed(1)} -> perfect ${perfStop.toFixed(1)} ns/token (${(setStop / perfStop).toFixed(2)}x)`);
console.log(`ops:      Set ${setOps.toFixed(1)} -> perfect ${perfOps.toFixed(1)} ns/token (${(setOps / perfOps).toFixed(2)}x)`);

// contentTokens filter stage end-to-end (tokenize + filter + stem)
function contentTokensWith(text: string, member: (t: string) => boolean): string[] {
  return tokenize(text).filter((t) => t.length > 1 && !member(t)).map(stemToken);
}
for (const [label, member] of [["contentTokens Set.has", (t: string) => QUERY_STOPWORDS.has(t)], ["contentTokens perfect", isQueryStopword]] as const) {
  let n = 0;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) n += contentTokensWith(corpus, member).length;
  const ms = performance.now() - t0;
  console.log(`${label}: ${(ms / 20).toFixed(2)} ms/full-corpus pass (tokens kept ${n / 20})`);
}
