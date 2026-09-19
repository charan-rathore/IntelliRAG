/**
 * Lexical question prediction for an ingested document.
 * Turns headings, FAQ lines, API symbols and warning callouts into
 * support-style questions a reader is likely to ask — no LLM required.
 */

export type PredictedQuestion = {
  question: string;
  reason: "heading" | "faq" | "api" | "warning" | "howto";
  score: number;
};

export type SuggestionSource = "predicted" | "asked";

export type SuggestedQuestion = {
  id: string;
  corpusId: string;
  documentSlug: string | null;
  question: string;
  source: SuggestionSource;
  askCount: number;
  lastAskedAt: string | null;
  createdAt: string;
};

const MIN_QUESTION_LEN = 18;
const MAX_QUESTION_LEN = 180;
const MAX_PREDICTIONS = 8;

const NOISE_HEADINGS = /^(table of contents|toc|license|licence|changelog|contributing|sponsors?|thanks|badges?|see also|related|links?|footer|install(ation)?|usage|getting started|quick ?start|overview|introduction|about|api|options?|events?|methods?|types?|faq|frequently asked)$/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanHeading(raw: string): string {
  return normalizeWhitespace(
    raw
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .replace(/\s*\{#[^}]+\}\s*$/, ""),
  );
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_QUESTION_LEN || t.length > MAX_QUESTION_LEN) return false;
  if (/^(https?:|www\.|npm |yarn |pnpm |docker |kubectl )/i.test(t)) return false;
  return true;
}

function headingToQuestion(heading: string): string | null {
  const h = cleanHeading(heading);
  if (!h || h.length < 3 || NOISE_HEADINGS.test(h)) return null;
  if (/\?$/.test(h)) return looksLikeQuestion(h) ? h : null;

  if (/^(how|what|why|when|where|which|who|can|should|does|is|are)\b/i.test(h)) {
    const q = /\?$/.test(h) ? h : `${h}?`;
    return looksLikeQuestion(q) ? q : null;
  }

  if (/^(error|errors|troubleshoot|debugging|known issues|limitations|caveats)/i.test(h)) {
    const q = `What should I know about ${h.toLowerCase()}?`;
    return looksLikeQuestion(q) ? q : null;
  }

  if (/^(config|configuration|options?|settings?|timeout|retry|concurrency|rate.?limit)/i.test(h)) {
    const q = `How do I configure ${h.toLowerCase()}?`;
    return looksLikeQuestion(q) ? q : null;
  }

  if (/^(pause|resume|cancel|clear|start|stop|drain|idle|pending)/i.test(h)) {
    const q = `When should I use ${h}?`;
    return looksLikeQuestion(q) ? q : null;
  }

  const q = `How does ${h} work?`;
  return looksLikeQuestion(q) ? q : null;
}

function extractFaqQuestions(body: string): PredictedQuestion[] {
  const out: PredictedQuestion[] = [];
  const lines = body.split("\n");
  for (const line of lines) {
    const faq =
      line.match(/^\s*(?:[-*+]|\d+[.)])\s*\*{0,2}(?:Q(?:uestion)?[:.)]\s*)(.+?)\*{0,2}\s*$/i) ||
      line.match(/^\s*>\s*\*{0,2}(?:Q(?:uestion)?[:.)]\s*)(.+?)\*{0,2}\s*$/i) ||
      line.match(/^\s*#{1,4}\s+(.+\?)\s*$/);
    const raw = faq?.[1] ? cleanHeading(faq[1]) : null;
    if (!raw) continue;
    const question = /\?$/.test(raw) ? raw : `${raw}?`;
    if (!looksLikeQuestion(question)) continue;
    out.push({ question, reason: "faq", score: 0.95 });
  }
  return out;
}

function extractHeadingQuestions(body: string): PredictedQuestion[] {
  const out: PredictedQuestion[] = [];
  const headingRe = /^#{2,4}\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(body))) {
    const question = headingToQuestion(match[1] ?? "");
    if (!question) continue;
    const depth = (match[0].match(/^#+/)?.[0].length ?? 3);
    out.push({
      question,
      reason: "heading",
      score: depth === 2 ? 0.82 : depth === 3 ? 0.74 : 0.66,
    });
  }
  return out;
}

function extractApiQuestions(body: string): PredictedQuestion[] {
  const out: PredictedQuestion[] = [];
  const seen = new Set<string>();
  // Markdown API headings like ### pause() or #### concurrency
  const apiHeading = /^#{2,4}\s+`?([A-Za-z][\w.]*(?:\([^)]*\))?)`?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = apiHeading.exec(body))) {
    const symbol = (match[1] ?? "").trim();
    if (!symbol || symbol.length < 2 || seen.has(symbol.toLowerCase())) continue;
    if (NOISE_HEADINGS.test(symbol.replace(/\(.*\)$/, ""))) continue;
    seen.add(symbol.toLowerCase());
    const base = symbol.replace(/\(.*\)$/, "");
    const question = /\(/.test(symbol)
      ? `When should I call ${symbol}?`
      : `What does the ${base} option do?`;
    if (!looksLikeQuestion(question)) continue;
    out.push({ question, reason: "api", score: 0.78 });
  }
  return out;
}

function extractWarningQuestions(body: string): PredictedQuestion[] {
  const out: PredictedQuestion[] = [];
  const warnRe =
    /(?:^|\n)\s*(?:\*\*)?(?:warning|important|note|caution|gotcha)(?:\*\*)?\s*[:.—-]\s*(.+?)(?=\n|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = warnRe.exec(body))) {
    const detail = cleanHeading(match[1] ?? "").slice(0, 120);
    if (detail.length < 12) continue;
    const question = `What should I watch out for: ${detail.replace(/\?+$/, "")}?`;
    if (!looksLikeQuestion(question)) continue;
    out.push({ question, reason: "warning", score: 0.7 });
  }
  return out;
}

function extractHowtoQuestions(body: string): PredictedQuestion[] {
  const out: PredictedQuestion[] = [];
  const howto = /(?:^|\n)\s*(?:[-*+]|\d+[.)])\s*((?:How to|How do I|To )\b[^.\n?]{10,120})/gi;
  let match: RegExpExecArray | null;
  while ((match = howto.exec(body))) {
    let phrase = cleanHeading(match[1] ?? "");
    if (/^to /i.test(phrase)) phrase = `How do I ${phrase.slice(3)}`;
    if (!/\?$/.test(phrase)) phrase = `${phrase}?`;
    if (!looksLikeQuestion(phrase)) continue;
    out.push({ question: phrase, reason: "howto", score: 0.88 });
  }
  return out;
}

function dedupeRank(items: PredictedQuestion[]): PredictedQuestion[] {
  const byKey = new Map<string, PredictedQuestion>();
  for (const item of items) {
    const key = item.question.toLowerCase().replace(/[^\w\s?]/g, "").replace(/\s+/g, " ").trim();
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || item.score > prev.score) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, MAX_PREDICTIONS);
}

/** Predict at least a few support-style questions from document markdown/text. */
export function predictQuestionsFromDocument(
  body: string,
  opts?: { title?: string; min?: number },
): PredictedQuestion[] {
  const min = opts?.min ?? 3;
  const text = body.slice(0, 80_000);
  const predicted = dedupeRank([
    ...extractFaqQuestions(text),
    ...extractHowtoQuestions(text),
    ...extractHeadingQuestions(text),
    ...extractApiQuestions(text),
    ...extractWarningQuestions(text),
  ]);

  if (predicted.length >= min) return predicted;

  const title = cleanHeading(opts?.title ?? "");
  const fallbacks: PredictedQuestion[] = [];
  if (title && !NOISE_HEADINGS.test(title)) {
    fallbacks.push({
      question: `What is ${title} used for?`,
      reason: "heading",
      score: 0.4,
    });
    fallbacks.push({
      question: `How do I get started with ${title}?`,
      reason: "howto",
      score: 0.38,
    });
    fallbacks.push({
      question: `What are common pitfalls when using ${title}?`,
      reason: "warning",
      score: 0.36,
    });
  } else {
    fallbacks.push(
      { question: "What problem does this document solve?", reason: "heading", score: 0.35 },
      { question: "How should I configure this for production?", reason: "howto", score: 0.34 },
      { question: "What failure modes should I plan for?", reason: "warning", score: 0.33 },
    );
  }

  return dedupeRank([...predicted, ...fallbacks]).slice(0, Math.max(min, predicted.length));
}

export function normalizeSuggestionQuestion(question: string): string {
  return normalizeWhitespace(question).slice(0, MAX_QUESTION_LEN);
}
