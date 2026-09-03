/**
 * In-process corpus used on Vercel when DATABASE_URL is unset.
 * PGLite's wasm/FS image is not in the serverless bundle
 * (`ENOENT /var/task/_libs/pglite.data`), so production without Neon
 * must never open PGlite. Warm instances persist to /tmp.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SEED_DOCUMENTS } from "./corpus";
import { chunkDocument, type ChunkOptions } from "./chunking";
import { getStorageStatus } from "./storage";
import { sha256Hex, slugify } from "./text";
import type { ChunkRow, DocumentHealth, DocumentRow, StaleReason, UpsertInput } from "./types";
import { EMBEDDING_MODEL, FRESHNESS_HALF_LIFE_DAYS } from "./types";
import { corpusIdForInput, parseCorpusScope, SEED_CORPUS_ID, type CorpusScope } from "./corpus-scope";

type TraceRow = {
  id: string;
  question: string;
  retrieval_mode: string;
  refused: boolean;
  model: string | null;
  citation_count: number;
  total_latency_ms: number;
  created_at: string;
  answer_preview?: string;
};

type State = {
  documents: DocumentRow[];
  chunks: ChunkRow[];
  traces: TraceRow[];
};

const TMP_PATH = "/tmp/intellirag-memory.json";

type G = typeof globalThis & { __intelliragMemory?: State };

function nowIso() {
  return new Date().toISOString();
}

function empty(): State {
  return { documents: [], chunks: [], traces: [] };
}

function loadDisk(): State {
  try {
    const parsed = JSON.parse(readFileSync(TMP_PATH, "utf8")) as State;
    return {
      documents: parsed.documents ?? [],
      chunks: parsed.chunks ?? [],
      traces: parsed.traces ?? [],
    };
  } catch {
    return empty();
  }
}

function saveDisk(state: State) {
  try {
    mkdirSync(dirname(TMP_PATH), { recursive: true });
    writeFileSync(TMP_PATH, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // /tmp is best-effort on serverless
  }
}

function state(): State {
  const g = globalThis as G;
  if (!g.__intelliragMemory) {
    g.__intelliragMemory = loadDisk();
  }
  return g.__intelliragMemory;
}

function persist() {
  saveDisk(state());
}

function health(row: DocumentRow): DocumentHealth {
  const storage = getStorageStatus();
  const chunks = state().chunks.filter((c) => c.document_id === row.id);
  const embedded = storage.durable ? chunks.filter((c) => Boolean(c.embedding)).length : 0;
  const staleReasons: StaleReason[] = [];
  if (!storage.durable) staleReasons.push("ephemeral_storage");
  if (!row.indexed_at) staleReasons.push("never_indexed");
  if (storage.durable && chunks.length > 0 && embedded < chunks.length) {
    staleReasons.push("missing_embeddings");
  }
  if (row.embedding_model && row.embedding_model !== EMBEDDING_MODEL) {
    staleReasons.push("model_mismatch");
  }
  if (row.indexed_at) {
    const ageDays = (Date.now() - new Date(row.indexed_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > FRESHNESS_HALF_LIFE_DAYS) staleReasons.push("age");
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    version: row.version,
    chunkCount: chunks.length,
    embeddedCount: embedded,
    embeddingModel: storage.durable ? row.embedding_model : null,
    indexedAt: storage.durable ? row.indexed_at : null,
    updatedAt: row.updated_at,
    staleReasons,
    originRepo: row.origin_repo,
    originRef: row.origin_ref,
    corpusId: row.corpus_id || SEED_CORPUS_ID,
  };
}

async function replaceChunks(
  documentId: string,
  body: string,
  opts?: ChunkOptions,
  corpusId: string = SEED_CORPUS_ID,
): Promise<number> {
  const s = state();
  s.chunks = s.chunks.filter((c) => c.document_id !== documentId);
  const drafts = chunkDocument(body, opts);
  const created = nowIso();
  for (const draft of drafts) {
    s.chunks.push({
      id: crypto.randomUUID(),
      document_id: documentId,
      ordinal: draft.ordinal,
      text: draft.text,
      token_count: draft.tokenCount,
      heading: draft.heading,
      embedding: null,
      embedding_model: null,
      content_hash: await sha256Hex(draft.text),
      created_at: created,
      filepath: draft.filepath,
      language: draft.language,
      symbol: draft.symbol,
      chunk_kind: draft.chunkKind,
      corpus_id: corpusId,
    });
  }
  persist();
  return drafts.length;
}

export async function ensureSeedDocuments(): Promise<void> {
  const s = state();
  for (const seed of SEED_DOCUMENTS) {
    const existing = s.documents.find((d) => d.slug === seed.slug);
    if (existing) {
      const hash = await sha256Hex(seed.body);
      if (existing.content_hash === hash) continue;
      existing.body = seed.body;
      existing.content_hash = hash;
      existing.title = seed.title;
      existing.version += 1;
      existing.embedding_model = null;
      existing.indexed_at = null;
      existing.updated_at = nowIso();
      await replaceChunks(existing.id, seed.body, undefined, SEED_CORPUS_ID);
      continue;
    }
    const id = crypto.randomUUID();
    const hash = await sha256Hex(seed.body);
    const ts = nowIso();
    s.documents.push({
      id,
      slug: seed.slug,
      title: seed.title,
      source_type: seed.sourceType,
      source_uri: "seed://" + seed.slug,
      body: seed.body,
      content_hash: hash,
      version: 1,
      embedding_model: null,
      indexed_at: null,
      origin_repo: null,
      origin_ref: null,
      corpus_id: SEED_CORPUS_ID,
      created_at: ts,
      updated_at: ts,
    });
    await replaceChunks(id, seed.body, undefined, SEED_CORPUS_ID);
  }
}

export async function upsertDocument(input: UpsertInput) {
  const s = state();
  const hash = await sha256Hex(input.body);
  const slugBase = slugify(input.slugHint || input.title);
  const corpusId = corpusIdForInput(input);
  const chunkOpts: ChunkOptions = {
    filepath: input.filepath ?? null,
    language: input.language ?? null,
    kind: input.chunkKind ?? "prose",
  };
  const existing =
    (input.sourceUri ? s.documents.find((d) => d.source_uri === input.sourceUri) : undefined) ??
    s.documents.find((d) => d.slug === slugBase);
  if (existing && existing.content_hash === hash) {
    return {
      id: existing.id,
      slug: existing.slug,
      version: existing.version,
      skipped: true,
      chunkCount: s.chunks.filter((c) => c.document_id === existing.id).length,
      corpusId: existing.corpus_id || corpusId,
    };
  }
  if (existing) {
    existing.title = input.title;
    existing.body = input.body;
    existing.content_hash = hash;
    existing.version += 1;
    existing.source_type = input.sourceType;
    existing.source_uri = input.sourceUri ?? existing.source_uri;
    existing.origin_repo = input.originRepo ?? existing.origin_repo;
    existing.origin_ref = input.originRef ?? existing.origin_ref;
    existing.corpus_id = corpusId;
    existing.embedding_model = null;
    existing.indexed_at = null;
    existing.updated_at = nowIso();
    const chunkCount = await replaceChunks(existing.id, input.body, chunkOpts, corpusId);
    return { id: existing.id, slug: existing.slug, version: existing.version, skipped: false, chunkCount, corpusId };
  }
  let slug = slugBase;
  if (s.documents.some((d) => d.slug === slug)) slug = `${slugBase}-${crypto.randomUUID().slice(0, 6)}`;
  const id = crypto.randomUUID();
  const ts = nowIso();
  s.documents.push({
    id,
    slug,
    title: input.title,
    source_type: input.sourceType,
    source_uri: input.sourceUri ?? null,
    body: input.body,
    content_hash: hash,
    version: 1,
    embedding_model: null,
    indexed_at: null,
    origin_repo: input.originRepo ?? null,
    origin_ref: input.originRef ?? null,
    corpus_id: corpusId,
    created_at: ts,
    updated_at: ts,
  });
  const chunkCount = await replaceChunks(id, input.body, chunkOpts, corpusId);
  return { id, slug, version: 1, skipped: false, chunkCount, corpusId };
}

export async function listDocuments(): Promise<DocumentHealth[]> {
  await ensureSeedDocuments();
  return [...state().documents]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(health);
}

export async function getDocumentBySlug(slug: string): Promise<DocumentRow | null> {
  await ensureSeedDocuments();
  return state().documents.find((d) => d.slug === slug) ?? null;
}

export async function listPendingChunks(limit = 8, expectedModel = EMBEDDING_MODEL) {
  const s = state();
  const pending = s.chunks
    .filter((c) => !c.embedding || (c.embedding_model ?? "") !== expectedModel)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, limit);
  return pending.map((c) => {
    const doc = s.documents.find((d) => d.id === c.document_id);
    return { ...c, title: doc?.title ?? "" };
  });
}

export async function saveChunkEmbeddings(
  updates: Array<{ id: string; embedding: number[]; model: string }>,
): Promise<void> {
  if (!updates.length) return;
  if (!getStorageStatus().denseAvailable) return;
  const s = state();
  const touched = new Set<string>();
  for (const u of updates) {
    if (!u.embedding.length) continue;
    const chunk = s.chunks.find((c) => c.id === u.id);
    if (!chunk) continue;
    chunk.embedding = JSON.stringify(u.embedding);
    chunk.embedding_model = u.model;
    touched.add(chunk.document_id);
  }
  const expected = updates[0]?.model ?? EMBEDDING_MODEL;
  for (const documentId of touched) {
    const leftover = s.chunks.filter(
      (c) =>
        c.document_id === documentId &&
        (!c.embedding || (c.embedding_model ?? "") !== expected),
    ).length;
    if (leftover === 0) {
      const doc = s.documents.find((d) => d.id === documentId);
      if (doc) {
        doc.embedding_model = expected;
        doc.indexed_at = nowIso();
        doc.updated_at = nowIso();
      }
    }
  }
  persist();
}

export async function loadSearchableChunks(scope?: CorpusScope) {
  await ensureSeedDocuments();
  const parsed = scope ?? parseCorpusScope(SEED_CORPUS_ID);
  const s = state();
  return s.chunks
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((row) => {
      const doc = s.documents.find((d) => d.id === row.document_id);
      const storage = getStorageStatus();
      const corpusId = doc?.corpus_id || row.corpus_id || SEED_CORPUS_ID;
      return {
        chunk: {
          ...row,
          embedding: storage.denseAvailable ? row.embedding : null,
          embedding_model: storage.denseAvailable ? row.embedding_model : null,
          filepath: row.filepath ?? null,
          language: row.language ?? null,
          symbol: row.symbol ?? null,
          chunk_kind: row.chunk_kind ?? "prose",
          corpus_id: corpusId,
        },
        title: doc?.title ?? "",
        slug: doc?.slug ?? "",
        indexedAt: doc?.indexed_at ?? null,
        corpusId,
      };
    })
    .filter((row) => parsed.kind === "all" || row.corpusId === parsed.corpusId);
}

export async function pendingEmbeddingCount(expectedModel = EMBEDDING_MODEL): Promise<number> {
  return state().chunks.filter(
    (c) => !c.embedding || (c.embedding_model ?? "") !== expectedModel,
  ).length;
}

export async function recordTrace(input: {
  question: string;
  retrievalMode: string;
  answer: string;
  refused: boolean;
  model: string;
  embeddingModel: string;
  layerLatencies: Record<string, number>;
  citationCount: number;
  totalLatencyMs: number;
}): Promise<void> {
  const s = state();
  s.traces.unshift({
    id: crypto.randomUUID(),
    question: input.question.slice(0, 240),
    retrieval_mode: input.retrievalMode,
    refused: input.refused,
    model: input.model,
    citation_count: input.citationCount,
    total_latency_ms: Math.round(input.totalLatencyMs),
    created_at: nowIso(),
    answer_preview: input.answer.slice(0, 280),
  });
  s.traces = s.traces.slice(0, 80);
  persist();
}

export async function recentTraces(limit = 8) {
  return state().traces.slice(0, limit).map((t) => ({
    id: t.id,
    question: t.question,
    retrieval_mode: t.retrieval_mode,
    refused: t.refused,
    model: t.model,
    citation_count: t.citation_count,
    total_latency_ms: t.total_latency_ms,
    created_at: t.created_at,
  }));
}

export async function deleteDocument(id: string): Promise<void> {
  const s = state();
  const doc = s.documents.find((d) => d.id === id && d.source_type !== "seed");
  if (!doc) return;
  s.documents = s.documents.filter((d) => d.id !== id);
  s.chunks = s.chunks.filter((c) => c.document_id !== id);
  persist();
}

export { replaceChunks };

export function resetMemoryForTests() {
  const g = globalThis as G;
  g.__intelliragMemory = undefined;
}

export function memoryTmpPath() {
  return TMP_PATH;
}
