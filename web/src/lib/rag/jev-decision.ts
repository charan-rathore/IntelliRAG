import type { EvidenceKind } from "./types.ts";

/**
 * Optional second opinion on the grounding decision from TypeSafe's Jev
 * (System One typed-decision model). Jev evaluates one Choice question -
 * answer / refuse / clarify - against the packed passages and the lexical
 * gate's own stats, and returns a probability distribution plus confidence.
 *
 * Safety contract (monotonic): Jev can only tighten the decision. It runs
 * only when the lexical gate already said "positive", and a confident
 * "refuse" or "clarify" downgrades to "insufficient" or "ambiguous". It can
 * never upgrade an insufficient or ambiguous gate to positive.
 *
 * Deterministic fallback: Jev is off unless JEV_DECISION=1 and
 * TYPESAFE_API_KEY are set. Any error, timeout, or low-confidence verdict
 * leaves the lexical gate result untouched, so the system runs unchanged
 * (Ollama-only) without the flag.
 */

export type JevVerdict = {
  applied: boolean;
  choice?: "answer" | "refuse" | "clarify";
  confidence?: number;
  probabilities?: Record<string, number>;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
};

export type JevOutcome = { kind: EvidenceKind; verdict: JevVerdict };

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_CONFIDENCE = 0.7;
const PASSAGE_CHAR_LIMIT = 1500;
const MAX_PASSAGES = 5;
const TIMEOUT_MS = 8000;

function enabled(env: NodeJS.ProcessEnv): boolean {
  const flag = env.JEV_DECISION?.toLowerCase();
  return (flag === "1" || flag === "true") && Boolean(env.TYPESAFE_API_KEY);
}

export async function jevSecondOpinion(opts: {
  question: string;
  passages: Array<{ title: string; text: string }>;
  gate: { kind: EvidenceKind; supportHitCount?: number | null; supportTermCount?: number | null };
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<JevOutcome> {
  const env = opts.env ?? process.env;
  const no: JevOutcome = { kind: opts.gate.kind, verdict: { applied: false } };
  if (!enabled(env)) return no;
  // Jev only arbitrates borderline answers; refusals stand on the lexical probes.
  if (opts.gate.kind !== "positive") return no;

  const fetchImpl = opts.fetchImpl ?? fetch;
  const passages = opts.passages.slice(0, MAX_PASSAGES).map((p, i) => ({
    rank: i + 1,
    title: p.title,
    text: p.text.length > PASSAGE_CHAR_LIMIT ? `${p.text.slice(0, PASSAGE_CHAR_LIMIT)}...` : p.text,
  }));
  const state = {
    user_question: opts.question,
    retrieved_passages: passages,
    lexical_gate: {
      decision: opts.gate.kind,
      support_terms_matched: opts.gate.supportHitCount ?? null,
      support_terms_total: opts.gate.supportTermCount ?? null,
    },
  };
  const body = {
    state,
    model: "jev-latest",
    questions: {
      grounding_decision: {
        type: "choice",
        instructions:
          "A retrieval system packed these passages to answer the user question. Decide how the system should proceed. Judge only whether the passages actually establish an answer to the question, not whether they are topically related.",
        criteria: {
          answer: "The passages directly establish what the question asks; a grounded answer can be written.",
          refuse: "The passages do not establish what the question asks; the system should say it cannot answer from the indexed material.",
          clarify: "The passages are ambiguous between multiple readings or only partially on point; the system should surface the ambiguity instead of committing.",
        },
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(JEV_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ...no, verdict: { applied: false, error: `jev http ${res.status}` } };
    }
    const data = (await res.json()) as {
      answers?: { grounding_decision?: { choice?: "answer" | "refuse" | "clarify"; probabilities?: Record<string, number>; confidence?: number } };
      usage?: { input_tokens: number; output_tokens: number };
    };
    const a = data.answers?.grounding_decision;
    const usage = data.usage;
    if (!a?.choice || typeof a.confidence !== "number") {
      return { ...no, verdict: { applied: false, error: "jev malformed response", usage } };
    }
    console.info(
      `[jev] choice=${a.choice} confidence=${a.confidence.toFixed(3)} in=${usage?.input_tokens ?? "?"} out=${usage?.output_tokens ?? "?"}`,
    );
    const threshold = Number(env.JEV_CONFIDENCE ?? DEFAULT_CONFIDENCE) || DEFAULT_CONFIDENCE;
    const verdict: JevVerdict = {
      applied: false,
      choice: a.choice,
      confidence: a.confidence,
      probabilities: a.probabilities,
      usage,
    };
    if (a.confidence < threshold) return { kind: "positive", verdict };
    if (a.choice === "refuse") return { kind: "insufficient", verdict: { ...verdict, applied: true } };
    if (a.choice === "clarify") return { kind: "ambiguous", verdict: { ...verdict, applied: true } };
    return { kind: "positive", verdict };
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError" ? "jev timeout" : `jev error: ${err instanceof Error ? err.message : String(err)}`;
    return { ...no, verdict: { applied: false, error: message } };
  } finally {
    clearTimeout(timer);
  }
}

export type JevShadowRecord = {
  id: string;
  answerable: boolean;
  lexicalKind: EvidenceKind;
  jevChoice?: "answer" | "refuse" | "clarify";
  jevConfidence?: number;
  usage?: { input_tokens: number; output_tokens: number };
  latencyMs?: number;
  error?: string;
};

const BUCKETS: Array<[number, number]> = [[0, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 1.01]];

/**
 * Calibration from measured shadow data, not assertion: for each confidence
 * bucket, how often was Jev's refuse/clarify verdict correct (the case was
 * genuinely unanswerable)? The operating threshold is the lowest bucket edge
 * at which tightening never hit an answerable question; below measurement,
 * fall back to the conservative default.
 */
export function calibrateThreshold(records: JevShadowRecord[]): {
  threshold: number;
  buckets: Array<{ range: [number, number]; verdicts: number; correct: number; answerableHits: number }>;
  measured: boolean;
} {
  const buckets = BUCKETS.map((range) => ({ range, verdicts: 0, correct: 0, answerableHits: 0 }));
  for (const r of records) {
    if (r.error || r.jevConfidence == null || (r.jevChoice !== "refuse" && r.jevChoice !== "clarify")) continue;
    const b = buckets.find((b) => r.jevConfidence! >= b.range[0] && r.jevConfidence! < b.range[1]);
    if (!b) continue;
    b.verdicts += 1;
    if (!r.answerable) b.correct += 1;
    else b.answerableHits += 1;
  }
  let threshold = DEFAULT_CONFIDENCE;
  let measured = false;
  for (const b of buckets) {
    if (b.verdicts > 0 && b.answerableHits === 0) {
      threshold = b.range[0];
      measured = true;
      break;
    }
  }
  return { threshold, buckets, measured };
}
