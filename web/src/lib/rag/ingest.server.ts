/**
 * Ingestion. A GitHub repository-root or tree URL enumerates the git tree
 * (text/code files, size and vendor filters) — it does not index only README.md.
 * A blob URL still indexes that one file. Code files use function/class chunking.
 */
import { embedTexts, GeminiError } from "./gemini.server";
import {
  GITHUB_MAX_TOTAL_BYTES,
  githubRawUrl,
  isCodePath,
  languageFromPath,
  listGithubFiles,
  parseGithubUrl,
  resolveDefaultBranch,
} from "./github";
import { resolveRuntime } from "./keys.server";
import { getStorageStatus } from "./storage";
import {
  listPendingChunks,
  pendingEmbeddingCount,
  saveChunkEmbeddings,
  upsertDocument,
} from "./store.server";
import { githubCorpusId, urlCorpusId } from "./corpus-scope";
import { EMBEDDING_MODEL } from "./types";

const MAX_BODY = 60_000;

function titleFromMarkdown(body: string, fallback: string) {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || fallback;
}

function githubToken() {
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/plain, text/markdown, text/html;q=0.2", "User-Agent": "IntelliRAG" },
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    let body = await res.text();
    if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY);
    if (!body.trim()) throw new Error("Remote document was empty");
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function ingestText(input: {
  title: string;
  body: string;
  sourceType: "markdown" | "github" | "url" | "seed";
  sourceUri?: string;
  slugHint?: string;
  originRepo?: string | null;
  originRef?: string | null;
  filepath?: string | null;
  language?: string | null;
  chunkKind?: "prose" | "code";
}) {
  const body = input.body.slice(0, MAX_BODY).trim();
  if (body.length < 40) throw new Error("Document is too short to index");
  return upsertDocument({
    title: titleFromMarkdown(body, input.title),
    body,
    sourceType: input.sourceType,
    sourceUri: input.sourceUri,
    slugHint: input.slugHint || input.title,
    originRepo: input.originRepo,
    originRef: input.originRef,
    filepath: input.filepath,
    language: input.language,
    chunkKind: input.chunkKind,
  });
}

async function ingestGithubRepo(target: {
  owner: string;
  repo: string;
  ref: string | null;
  path?: string;
}) {
  const token = githubToken();
  const ref = target.ref || (await resolveDefaultBranch(target.owner, target.repo, token));
  const { sha, files } = await listGithubFiles({
    owner: target.owner,
    repo: target.repo,
    ref,
    prefix: target.path,
    token,
  });
  if (!files.length) {
    throw new Error("No ingestible text/code files found in that GitHub tree (binaries and vendor dirs are skipped).");
  }
  let total = 0;
  let ingested = 0;
  let skipped = 0;
  const titles: string[] = [];
  for (const file of files) {
    if (total >= GITHUB_MAX_TOTAL_BYTES) break;
    const raw = githubRawUrl(target.owner, target.repo, ref, file.path);
    try {
      const body = await fetchText(raw);
      total += body.length;
      const code = isCodePath(file.path);
      const result = await ingestText({
        title: file.path,
        body,
        sourceType: "github",
        sourceUri: `https://github.com/${target.owner}/${target.repo}/blob/${ref}/${file.path}`,
        slugHint: `${target.repo}-${file.path}`,
        originRepo: `${target.owner}/${target.repo}`,
        originRef: `${ref}@${sha.slice(0, 7)}`,
        filepath: file.path,
        language: languageFromPath(file.path),
        chunkKind: code ? "code" : "prose",
      });
      if (result.skipped) skipped += 1;
      else ingested += 1;
      titles.push(result.slug);
    } catch {
      skipped += 1;
    }
  }
  return {
    ingested,
    skipped,
    titles,
    originRepo: `${target.owner}/${target.repo}`,
    originRef: `${ref}@${sha.slice(0, 7)}`,
    fileCount: files.length,
    corpusId: githubCorpusId(`${target.owner}/${target.repo}`, `${ref}@${sha.slice(0, 7)}`),
  };
}

export async function ingestFromUrl(url: string) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Provide an http(s) URL");
  const gh = parseGithubUrl(trimmed);
  if (gh?.kind === "blob") {
    const body = await fetchText(githubRawUrl(gh.owner, gh.repo, gh.ref, gh.path));
    const code = isCodePath(gh.path);
    const result = await ingestText({
      title: gh.path.split("/").pop() || gh.path,
      body,
      sourceType: "github",
      sourceUri: trimmed,
      slugHint: `${gh.repo}-${gh.path}`,
      originRepo: `${gh.owner}/${gh.repo}`,
      originRef: gh.ref,
      filepath: gh.path,
      language: languageFromPath(gh.path),
      chunkKind: code ? "code" : "prose",
    });
    return {
      ingested: result.skipped ? 0 : 1,
      skipped: result.skipped ? 1 : 0,
      titles: [result.slug],
      corpusId: githubCorpusId(`${gh.owner}/${gh.repo}`, gh.ref),
    };
  }
  if (gh?.kind === "tree") {
    return ingestGithubRepo({ owner: gh.owner, repo: gh.repo, ref: gh.ref, path: gh.path });
  }
  if (gh?.kind === "repo") {
    return ingestGithubRepo({ owner: gh.owner, repo: gh.repo, ref: gh.ref });
  }
  const body = await fetchText(trimmed);
  const name = decodeURIComponent(trimmed.split("/").pop() || "document");
  const result = await ingestText({
    title: titleFromMarkdown(body, name.replace(/\.[a-z]+$/i, "")),
    body,
    sourceType: "url",
    sourceUri: trimmed,
  });
  return {
    ingested: result.skipped ? 0 : 1,
    skipped: result.skipped ? 1 : 0,
    titles: [result.slug],
    corpusId: urlCorpusId(trimmed),
  };
}

/** @deprecated single-file helper kept for tests that fetch one URL. */
export async function fetchRemoteDocument(url: string): Promise<{
  title: string;
  body: string;
  sourceUri: string;
  sourceType: "github" | "url";
}> {
  const trimmed = url.trim();
  const gh = parseGithubUrl(trimmed);
  if (gh?.kind === "repo" || gh?.kind === "tree") {
    throw new Error("Repository URLs ingest via ingestFromUrl (tree enumeration), not a single README.");
  }
  const raw =
    gh?.kind === "blob" ? githubRawUrl(gh.owner, gh.repo, gh.ref, gh.path) : trimmed;
  const body = await fetchText(raw);
  const name = decodeURIComponent(raw.split("/").pop() || "document");
  return {
    title: titleFromMarkdown(body, name.replace(/\.[a-z]+$/i, "")),
    body,
    sourceUri: trimmed,
    sourceType: gh ? "github" : "url",
  };
}

export async function embedPendingBatch() {
  const storage = getStorageStatus();
  if (!storage.denseAvailable) {
    throw new GeminiError(
      storage.warning || "Durable DATABASE_URL is required before embeddings can be stored.",
      503,
    );
  }
  const runtime = resolveRuntime();
  if (!runtime.embed) {
    throw new GeminiError("Add a Gemini or OpenRouter API key to embed documents", 401);
  }
  const pending = await listPendingChunks(8, EMBEDDING_MODEL);
  if (!pending.length) {
    return { embedded: 0, remaining: 0, model: null as string | null };
  }
  const { model, vectors } = await embedTexts(
    pending.map((c) => ({ title: c.title, text: c.text, task: "document" as const })),
  );
  await saveChunkEmbeddings(
    pending.map((c, i) => ({
      id: c.id,
      embedding: vectors[i] ?? [],
      model,
    })),
  );
  const remaining = await pendingEmbeddingCount(EMBEDDING_MODEL);
  return { embedded: pending.length, remaining, model };
}
