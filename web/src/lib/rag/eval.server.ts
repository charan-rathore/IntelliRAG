/**
 * Evaluation suite. Retrieval rank/MRR/context precision/citation-phrase
 * entailment are deterministic. Gemini-as-judge is combined with those checks
 * and is never the sole gate. skipCache is required so graph cache cannot hide
 * retrieval bugs.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GOLDEN_SAMPLES, ADVERSARIAL_SAMPLES, CLAIMED_BASELINE, QUALITY_GATE } from "./eval-data";
import { completeOnce } from "./gemini.server";
import { embedPendingBatch } from "./ingest.server";
import { resolveRuntime } from "./keys.server";
import { runQueryStream, type QueryEvent } from "./query.server";
import { pendingEmbeddingCount } from "./store.server";
import { tokenize } from "./text";
import { EMBEDDING_MODEL } from "./types";
import type { Citation, LayerLatencies, RetrievalCandidate, RetrievedChunk } from "./types";

const REPORT_PATH = "/workspace/.data/eval-report.json";
const TMP_REPORT_PATH = "/tmp/intellirag-eval-report.json";

type QueryResult = {
  answer: string;
  chunks: RetrievedChunk[];
  candidates: RetrievalCandidate[];
  citations: Citation[];
  latencies: LayerLatencies;
  embeddingModel: string | null;
  model: string;
  refused: boolean;
  error?: string;
};

export type EvalSample = {
  sampleId: string;
  question: string;
  documentId: string;
  answer: string;
  error: string | null;
  retrieved: string[];
  retrieval_mrr: number;
  retrieval_recall: number;
  retrieval_precision: number;
  context_precision: number;
  context_recall: number;
  faithfulness: number;
  citation_precision: number;
  hallucination_rate: number;
  answer_relevancy: number;
  answer_correctness: number;
  rank1_hit: number;
  citation_entailment: number;
  e2e_ms: number;
  latencies: LayerLatencies;
  embeddingModel: string | null;
  model: string;
};

export type EvalReport = {
  verdict: "pass" | "fail";
  failures: string[];
  beatsBaseline: string[];
  claimedBaseline: typeof CLAIMED_BASELINE;
  metrics: Record<string, number>;
  qualityGate: typeof QUALITY_GATE;
  indexedChunks: number;
  embeddingVia: string;
  generationVia: string;
  durationMs: number;
  samples: EvalSample[];
  adversarial: Array<{ question: string; passed: boolean; answer: string }>;
};

export type EvalSummary = {
  verdict: "pass" | "fail";
  failures: string[];
  beatsBaseline: string[];
  metrics: Record<string, number>;
  claimedBaseline: typeof CLAIMED_BASELINE;
  qualityGate: typeof QUALITY_GATE;
  durationMs: number;
  embeddingVia: string;
  generationVia: string;
};

function writeReport(report: EvalReport) {
  const json = JSON.stringify(report, null, 2);
  for (const path of [REPORT_PATH, TMP_REPORT_PATH]) {
    try {
      mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      writeFileSync(path, json, { mode: 0o600 });
    } catch {
      // ignore
    }
  }
}

export function loadLastEval(): EvalReport | null {
  for (const path of [REPORT_PATH, TMP_REPORT_PATH]) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as EvalReport;
    } catch {
      // try next
    }
  }
  return null;
}

export function loadLastEvalSummary(): EvalSummary | null {
  const report = loadLastEval();
  if (!report) return null;
  return {
    verdict: report.verdict,
    failures: report.failures,
    beatsBaseline: report.beatsBaseline,
    metrics: report.metrics,
    claimedBaseline: report.claimedBaseline,
    qualityGate: report.qualityGate,
    durationMs: report.durationMs,
    embeddingVia: report.embeddingVia,
    generationVia: report.generationVia,
  };
}

async function queryOnce(question: string): Promise<QueryResult> {
  const result: QueryResult = {
    answer: "",
    chunks: [],
    candidates: [],
    citations: [],
    latencies: {},
    embeddingModel: null,
    model: "",
    refused: false,
  };
  await runQueryStream(
    { question, retrievalMode: "hybrid", topK: 5, skipCache: true, corpus: "seed-lab" },
    (event: QueryEvent) => {
      if (event.type === "sources") {
        result.chunks = event.chunks;
        result.candidates = event.candidates;
      }
      if (event.type === "done") {
        result.answer = event.answer;
        result.citations = event.citations;
        result.latencies = event.latencies;
        result.embeddingModel = event.embeddingModel;
        result.model = event.model;
        result.refused = event.refused;
        if (event.candidates?.length) result.candidates = event.candidates;
      }
      if (event.type === "error") result.error = event.message;
    },
  );
  return result;
}

function includesPhrase(haystack: string, phrase: string) {
  return haystack.toLowerCase().includes(phrase.toLowerCase());
}

function relevantChunk(chunk: RetrievedChunk, gold: (typeof GOLDEN_SAMPLES)[number]) {
  return (
    chunk.slug === gold.documentId ||
    gold.referenceContext.some((p) => includesPhrase(chunk.text, p))
  );
}

/** RAGAS context precision: mean Precision@k over relevant ranks, not raw hit-rate. */
function ragasContextPrecision(chunks: RetrievedChunk[], gold: (typeof GOLDEN_SAMPLES)[number]) {
  if (!chunks.length) return 0;
  const flags = chunks.map((c) => relevantChunk(c, gold));
  const relevant = flags.filter(Boolean).length;
  if (!relevant) return 0;
  let acc = 0;
  flags.forEach((isRel, i) => {
    if (!isRel) return;
    acc += flags.slice(0, i + 1).filter(Boolean).length / (i + 1);
  });
  return acc / relevant;
}

function tokenF1(a: string, b: string) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const p = inter / ta.size;
  const r = inter / tb.size;
  if (p + r === 0) return 0;
  return (2 * p * r) / (p + r);
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

type Judge = {
  faithfulness: number;
  answerRelevancy: number;
  answerCorrectness: number;
};

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /429|rate|temporar|timeout|503|502/i.test(message);
      if (!retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("retry failed");
}

async function judgeSample(input: {
  question: string;
  groundTruth: string;
  context: string;
  answer: string;
}): Promise<Judge> {
  const raw = await withRetry(() =>
    completeOnce({
      system:
        "You are a strict RAGAS-style grader. Score only from the given context and gold answer. Reply with JSON only.",
      user: `Question: ${input.question}

Gold answer: ${input.groundTruth}

Retrieved context:
${input.context}

Model answer:
${input.answer}

Return JSON:
{"faithfulness":0-1,"answer_relevancy":0-1,"answer_correctness":0-1}
Rules:
- faithfulness = fraction of model-answer claims supported by retrieved context (not gold).
- answer_relevancy = does the model answer address the question.
- answer_correctness = semantic overlap with the gold answer.
Numbers only, 0 to 1.`,
    }),
  );
  const jsonText = raw.replace(/```json|```/g, "").trim();
  const match = jsonText.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match?.[0] ?? "{}") as {
    faithfulness?: number;
    answer_relevancy?: number;
    answer_correctness?: number;
  };
  const clamp = (n: unknown) => {
    const v = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
  };
  return {
    faithfulness: clamp(parsed.faithfulness),
    answerRelevancy: clamp(parsed.answer_relevancy),
    answerCorrectness: clamp(parsed.answer_correctness),
  };
}

export async function runRagasEval(): Promise<EvalReport> {
  const started = Date.now();
  const runtime = resolveRuntime();
  if (!runtime.embed || !runtime.generate) {
    throw new Error("Server key missing. Save an OpenRouter or Gemini key in Settings first.");
  }

  let pending = await pendingEmbeddingCount(EMBEDDING_MODEL);
  let indexed = 0;
  while (pending > 0) {
    const batch = await embedPendingBatch();
    indexed += batch.embedded;
    pending = batch.remaining;
    if (batch.embedded === 0) break;
  }

  const samples: EvalSample[] = [];
  for (const gold of GOLDEN_SAMPLES) {
    const t0 = performance.now();
    const result = await withRetry(() => queryOnce(gold.question));
    const e2e = performance.now() - t0;
    const context = result.chunks.map((c) => c.text).join("\n");
    const ranked = result.candidates.length ? result.candidates : result.chunks;
    const relevantRanks = ranked
      .map((c, i) => (c.slug === gold.documentId || gold.extraDocuments?.includes(c.slug) ? i + 1 : 0))
      .filter((n) => n > 0);
    const retrievalRecall = relevantRanks.length ? 1 : 0;
    const retrievalPrecision = result.chunks.length
      ? result.chunks.filter(
          (c) => c.slug === gold.documentId || gold.extraDocuments?.includes(c.slug),
        ).length / result.chunks.length
      : 0;
    const retrievalMrr = relevantRanks.length ? 1 / relevantRanks[0]! : 0;
    const rank1Hit = ranked[0]?.slug === gold.documentId || Boolean(gold.extraDocuments?.includes(ranked[0]?.slug ?? ""));
    const forbiddenHit = (gold.forbiddenInContext ?? []).some((slug) =>
      result.chunks.some((c) => c.slug === slug),
    );
    const phraseHits = gold.referenceContext.filter((p) => includesPhrase(context, p));
    const contextRecall = gold.referenceContext.length
      ? phraseHits.length / gold.referenceContext.length
      : 0;
    const contextPrecision = forbiddenHit
      ? 0
      : ragasContextPrecision(result.chunks, gold);
    const citedHay = result.citations
      .map((c) => result.chunks.find((ch) => ch.chunkId === c.chunkId)?.text ?? "")
      .join("\n");
    const entailHay = citedHay || context;
    const entailHits = gold.referenceContext.filter((p) => includesPhrase(entailHay, p));
    const citationEntailment = result.citations.length
      ? gold.referenceContext.length
        ? entailHits.length / gold.referenceContext.length
        : 1
      : gold.taskType === "negative_evidence"
        ? /does not mention|does not recommend|not mention/i.test(result.answer)
          ? 1
          : 0
        : result.refused
          ? 1
          : 0;
    const citationPrecision = result.citations.length
      ? result.citations.filter((c) => result.chunks.some((ch) => ch.chunkId === c.chunkId || ch.title === c.title))
          .length / result.citations.length
      : result.refused || /not in the indexed corpus/i.test(result.answer)
        ? 1
        : result.answer
          ? 0
          : 1;
    const lexicalCorrectness = tokenF1(result.answer, gold.groundTruth);

    let judged: Judge = {
      faithfulness: contextRecall,
      answerRelevancy: tokenF1(result.answer, gold.question),
      answerCorrectness: lexicalCorrectness,
    };
    if (result.answer && !result.error) {
      try {
        judged = await judgeSample({
          question: gold.question,
          groundTruth: gold.groundTruth,
          context: context.slice(0, 6000),
          answer: result.answer,
        });
      } catch {
        // keep lexical fallback
      }
    }

    samples.push({
      sampleId: gold.sampleId,
      question: gold.question,
      documentId: gold.documentId,
      answer: result.answer,
      error: result.error ?? null,
      retrieved: ranked.map((c) => c.slug),
      retrieval_mrr: retrievalMrr,
      retrieval_recall: retrievalRecall,
      retrieval_precision: retrievalPrecision,
      context_precision: contextPrecision,
      context_recall: contextRecall,
      faithfulness: judged.faithfulness,
      citation_precision: citationPrecision,
      hallucination_rate: 1 - judged.faithfulness,
      answer_relevancy: judged.answerRelevancy,
      answer_correctness: judged.answerCorrectness,
      rank1_hit: rank1Hit ? 1 : 0,
      citation_entailment: citationEntailment,
      e2e_ms: e2e,
      latencies: result.latencies,
      embeddingModel: result.embeddingModel,
      model: result.model,
    });
  }

  const adversarial = [];
  for (const question of ADVERSARIAL_SAMPLES) {
    const result = await queryOnce(question);
    const passed =
      result.refused ||
      /^not in the indexed corpus/i.test(result.answer.trim()) ||
      /not in the indexed corpus/i.test(result.answer);
    adversarial.push({ question, passed, answer: result.answer.slice(0, 180) });
  }

  const metrics = {
    retrieval_mrr: mean(samples.map((s) => s.retrieval_mrr)),
    retrieval_recall: mean(samples.map((s) => s.retrieval_recall)),
    retrieval_precision: mean(samples.map((s) => s.retrieval_precision)),
    context_precision: mean(samples.map((s) => s.context_precision)),
    context_recall: mean(samples.map((s) => s.context_recall)),
    faithfulness: mean(samples.map((s) => s.faithfulness)),
    citation_precision: mean(samples.map((s) => s.citation_precision)),
    hallucination_rate: mean(samples.map((s) => s.hallucination_rate)),
    answer_relevancy: mean(samples.map((s) => s.answer_relevancy)),
    answer_correctness: mean(samples.map((s) => s.answer_correctness)),
    citation_entailment: mean(samples.map((s) => s.citation_entailment)),
    rank1_hit_rate: mean(
      samples
        .filter((s) => GOLDEN_SAMPLES.find((g) => g.sampleId === s.sampleId)?.mustRank1)
        .map((s) => s.rank1_hit),
    ),
    e2e_latency_p95_ms: percentile(
      samples.map((s) => s.e2e_ms),
      95,
    ),
    adversarial_pass_rate: adversarial.length
      ? adversarial.filter((a) => a.passed).length / adversarial.length
      : 1,
  };

  const failures: string[] = [];
  const beatsBaseline: string[] = [];
  (Object.keys(QUALITY_GATE) as Array<keyof typeof QUALITY_GATE>).forEach((key) => {
    const value = metrics[key];
    const floor = QUALITY_GATE[key];
    const higher = key !== "hallucination_rate";
    const pass = higher ? value >= floor : value <= floor;
    if (!pass) {
      failures.push(`${key}=${value.toFixed(3)} failed gate ${higher ? ">=" : "<="} ${floor}`);
    }
    const baseline = CLAIMED_BASELINE[key as keyof typeof CLAIMED_BASELINE];
    if (typeof baseline === "number") {
      const better = higher ? value >= baseline : value <= baseline;
      if (better) beatsBaseline.push(key);
    }
  });

  const report: EvalReport = {
    verdict: failures.length ? "fail" : "pass",
    failures,
    beatsBaseline,
    claimedBaseline: CLAIMED_BASELINE,
    metrics,
    qualityGate: QUALITY_GATE,
    indexedChunks: indexed,
    embeddingVia: runtime.embed.provider,
    generationVia: runtime.generate.provider,
    durationMs: Date.now() - started,
    samples,
    adversarial,
  };
  writeReport(report);
  return report;
}
