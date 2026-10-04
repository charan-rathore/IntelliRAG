/** Answer-quality check on the multi-repo set: same question, same model, two contexts (plain BM25 whole chunks vs IntelliRAG).
 * Free dry run (no key, no network): npx tsx scripts/multi-repo-answer-eval.ts --dry
 * Paid run: EVAL_MAX_USD=2 node --env-file=.env.local --import tsx scripts/multi-repo-answer-eval.ts --generate
 * Judge:    EVAL_MAX_USD=2 ... --judge (after --generate; reuses the same output dir and shared cap)
 * Resume: same EVAL_OUTPUT. Never logs the key. Needs OPENROUTER_API_KEY only for --generate/--judge.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chunkDocument } from "../src/lib/rag/chunking";
import { retrieveFromRows, type SearchRow } from "../src/lib/rag/retrieve-core";
import { BM25Index } from "../src/lib/rag/bm25";
import { GROUNDED_SYSTEM } from "../src/lib/rag/evidence";

const argv = process.argv;
const dry = argv.includes("--dry"), generate = argv.includes("--generate"), judge = argv.includes("--judge");
const model = process.env.EVAL_MODEL || "google/gemini-3.7-flash";
const judgeModel = process.env.EVAL_JUDGE_MODEL || model;
const cap = Number(process.env.EVAL_MAX_USD);
if ((generate || judge) && (!process.env.OPENROUTER_API_KEY || !Number.isFinite(cap) || cap <= 0))
  throw Error("Paid runs need OPENROUTER_API_KEY and a positive EVAL_MAX_USD. No requests sent.");
const evalRoot = resolve(import.meta.dirname, "../../eval");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const out = resolve(process.env.EVAL_OUTPUT || evalRoot + "/multi-repo/runs/answers");
mkdirSync(out, { recursive: true });

const multi = JSON.parse(readFileSync(evalRoot + "/multi-repo/dataset.json", "utf8"));
const pq = JSON.parse(readFileSync(evalRoot + "/repo-support/dataset.json", "utf8"));
const sources: Record<string, string> = {};
for (const [name, s] of Object.entries<any>(multi.sources)) {
  const t = readFileSync(evalRoot + "/multi-repo/" + s.file, "utf8");
  if (hash(t) !== s.sha256) throw Error("Fixture hash mismatch: " + name);
  sources[name] = t;
}
sources["p-queue"] = readFileSync(evalRoot + "/repo-support/fixtures/p-queue.md", "utf8");
if (hash(sources["p-queue"]) !== pq.source.sha256) throw Error("p-queue hash mismatch");
// Same 82 answerable questions as the retrieval study (58 development + 24 holdout) plus their unanswerable probes.
const cases: any[] = [
  ...pq.cases.map((c: any) => ({ id: "p-queue:" + c.id, source: "p-queue", split: "development", answerable: c.answerable, question: c.question, evidence: c.evidence })),
  ...multi.cases,
];
const ix: Record<string, { rows: SearchRow[]; byId: Map<string, SearchRow>; bm25: BM25Index }> = {};
for (const [name, text] of Object.entries(sources)) {
  const rows: SearchRow[] = chunkDocument(text, { filepath: "readme.md" }).map((c) => ({
    title: name + " README", slug: name, indexedAt: null, corpusId: "eval-" + name,
    chunk: { id: `${name}:${c.ordinal}`, document_id: name, ordinal: c.ordinal, text: c.text, token_count: c.tokenCount, heading: c.heading,
      embedding: null, embedding_model: null, content_hash: hash(c.text), created_at: "", filepath: c.filepath, language: c.language,
      symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: "eval-" + name } as any,
  }));
  ix[name] = { rows, byId: new Map(rows.map((r) => [r.chunk.id, r])), bm25: new BM25Index(rows.map((r) => ({ id: r.chunk.id, text: `${r.title}\n${r.chunk.text}` }))) };
}

const ledgerFile = out + "/ledger.json";
const ledger: any = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : { spentUSD: 0, calls: 0 };
const saveLedger = () => writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
let catalog: any;
async function loadCatalog(id: string) {
  const r = await fetch("https://openrouter.ai/api/v1/models");
  if (!r.ok) throw Error("Cannot verify live model catalog");
  const m = (await r.json()).data.find((x: any) => x.id === id);
  if (!m) throw Error("Model absent from OpenRouter catalog: " + id);
  return m;
}
const catalogs: Record<string, any> = {};
async function complete(useModel: string, system: string, user: string, maxTokens = 4096) {
  catalogs[useModel] ??= await loadCatalog(useModel);
  const p = catalogs[useModel].pricing;
  const reserve = (system.length + user.length + 1024) * Number(p.prompt) + maxTokens * Number(p.completion);
  if (!Number.isFinite(reserve) || reserve <= 0) throw Error("Cannot establish a conservative request cost");
  if (ledger.spentUSD + reserve > cap) throw Error(`Spending cap reached (spent ${ledger.spentUSD.toFixed(4)} of ${cap})`);
  ledger.spentUSD += reserve; saveLedger(); // write-ahead reservation
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: useModel, provider: { allow_fallbacks: false }, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, seed: 42, max_tokens: maxTokens, reasoning: { effort: "low" } }),
    signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw Error(`Provider HTTP ${r.status}`); // reservation stays charged
  const data = await r.json();
  if (typeof data.usage?.cost === "number") ledger.spentUSD += data.usage.cost - reserve;
  ledger.calls++; saveLedger();
  const ch = data.choices?.[0];
  if (!ch?.message?.content || ch.finish_reason !== "stop") throw Error("Missing or truncated model answer");
  return { answer: ch.message.content as string, usage: data.usage };
}

const ctxFor = (c: any) => {
  const x = ix[c.source]!;
  let tokens = 0;
  const bm = x.bm25.search(c.question, 8).map((r) => r.id).filter((id) => {
    const n = x.byId.get(id)!.chunk.token_count;
    if (tokens + n > 1400) return false;
    tokens += n; return true;
  });
  const res = retrieveFromRows({ query: c.question, queryVector: null, mode: "keyword", topK: 8, embeddingModel: null, rows: x.rows,
    corpusScope: { kind: "corpus", corpusId: "eval-" + c.source }, storage: { backend: "ephemeral", durable: false, denseAvailable: false, warning: null } });
  return {
    bm25: { texts: bm.map((id) => x.byId.get(id)!.chunk.text), title: x.rows[0]!.title, refused: false },
    intellirag: { texts: res.chunks.map((k) => k.text), title: x.rows[0]!.title, refused: res.evidence === "insufficient" },
  };
};
const prompt = (c: any, texts: string[], title: string) =>
  `Sources:\n${texts.map((t, i) => `[Source ${i + 1}] ${title}\n${t}`).join("\n\n")}\n\nQuestion: ${c.question}\n\nAnswer with a complete, readable response:`;

const JUDGE_SYS = `You grade one answer to a documentation question. You are given the question, the reference passage from the docs (the ground truth), and the answer. Reply with exactly one line of JSON: {"verdict":"correct"|"partial"|"wrong"|"abstained","note":"<=15 words"}.
correct = the answer states what the reference passage says and adds nothing contradicting it. partial = the answer is on topic but misses or blurs the key fact. wrong = it contradicts the reference or invents a different answer. abstained = it says the information is not in the sources (or similar). Grade only against the reference passage.`;
const judgePrompt = (c: any, answer: string) => `Question: ${c.question}\n\nReference passage(s):\n${c.evidence.map((e: any) => "- " + e.quote).join("\n")}\n\nAnswer:\n${answer}`;
const unanswerableJudge = (c: any, answer: string) => ({ verdict: /^\s*Not in the indexed corpus/i.test(answer) ? "abstained" : "answered", note: "unanswerable probe" });

const results: any[] = existsSync(out + "/results.json") ? JSON.parse(readFileSync(out + "/results.json", "utf8")) : [];
const save = () => writeFileSync(out + "/results.json", JSON.stringify(results, null, 2));
const arms = ["bm25", "intellirag"] as const;
let est = { calls: 0, chars: 0 };
for (const [i, c] of cases.entries()) {
  const ctx = ctxFor(c);
  let row = results.find((r) => r.id === c.id);
  if (!row) { row = { id: c.id, split: c.split, answerable: c.answerable, question: c.question, answers: {}, judged: {} }; results.push(row); }
  for (const arm of [...arms.slice(i % 2), ...arms.slice(0, i % 2)]) {
    const a = ctx[arm];
    const p = prompt(c, a.texts, a.title);
    if (arm === "intellirag" && a.refused) { row.answers[arm] ??= { answer: "Not in the indexed corpus.", gate: true }; continue; }
    est.calls++; est.chars += GROUNDED_SYSTEM.length + p.length;
    if (generate && !row.answers[arm]) {
      row.answers[arm] = { ...(await complete(model, GROUNDED_SYSTEM, p)), gate: false }; save();
    }
    if (judge && row.answers[arm] && !row.judged[arm]) {
      if (!c.answerable) row.judged[arm] = unanswerableJudge(c, row.answers[arm].answer);
      else {
        const j = await complete(judgeModel, JUDGE_SYS, judgePrompt(c, row.answers[arm].answer), 1024);
        let v: any; try { v = JSON.parse(j.answer.trim().replace(/^```json|```$/g, "")); } catch { v = { verdict: "unparsed", note: j.answer.slice(0, 60) }; }
        row.judged[arm] = v;
      }
      save();
    }
  }
  if (judge) for (const arm of arms) if (row.answers[arm] && row.judged[arm] === undefined && !c.answerable) row.judged[arm] = unanswerableJudge(c, row.answers[arm].answer);
}
save();
if (dry) {
  const tok = est.chars / 4;
  console.log(`DRY RUN: ${cases.length} cases, ${est.calls} model calls would be made in --generate (gate-refused answers skipped).`);
  console.log(`Approx input ${Math.round(tok)} tokens; at $0.75/M input + ~400 output tokens/call at $3.75/M ≈ $${(tok * 0.75e-6 + est.calls * 400 * 3.75e-6).toFixed(2)} for generation; judge pass about $${(cases.filter((c) => c.answerable).length * 2 * (500 * 0.75e-6 + 80 * 3.75e-6)).toFixed(2)}.`);
  process.exit(0);
}
if (judge) {
  const tab: Record<string, Record<string, Record<string, number>>> = {};
  for (const r of results) for (const arm of arms) {
    const v = r.judged?.[arm]?.verdict; if (!v) continue;
    const k = r.answerable ? "answerable" : "unanswerable";
    ((tab[k] ??= {})[arm] ??= {})[v] = ((tab[k]![arm]![v]) ?? 0) + 1;
  }
  console.log(JSON.stringify(tab, null, 1));
}
console.log(`Spent so far (conservative ledger): $${ledger.spentUSD.toFixed(4)} of cap ${Number.isFinite(cap) ? cap : "n/a"}; calls ${ledger.calls}. Output: ${out}`);
