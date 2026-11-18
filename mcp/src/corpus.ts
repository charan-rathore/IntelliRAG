/**
 * Corpora the MCP server answers from: a folder on this machine (the repo an
 * agent is working in) or a GitHub repository pinned to one commit. Chunked
 * with the same chunker the web app uses, held in memory for the session.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { chunkDocument } from "../../web/src/lib/rag/chunking";
import type { SearchRow } from "../../web/src/lib/rag/retrieve-core";
import type { ChunkKind } from "../../web/src/lib/rag/types";

export interface Corpus {
  id: string;
  label: string;
  /** Where it came from, pinned: an absolute path, or owner/repo@sha. */
  origin: string;
  rows: SearchRow[];
  files: number;
  indexedAt: string;
}

const PROSE = new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"]);
const CODE: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".rb": "ruby", ".kt": "kotlin", ".swift": "swift", ".c": "c", ".h": "c", ".cpp": "cpp", ".cs": "csharp",
};
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", "vendor", "target", ".venv", "venv", "__pycache__", ".turbo", ".cache"]);
export const LIMITS = { files: 4000, bytesPerFile: 400_000, totalBytes: 40_000_000 };

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export function kindOf(path: string): { kind: ChunkKind; language: string | null } | null {
  const ext = extname(path).toLowerCase();
  if (PROSE.has(ext)) return { kind: "prose", language: null };
  const language = CODE[ext];
  return language ? { kind: "code", language } : null;
}

export function rowsFor(corpusId: string, files: Array<{ path: string; text: string }>): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const f of files) {
    const k = kindOf(f.path);
    if (!k) continue;
    for (const c of chunkDocument(f.text, { filepath: f.path, kind: k.kind, language: k.language })) {
      rows.push({
        title: f.path, slug: f.path, indexedAt: null, corpusId,
        chunk: {
          id: `${f.path}#${c.ordinal}`, document_id: f.path, ordinal: c.ordinal, text: c.text, token_count: c.tokenCount,
          heading: c.heading, embedding: null, embedding_model: null, content_hash: hash(c.text), created_at: "",
          filepath: c.filepath, language: c.language, symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: corpusId,
        },
      } as SearchRow);
    }
  }
  return rows;
}

/** Walk a folder for docs and source files, skipping build output and dependencies. */
export function readFolder(root: string, include: "docs" | "all" = "all"): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  let total = 0;
  const walk = (dir: string) => {
    let names: string[];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      if (out.length >= LIMITS.files || total >= LIMITS.totalBytes) return;
      if (name.startsWith(".") && name !== ".github") continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue; }
      const k = kindOf(name);
      if (!k || (include === "docs" && k.kind !== "prose") || st.size > LIMITS.bytesPerFile) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes("\u0000")) continue;
      total += text.length;
      out.push({ path: relative(root, full).split(sep).join("/"), text });
    }
  };
  walk(root);
  return out;
}

export function folderCorpus(path: string, include: "docs" | "all" = "all"): Corpus {
  const files = readFolder(path, include);
  const id = `local:${hash(path).slice(0, 10)}`;
  return { id, label: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, origin: path, rows: rowsFor(id, files), files: files.length, indexedAt: new Date().toISOString() };
}

const GH = "https://api.github.com";

/**
 * A GitHub repository's docs (and, with include "all", its source), pinned to
 * the commit `ref` resolves to now, so every answer names exactly what it read.
 */
export async function githubCorpus(repo: string, opts: { ref?: string; include?: "docs" | "all"; token?: string } = {}): Promise<Corpus> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Expected owner/repo, got "${repo}"`);
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "intellirag-mcp" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const get = async (url: string) => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`GitHub ${r.status} for ${url.replace(GH, "")}${r.status === 403 || r.status === 429 ? " (rate limited or blocked: set GITHUB_TOKEN)" : ""}`);
    return r.json() as Promise<any>;
  };
  const sha: string = (await get(`${GH}/repos/${repo}/commits/${encodeURIComponent(opts.ref ?? "HEAD")}`)).sha;
  const tree = await get(`${GH}/repos/${repo}/git/trees/${sha}?recursive=1`);
  const include = opts.include ?? "docs";
  const wanted = (tree.tree as Array<{ path: string; type: string; size?: number }>)
    .filter((n) => n.type === "blob" && (n.size ?? 0) <= LIMITS.bytesPerFile && !n.path.split("/").some((p) => SKIP_DIRS.has(p)))
    .filter((n) => { const k = kindOf(n.path); return k && (include === "all" || k.kind === "prose"); })
    .slice(0, include === "all" ? 800 : 300);
  const files: Array<{ path: string; text: string }> = [];
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = await Promise.all(wanted.slice(i, i + 8).map(async (n) => {
      const r = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${n.path}`, { headers: { "User-Agent": "intellirag-mcp" }, signal: AbortSignal.timeout(20_000) });
      return r.ok ? { path: n.path, text: await r.text() } : null;
    }));
    for (const f of batch) if (f) files.push(f);
  }
  const id = `github:${repo}@${sha.slice(0, 12)}`;
  return { id, label: repo, origin: `${repo}@${sha}`, rows: rowsFor(id, files), files: files.length, indexedAt: new Date().toISOString() };
}
