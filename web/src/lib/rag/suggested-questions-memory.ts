/**
 * Ephemeral /tmp suggested-question store (no database imports).
 * Used on serverless without Postgres and by unit tests.
 */
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  normalizeSuggestionQuestion,
  predictQuestionsFromDocument,
  type SuggestionSource,
  type SuggestedQuestion,
} from "./predict-questions";

export type SuggestionRow = {
  id: string;
  corpus_id: string;
  document_slug: string | null;
  question: string;
  question_hash: string;
  source: SuggestionSource;
  ask_count: number;
  last_asked_at: string | null;
  created_at: string;
  updated_at: string;
};

type MemState = { rows: SuggestionRow[] };

const TMP_PATH = "/tmp/intellirag-suggested-questions.json";
type G = typeof globalThis & { __intelliragSuggestions?: MemState };

export function suggestionQuestionHash(question: string): string {
  return createHash("sha256")
    .update(normalizeSuggestionQuestion(question).toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

function nowIso() {
  return new Date().toISOString();
}

function loadMem(): MemState {
  const g = globalThis as G;
  if (g.__intelliragSuggestions) return g.__intelliragSuggestions;
  try {
    const parsed = JSON.parse(readFileSync(TMP_PATH, "utf8")) as MemState;
    g.__intelliragSuggestions = { rows: parsed.rows ?? [] };
  } catch {
    g.__intelliragSuggestions = { rows: [] };
  }
  return g.__intelliragSuggestions;
}

function saveMem(state: MemState) {
  try {
    mkdirSync(dirname(TMP_PATH), { recursive: true });
    writeFileSync(TMP_PATH, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // best-effort on serverless /tmp
  }
}

export function suggestionToPublic(row: SuggestionRow): SuggestedQuestion {
  return {
    id: row.id,
    corpusId: row.corpus_id,
    documentSlug: row.document_slug,
    question: row.question,
    source: row.source,
    askCount: row.ask_count,
    lastAskedAt: row.last_asked_at,
    createdAt: row.created_at,
  };
}

export function rankSuggestions(rows: SuggestedQuestion[], limit: number): SuggestedQuestion[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.askCount !== a.askCount) return b.askCount - a.askCount;
    if (a.source !== b.source) return a.source === "asked" ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const out: SuggestedQuestion[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const key = row.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export function seedPredictedMemory(input: {
  corpusId: string;
  documentSlug: string;
  body: string;
  title?: string;
}): number {
  const state = loadMem();
  const predicted = predictQuestionsFromDocument(input.body, { title: input.title, min: 3 });
  let added = 0;
  const ts = nowIso();
  for (const item of predicted) {
    const hash = suggestionQuestionHash(item.question);
    const existing = state.rows.find(
      (r) => r.corpus_id === input.corpusId && r.question_hash === hash,
    );
    if (existing) {
      if (!existing.document_slug) existing.document_slug = input.documentSlug;
      continue;
    }
    state.rows.push({
      id: crypto.randomUUID(),
      corpus_id: input.corpusId,
      document_slug: input.documentSlug,
      question: normalizeSuggestionQuestion(item.question),
      question_hash: hash,
      source: "predicted",
      ask_count: 0,
      last_asked_at: null,
      created_at: ts,
      updated_at: ts,
    });
    added += 1;
  }
  saveMem(state);
  return added;
}

export function recordAskMemory(input: {
  corpusId: string;
  question: string;
  documentSlug?: string | null;
}): SuggestedQuestion | null {
  const question = normalizeSuggestionQuestion(input.question);
  if (question.length < 8) return null;
  const state = loadMem();
  const hash = suggestionQuestionHash(question);
  const ts = nowIso();
  const existing = state.rows.find(
    (r) => r.corpus_id === input.corpusId && r.question_hash === hash,
  );
  if (existing) {
    existing.ask_count += 1;
    existing.source = "asked";
    existing.last_asked_at = ts;
    existing.updated_at = ts;
    if (input.documentSlug && !existing.document_slug) {
      existing.document_slug = input.documentSlug;
    }
    saveMem(state);
    return suggestionToPublic(existing);
  }
  const row: SuggestionRow = {
    id: crypto.randomUUID(),
    corpus_id: input.corpusId,
    document_slug: input.documentSlug ?? null,
    question,
    question_hash: hash,
    source: "asked",
    ask_count: 1,
    last_asked_at: ts,
    created_at: ts,
    updated_at: ts,
  };
  state.rows.push(row);
  saveMem(state);
  return suggestionToPublic(row);
}

export function listMemorySuggestions(corpusId: string, limit: number): SuggestedQuestion[] {
  const state = loadMem();
  const rows = state.rows.filter((r) => r.corpus_id === corpusId).map(suggestionToPublic);
  return rankSuggestions(rows, limit);
}
