/**
 * Suggested questions: predicted from document text + community asks.
 * Neon/PGLite when a database is available; /tmp JSON memory on serverless without Postgres.
 */
import { getSql, vercelWithoutDatabase } from "@/lib/db";
import {
  normalizeSuggestionQuestion,
  predictQuestionsFromDocument,
  type SuggestedQuestion,
} from "./predict-questions";
import { SEED_CORPUS_ID } from "./corpus-scope";
import {
  listMemorySuggestions,
  rankSuggestions,
  recordAskMemory,
  seedPredictedMemory,
  suggestionQuestionHash,
  suggestionToPublic,
  type SuggestionRow,
} from "./suggested-questions-memory";

export type { SuggestedQuestion, SuggestionSource } from "./predict-questions";

async function seedPredictedDb(input: {
  corpusId: string;
  documentSlug: string;
  body: string;
  title?: string;
}): Promise<number> {
  const sql = await getSql();
  const predicted = predictQuestionsFromDocument(input.body, { title: input.title, min: 3 });
  let added = 0;
  for (const item of predicted) {
    const question = normalizeSuggestionQuestion(item.question);
    const hash = suggestionQuestionHash(question);
    const id = crypto.randomUUID();
    const before = await sql<{ n: number }>`
      select count(*)::int as n from suggested_questions
      where corpus_id = ${input.corpusId} and question_hash = ${hash}
    `;
    await sql`
      insert into suggested_questions (
        id, corpus_id, document_slug, question, question_hash, source, ask_count
      ) values (
        ${id}, ${input.corpusId}, ${input.documentSlug}, ${question}, ${hash}, 'predicted', 0
      )
      on conflict (corpus_id, question_hash) do update set
        document_slug = coalesce(suggested_questions.document_slug, excluded.document_slug),
        updated_at = now()
    `;
    if ((before[0]?.n ?? 0) === 0) added += 1;
  }
  return added;
}

async function recordAskDb(input: {
  corpusId: string;
  question: string;
  documentSlug?: string | null;
}): Promise<SuggestedQuestion | null> {
  const question = normalizeSuggestionQuestion(input.question);
  if (question.length < 8) return null;
  const sql = await getSql();
  const hash = suggestionQuestionHash(question);
  const id = crypto.randomUUID();
  const rows = await sql`
    insert into suggested_questions (
      id, corpus_id, document_slug, question, question_hash, source, ask_count, last_asked_at
    ) values (
      ${id}, ${input.corpusId}, ${input.documentSlug ?? null}, ${question}, ${hash}, 'asked', 1, now()
    )
    on conflict (corpus_id, question_hash) do update set
      ask_count = suggested_questions.ask_count + 1,
      source = 'asked',
      last_asked_at = now(),
      updated_at = now(),
      document_slug = coalesce(suggested_questions.document_slug, excluded.document_slug)
    returning *
  `;
  const row = rows[0] as SuggestionRow | undefined;
  return row ? suggestionToPublic(row) : null;
}

async function listDb(corpusId: string, limit: number): Promise<SuggestedQuestion[]> {
  const sql = await getSql();
  const rows = (await sql`
    select * from suggested_questions
    where corpus_id = ${corpusId}
    order by ask_count desc, updated_at desc
    limit ${Math.max(limit * 3, 24)}
  `) as SuggestionRow[];
  return rankSuggestions(rows.map(suggestionToPublic), limit);
}

export async function seedPredictedQuestions(input: {
  corpusId: string;
  documentSlug: string;
  body: string;
  title?: string;
}): Promise<number> {
  const corpusId = input.corpusId || SEED_CORPUS_ID;
  try {
    if (vercelWithoutDatabase()) {
      return seedPredictedMemory({ ...input, corpusId });
    }
    return await seedPredictedDb({ ...input, corpusId });
  } catch (err) {
    console.error("[intellirag] seedPredictedQuestions failed", err);
    return seedPredictedMemory({ ...input, corpusId });
  }
}

export async function recordAskedQuestion(input: {
  corpusId: string;
  question: string;
  documentSlug?: string | null;
}): Promise<SuggestedQuestion | null> {
  const corpusId = input.corpusId || SEED_CORPUS_ID;
  try {
    if (vercelWithoutDatabase()) {
      return recordAskMemory({ ...input, corpusId });
    }
    return await recordAskDb({ ...input, corpusId });
  } catch (err) {
    console.error("[intellirag] recordAskedQuestion failed", err);
    return recordAskMemory({ ...input, corpusId });
  }
}

export async function listSuggestedQuestions(
  corpusId: string,
  limit = 6,
): Promise<SuggestedQuestion[]> {
  const id = corpusId || SEED_CORPUS_ID;
  try {
    if (vercelWithoutDatabase()) return listMemorySuggestions(id, limit);
    return await listDb(id, limit);
  } catch (err) {
    console.error("[intellirag] listSuggestedQuestions failed", err);
    return listMemorySuggestions(id, limit);
  }
}

/** Ensure a corpus has at least `min` suggestions by predicting from provided docs. */
export async function ensureSuggestionsForDocuments(
  corpusId: string,
  documents: Array<{ slug: string; title: string; body: string }>,
  min = 3,
): Promise<SuggestedQuestion[]> {
  let current = await listSuggestedQuestions(corpusId, min);
  if (current.length >= min) return current;
  for (const doc of documents) {
    if (!doc.body?.trim()) continue;
    await seedPredictedQuestions({
      corpusId,
      documentSlug: doc.slug,
      body: doc.body,
      title: doc.title,
    });
  }
  return listSuggestedQuestions(corpusId, Math.max(min, 6));
}
