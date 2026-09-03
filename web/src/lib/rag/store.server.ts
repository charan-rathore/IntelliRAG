/**
 * Durable corpus store.
 * Neon when DATABASE_URL is set; file-backed PGLite locally.
 * On Vercel when DATABASE_URL is missing, every path delegates to memory.server
 * (process-local, ephemeral). Embeddings do not survive cold starts there, and
 * dense retrieval must not be advertised.
 */
import { getSql, vercelWithoutDatabase } from "@/lib/db";
import { SEED_DOCUMENTS } from "./corpus";
import { chunkDocument, type ChunkOptions } from "./chunking";
import * as memory from "./memory.server";
import { getStorageStatus } from "./storage";
import { sha256Hex, slugify } from "./text";
import type { ChunkKind, ChunkRow, DocumentHealth, DocumentRow, SourceType, StaleReason, UpsertInput } from "./types";
import { EMBEDDING_MODEL, FRESHNESS_HALF_LIFE_DAYS } from "./types";
import { corpusIdForInput, corpusLabel, parseCorpusScope, SEED_CORPUS_ID, type CorpusScope, type CorpusSummary } from "./corpus-scope";

function dbUnavailable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /pglite|ENOENT|_libs|disabled on Vercel/i.test(msg);
}

export async function ensureSeedDocuments(): Promise<void> {
  if (vercelWithoutDatabase()) return memory.ensureSeedDocuments();
  const sql = await getSql();
  for (const seed of SEED_DOCUMENTS) {
    const existing = await sql<{ id: string; content_hash: string }>`
      select id, content_hash from documents where slug = ${seed.slug} limit 1
    `;
    const hash = await sha256Hex(seed.body);
    if (existing[0]) {
      if (existing[0].content_hash === hash) continue;
      await sql`
        update documents
        set title = ${seed.title},
            body = ${seed.body},
            content_hash = ${hash},
            version = version + 1,
            embedding_model = null,
            indexed_at = null,
            updated_at = now()
        where id = ${existing[0].id}
      `;
      await replaceChunks(existing[0].id, seed.body, undefined, SEED_CORPUS_ID);
      continue;
    }
    const id = crypto.randomUUID();
    await sql`
      insert into documents (
        id, slug, title, source_type, source_uri, body, content_hash, version, corpus_id
      ) values (
        ${id}, ${seed.slug}, ${seed.title}, ${seed.sourceType}, ${"seed://" + seed.slug},
        ${seed.body}, ${hash}, ${1}, ${SEED_CORPUS_ID}
      )
    `;
    await replaceChunks(id, seed.body, undefined, SEED_CORPUS_ID);
  }
}

function chunkOptsFrom(input?: {
  filepath?: string | null;
  language?: string | null;
  chunkKind?: ChunkKind;
}): ChunkOptions {
  return {
    filepath: input?.filepath ?? null,
    language: input?.language ?? null,
    kind: input?.chunkKind ?? "prose",
  };
}

export async function replaceChunks(
  documentId: string,
  body: string,
  opts?: ChunkOptions,
  corpusId: string = SEED_CORPUS_ID,
): Promise<number> {
  if (vercelWithoutDatabase()) return memory.replaceChunks(documentId, body, opts, corpusId);
  const sql = await getSql();
  await sql`delete from chunks where document_id = ${documentId}`;
  const drafts = chunkDocument(body, opts);
  for (const draft of drafts) {
    const id = crypto.randomUUID();
    const hash = await sha256Hex(draft.text);
    await sql`
      insert into chunks (
        id, document_id, ordinal, text, token_count, heading, content_hash,
        filepath, language, symbol, chunk_kind, corpus_id
      ) values (
        ${id}, ${documentId}, ${draft.ordinal}, ${draft.text}, ${draft.tokenCount},
        ${draft.heading}, ${hash},
        ${draft.filepath}, ${draft.language}, ${draft.symbol}, ${draft.chunkKind},
        ${corpusId}
      )
    `;
  }
  return drafts.length;
}

export async function upsertDocument(input: UpsertInput): Promise<{
  id: string;
  slug: string;
  version: number;
  skipped: boolean;
  chunkCount: number;
  corpusId: string;
}> {
  if (vercelWithoutDatabase()) return memory.upsertDocument(input);
  const sql = await getSql();
  const hash = await sha256Hex(input.body);
  const slugBase = slugify(input.slugHint || input.title);
  const corpusId = corpusIdForInput(input);
  const byUri =
    input.sourceUri ?
      await sql<DocumentRow>`
        select * from documents where source_uri = ${input.sourceUri} limit 1
      `
    : [];
  const existing =
    byUri[0] ??
    (
      await sql<DocumentRow>`
        select * from documents where slug = ${slugBase} limit 1
      `
    )[0];

  if (existing && existing.content_hash === hash) {
    const count = await sql<{ n: number }>`
      select count(*)::int as n from chunks where document_id = ${existing.id}
    `;
    if ((count[0]?.n ?? 0) > 0) {
      return {
        id: existing.id,
        slug: existing.slug,
        version: existing.version,
        skipped: true,
        chunkCount: count[0]?.n ?? 0,
        corpusId: existing.corpus_id || corpusId,
      };
    }
  }

  if (existing) {
    const version = existing.version + 1;
    await sql`
      update documents
      set title = ${input.title},
          body = ${input.body},
          content_hash = ${hash},
          version = ${version},
          source_type = ${input.sourceType},
          source_uri = ${input.sourceUri ?? existing.source_uri},
          origin_repo = ${input.originRepo ?? existing.origin_repo},
          origin_ref = ${input.originRef ?? existing.origin_ref},
          corpus_id = ${corpusId},
          embedding_model = null,
          indexed_at = null,
          updated_at = now()
      where id = ${existing.id}
    `;
    const chunkCount = await replaceChunks(existing.id, input.body, chunkOptsFrom(input), corpusId);
    return {
      id: existing.id,
      slug: existing.slug,
      version,
      skipped: false,
      chunkCount,
      corpusId,
    };
  }

  let slug = slugBase;
  const clash = await sql<{ id: string }>`select id from documents where slug = ${slug}`;
  if (clash.length) slug = `${slugBase}-${crypto.randomUUID().slice(0, 6)}`;
  const id = crypto.randomUUID();
  await sql`
    insert into documents (
      id, slug, title, source_type, source_uri, body, content_hash, version,
      origin_repo, origin_ref, corpus_id
    ) values (
      ${id}, ${slug}, ${input.title}, ${input.sourceType}, ${input.sourceUri ?? null},
      ${input.body}, ${hash}, ${1},
      ${input.originRepo ?? null}, ${input.originRef ?? null}, ${corpusId}
    )
  `;
  const chunkCount = await replaceChunks(id, input.body, chunkOptsFrom(input), corpusId);
  return { id, slug, version: 1, skipped: false, chunkCount, corpusId };
}

export async function listDocuments(): Promise<DocumentHealth[]> {
  if (vercelWithoutDatabase()) return memory.listDocuments();
  try {
    await ensureSeedDocuments();
    const sql = await getSql();
  const rows = await sql<{
    id: string;
    slug: string;
    title: string;
    source_type: SourceType;
    source_uri: string | null;
    version: number;
    embedding_model: string | null;
    indexed_at: string | null;
    updated_at: string;
    origin_repo: string | null;
    origin_ref: string | null;
    corpus_id: string;
    chunk_count: number;
    embedded_count: number;
  }>`
    select
      d.id,
      d.slug,
      d.title,
      d.source_type,
      d.source_uri,
      d.version,
      d.embedding_model,
      d.indexed_at,
      d.updated_at,
      d.origin_repo,
      d.origin_ref,
      d.corpus_id,
      count(c.id)::int as chunk_count,
      count(c.embedding)::int as embedded_count
    from documents d
    left join chunks c on c.document_id = d.id
    group by d.id
    order by d.updated_at desc
  `;
  return rows.map((row) => {
    const storage = getStorageStatus();
    const staleReasons: StaleReason[] = [];
    const embeddedCount = storage.durable ? row.embedded_count : 0;
    if (!storage.durable) staleReasons.push("ephemeral_storage");
    if (!row.indexed_at) staleReasons.push("never_indexed");
    if (storage.durable && row.chunk_count > 0 && row.embedded_count < row.chunk_count) {
      staleReasons.push("missing_embeddings");
    }
    if (row.embedding_model && row.embedding_model !== EMBEDDING_MODEL) {
      staleReasons.push("model_mismatch");
    }
    if (row.indexed_at) {
      const ageDays =
        (Date.now() - new Date(row.indexed_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > FRESHNESS_HALF_LIFE_DAYS) staleReasons.push("age");
    }
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      sourceType: row.source_type,
      sourceUri: row.source_uri,
      version: row.version,
      chunkCount: row.chunk_count,
      embeddedCount,
      embeddingModel: storage.durable ? row.embedding_model : null,
      indexedAt: storage.durable ? row.indexed_at : null,
      updatedAt: row.updated_at,
      staleReasons,
      originRepo: row.origin_repo,
      originRef: row.origin_ref,
      corpusId: row.corpus_id || SEED_CORPUS_ID,
    };
  });
  } catch (err) {
    if (dbUnavailable(err)) return memory.listDocuments();
    throw err;
  }
}

export async function getDocumentBySlug(slug: string): Promise<DocumentRow | null> {
  if (vercelWithoutDatabase()) return memory.getDocumentBySlug(slug);
  const sql = await getSql();
  const rows = await sql<DocumentRow>`
    select * from documents where slug = ${slug} limit 1
  `;
  return rows[0] ?? null;
}

export async function listPendingChunks(
  limit = 8,
  expectedModel = EMBEDDING_MODEL,
): Promise<Array<ChunkRow & { title: string }>> {
  if (vercelWithoutDatabase()) return memory.listPendingChunks(limit, expectedModel);
  const sql = await getSql();
  return sql<ChunkRow & { title: string }>`
    select c.*, d.title
    from chunks c
    join documents d on d.id = c.document_id
    where c.embedding is null
       or coalesce(c.embedding_model, '') <> ${expectedModel}
    order by c.created_at asc
    limit ${limit}
  `;
}

export async function saveChunkEmbeddings(
  updates: Array<{ id: string; embedding: number[]; model: string }>,
): Promise<void> {
  if (!updates.length) return;
  if (!getStorageStatus().denseAvailable) return;
  if (vercelWithoutDatabase()) return memory.saveChunkEmbeddings(updates);
  const sql = await getSql();
  const touched = new Set<string>();
  for (const u of updates) {
    if (!u.embedding.length) continue;
    const json = JSON.stringify(u.embedding);
    const rows = await sql<{ document_id: string }>`
      update chunks
      set embedding = ${json}, embedding_model = ${u.model}
      where id = ${u.id}
      returning document_id
    `;
    if (rows[0]) touched.add(rows[0].document_id);
  }
  const expected = updates[0]?.model ?? EMBEDDING_MODEL;
  for (const documentId of touched) {
    const leftover = await sql<{ n: number }>`
      select count(*)::int as n from chunks
      where document_id = ${documentId}
        and (embedding is null or coalesce(embedding_model, '') <> ${expected})
    `;
    if ((leftover[0]?.n ?? 1) === 0) {
      await sql`
        update documents
        set embedding_model = ${updates[0]!.model},
            indexed_at = now(),
            updated_at = now()
        where id = ${documentId}
      `;
    }
  }
}

export async function listCorpora(): Promise<CorpusSummary[]> {
  const documents = await listDocuments();
  const counts = new Map<string, number>();
  for (const doc of documents) {
    const id = doc.corpusId || SEED_CORPUS_ID;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (a[0] === SEED_CORPUS_ID) return -1;
      if (b[0] === SEED_CORPUS_ID) return 1;
      return a[0].localeCompare(b[0]);
    })
    .map(([id, documentCount]) => ({ id, documentCount, label: corpusLabel(id) }));
}

export async function loadSearchableChunks(scope?: CorpusScope): Promise<
  Array<{
    chunk: ChunkRow;
    title: string;
    slug: string;
    indexedAt: string | null;
    corpusId: string;
  }>
> {
  const parsed = scope ?? parseCorpusScope(SEED_CORPUS_ID);
  if (vercelWithoutDatabase()) return memory.loadSearchableChunks(parsed);
  try {
  const sql = await getSql();
  const rows =
    parsed.kind === "all" ?
      await sql<ChunkRow & { title: string; slug: string; indexed_at: string | null; doc_corpus: string }>`
        select c.*, d.title, d.slug, d.indexed_at, d.corpus_id as doc_corpus
        from chunks c
        join documents d on d.id = c.document_id
        order by c.ordinal asc
      `
    : await sql<ChunkRow & { title: string; slug: string; indexed_at: string | null; doc_corpus: string }>`
        select c.*, d.title, d.slug, d.indexed_at, d.corpus_id as doc_corpus
        from chunks c
        join documents d on d.id = c.document_id
        where d.corpus_id = ${parsed.corpusId}
        order by c.ordinal asc
      `;
  return rows.map((row) => ({
    chunk: {
      id: row.id,
      document_id: row.document_id,
      ordinal: row.ordinal,
      text: row.text,
      token_count: row.token_count,
      heading: row.heading,
      embedding: getStorageStatus().denseAvailable ? row.embedding : null,
      embedding_model: getStorageStatus().denseAvailable ? row.embedding_model : null,
      content_hash: row.content_hash,
      created_at: row.created_at,
      filepath: row.filepath ?? null,
      language: row.language ?? null,
      symbol: row.symbol ?? null,
      chunk_kind: row.chunk_kind ?? "prose",
      corpus_id: row.corpus_id || row.doc_corpus || SEED_CORPUS_ID,
    },
    title: row.title,
    slug: row.slug,
    indexedAt: row.indexed_at,
    corpusId: row.doc_corpus || row.corpus_id || SEED_CORPUS_ID,
  }));
  } catch (err) {
    if (dbUnavailable(err)) return memory.loadSearchableChunks(parsed);
    throw err;
  }
}

export async function pendingEmbeddingCount(
  expectedModel = EMBEDDING_MODEL,
): Promise<number> {
  if (!getStorageStatus().denseAvailable) return 0;
  if (vercelWithoutDatabase()) return memory.pendingEmbeddingCount(expectedModel);
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n
    from chunks
    where embedding is null
       or coalesce(embedding_model, '') <> ${expectedModel}
  `;
  return rows[0]?.n ?? 0;
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
  if (vercelWithoutDatabase()) return memory.recordTrace(input);
  const sql = await getSql();
  await sql`
    insert into query_traces (
      id, question, retrieval_mode, answer_preview, refused, model, embedding_model,
      layer_latencies, citation_count, total_latency_ms
    ) values (
      ${crypto.randomUUID()},
      ${input.question.slice(0, 240)},
      ${input.retrievalMode},
      ${input.answer.slice(0, 280)},
      ${input.refused},
      ${input.model},
      ${input.embeddingModel},
      ${JSON.stringify(input.layerLatencies)},
      ${input.citationCount},
      ${Math.round(input.totalLatencyMs)}
    )
  `;
  const extra = await sql<{ id: string }>`
    select id from query_traces order by created_at desc offset 80
  `;
  for (const row of extra) {
    await sql`delete from query_traces where id = ${row.id}`;
  }
}

export async function recentTraces(limit = 8) {
  if (vercelWithoutDatabase()) return memory.recentTraces(limit);
  const sql = await getSql();
  return sql<{
    id: string;
    question: string;
    retrieval_mode: string;
    refused: boolean;
    model: string | null;
    citation_count: number;
    total_latency_ms: number;
    created_at: string;
  }>`
    select id, question, retrieval_mode, refused, model, citation_count, total_latency_ms, created_at
    from query_traces
    order by created_at desc
    limit ${limit}
  `;
}

export async function deleteDocument(id: string): Promise<void> {
  if (vercelWithoutDatabase()) return memory.deleteDocument(id);
  const sql = await getSql();
  await sql`delete from documents where id = ${id} and source_type <> ${"seed"}`;
}
