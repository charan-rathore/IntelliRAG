/**
 * Ingestion. A GitHub repository-root or tree URL enumerates the git tree
 * (text/code files, size and vendor filters). it does not index only README.md.
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
import { seedPredictedQuestions } from "./suggested-questions.server";
import { EMBEDDING_MODEL } from "./types";

const MAX_BODY = 60_000;

const PDF_ERROR = "PDF ingestion is not supported yet. Convert the document to text or markdown and import that instead.";
const TRUNCATION_ERROR = "Document exceeds the supported import size (60KB); import a smaller document instead of silently truncating it.";

function assertNotPdf(body: string) {
  if (body.startsWith("%PDF-")) throw new Error(PDF_ERROR);
}

export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|header|footer|li|ul|ol|tr|table|h[1-6]|pre|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  return text.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

function looksLikeHtml(body: string): boolean {
  return /^\s*(<!doctype html|<html[\s>])/i.test(body);
}

function titleFromMarkdown(body: string, fallback: string) {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || fallback;
}

function githubToken() {
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

const MAX_REDIRECTS = 3;
const PRIVATE_HOST_ERROR = "This URL points at a private or local address and cannot be imported";

/** True for loopback, private, link-local, and otherwise non-public IPs (v4 and v6). */
export function isPrivateIp(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (normalized.includes(":")) {
    if (normalized === "::1" || normalized === "::") return true;
    const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
    if (Number.isNaN(first)) return false;
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    return false;
  }
  const parts = normalized.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 || // "this" network
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) // RFC 1918
  );
}

/**
 * Fail closed on URLs that could reach internal infrastructure: reject
 * non-http(s) schemes, well-known local hostnames, private IP literals, and
 * hostnames that resolve to a private address.
 */
export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  const url = typeof raw === "string" ? new URL(raw) : raw;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provide an http(s) URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new Error(PRIVATE_HOST_ERROR);
  }
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  if (isIpLiteral) {
    if (isPrivateIp(hostname)) throw new Error(PRIVATE_HOST_ERROR);
    return url;
  }
  const { lookup } = await import("node:dns/promises");
  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
    throw new Error(PRIVATE_HOST_ERROR);
  }
  return url;
}

async function fetchText(url: string): Promise<string> {
  let current = await assertPublicUrl(url);
  for (let redirectCount = 0; ; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(current, {
        // Redirects are followed manually so every hop is re-validated
        // against the private-address rules above.
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/plain, text/markdown, text/html;q=0.2", "User-Agent": "IntelliRAG" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (redirectCount >= MAX_REDIRECTS) throw new Error("Too many redirects");
        current = await assertPublicUrl(new URL(res.headers.get("location")!, current));
        continue;
      }
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        let body = await res.text();
      assertNotPdf(body);
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/html") || looksLikeHtml(body)) body = htmlToText(body);
      if (!body.trim()) throw new Error("Remote document was empty");
      if (body.length > MAX_BODY) throw new Error(TRUNCATION_ERROR);
      return body;
    } finally {
      clearTimeout(timer);
    }
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
  assertNotPdf(input.body.trimStart());
  const raw = looksLikeHtml(input.body) ? htmlToText(input.body) : input.body;
  const body = raw.trim();
  if (body.length > MAX_BODY) throw new Error(TRUNCATION_ERROR);
  if (body.length < 40) throw new Error("Document is too short to index");
  const title = titleFromMarkdown(body, input.title);
  const result = await upsertDocument({
    title,
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
  try {
    await seedPredictedQuestions({
      corpusId: result.corpusId,
      documentSlug: result.slug,
      body,
      title,
    });
  } catch (err) {
    console.error("[intellirag] question prediction failed", err);
  }
  return result;
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

async function ingestGithubIssue(owner: string, repo: string, number: number) {
  const token = githubToken();
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "IntelliRAG" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
  const response = await fetch(base, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GitHub issue fetch failed (${response.status})`);
  const issue = await response.json() as { title: string; body: string | null; html_url: string; state: string; comments: number };
  let comments: Array<{ body: string; html_url: string }> = [];
  if (issue.comments) {
    const res = await fetch(`${base}/comments?per_page=100`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub issue comments fetch failed (${res.status})`);
    comments = await res.json();
  }
  const title = `${owner}/${repo} #${number}: ${issue.title}`;
  const body = [`# ${title}`, `State: ${issue.state}`, issue.body ?? "", ...comments.map((c, i) => `## Comment ${i + 1}\nSource: ${c.html_url}\n\n${c.body}`)].join("\n\n");
  if (body.length > MAX_BODY || issue.comments > comments.length) throw new Error("Issue exceeds the supported import size; import a smaller document instead of silently truncating it.");
  const result = await ingestText({ title, body, sourceType: "url", sourceUri: issue.html_url, slugHint: `${owner}-${repo}-issue-${number}` });
  return { ingested: result.skipped ? 0 : 1, skipped: result.skipped ? 1 : 0, titles: [result.slug], corpusId: urlCorpusId(issue.html_url) };
}

export async function ingestFromUrl(url: string) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Provide an http(s) URL");
  const gh = parseGithubUrl(trimmed);
  if (gh?.kind === "issue") return ingestGithubIssue(gh.owner, gh.repo, gh.number);
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
  if (gh?.kind === "repo" || gh?.kind === "tree" || gh?.kind === "issue") {
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
