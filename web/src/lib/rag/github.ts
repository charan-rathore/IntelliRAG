export type GithubTarget =
  | { kind: "blob"; owner: string; repo: string; ref: string; path: string }
  | { kind: "tree"; owner: string; repo: string; ref: string | null; path: string }
  | { kind: "repo"; owner: string; repo: string; ref: string | null };

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "vendor",
  "coverage",
  ".next",
  ".output",
  ".nitro",
  ".vercel",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "bin",
  "obj",
  "generated",
  ".turbo",
  "public",
]);

const TEXT_EXT = new Set([
  "md",
  "mdx",
  "txt",
  "rst",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "rb",
  "php",
  "sql",
  "yaml",
  "yml",
  "json",
  "toml",
  "sh",
  "bash",
  "css",
  "html",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
]);

const SKIP_FILE = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "cargo.lock",
  "go.sum",
  "poetry.lock",
]);

export const GITHUB_MAX_FILES = 48;
export const GITHUB_MAX_FILE_BYTES = 120_000;
export const GITHUB_MAX_TOTAL_BYTES = 1_600_000;

export function parseGithubUrl(url: string): GithubTarget | null {
  const u = url.trim().replace(/[?#].*$/, "").replace(/\/$/, "");
  const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/(.*))?$/i);
  if (!m) return null;
  const owner = m[1]!;
  const repo = m[2]!.replace(/\.git$/i, "");
  const rest = m[3] ?? "";
  if (!rest) return { kind: "repo", owner, repo, ref: null };
  const blob = rest.match(/^blob\/([^/]+)\/(.+)$/);
  if (blob) return { kind: "blob", owner, repo, ref: blob[1]!, path: blob[2]! };
  const tree = rest.match(/^tree\/([^/]+)(?:\/(.*))?$/);
  if (tree) return { kind: "tree", owner, repo, ref: tree[1]!, path: tree[2] ?? "" };
  return { kind: "repo", owner, repo, ref: null };
}

export function githubRawUrl(owner: string, repo: string, ref: string, path: string) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

export function languageFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    md: "markdown",
    mdx: "markdown",
    json: "json",
    sql: "sql",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    bash: "shell",
  };
  return map[ext] ?? ext;
}

export function isCodePath(path: string): boolean {
  const lang = languageFromPath(path);
  return Boolean(lang && lang !== "markdown" && lang !== "text" && lang !== "txt");
}

export function shouldIngestGithubPath(path: string): boolean {
  const parts = path.split("/");
  const file = parts[parts.length - 1] ?? "";
  if (SKIP_FILE.has(file.toLowerCase())) return false;
  if (file.startsWith(".")) return false;
  if (file.endsWith(".min.js") || file.endsWith(".map")) return false;
  // Versioned SQL upgrade scripts crowd out real source if we cap file count.
  if (/--\d+\.\d+.*\.sql$/i.test(file)) return false;
  for (const p of parts.slice(0, -1)) {
    if (SKIP_DIR.has(p)) return false;
  }
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
}

function ingestPriority(path: string): number {
  const p = path.toLowerCase();
  if (p.startsWith("src/") && /\.(c|h|cc|cpp|hpp|ts|tsx|js|py|go|rs)$/.test(p)) return 0;
  if (/\.(c|h|cc|cpp|hpp)$/.test(p)) return 1;
  if (/\.(ts|tsx|js|py|go|rs|java)$/.test(p)) return 2;
  if (p.endsWith("readme.md") || p.endsWith("makefile") || p.endsWith("meson.build")) return 3;
  if (p.startsWith(".github/")) return 80;
  return 10;
}

export type GithubTreeEntry = { path: string; type: string; size?: number };

export function filterGithubTree(entries: GithubTreeEntry[], prefix = ""): GithubTreeEntry[] {
  const pre = prefix.replace(/\/$/, "");
  return entries
    .filter((e) => e.type === "blob")
    .filter((e) => (pre ? e.path === pre || e.path.startsWith(`${pre}/`) : true))
    .filter((e) => shouldIngestGithubPath(e.path))
    .filter((e) => (e.size ?? 0) <= GITHUB_MAX_FILE_BYTES)
    .sort((a, b) => ingestPriority(a.path) - ingestPriority(b.path) || a.path.localeCompare(b.path))
    .slice(0, GITHUB_MAX_FILES);
}

export async function githubApi<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "IntelliRAG",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 401 && token) {
    return githubApi<T>(path);
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

export async function resolveDefaultBranch(owner: string, repo: string, token?: string): Promise<string> {
  try {
    const info = await githubApi<{ default_branch?: string }>(`/repos/${owner}/${repo}`, token);
    if (info.default_branch) return info.default_branch;
  } catch {
    // fall through
  }
  return "main";
}

export async function listGithubFiles(opts: {
  owner: string;
  repo: string;
  ref: string;
  prefix?: string;
  token?: string;
}): Promise<{ sha: string; files: GithubTreeEntry[] }> {
  const tree = await githubApi<{ sha: string; tree: GithubTreeEntry[] }>(
    `/repos/${opts.owner}/${opts.repo}/git/trees/${encodeURIComponent(opts.ref)}?recursive=1`,
    opts.token,
  );
  return { sha: tree.sha, files: filterGithubTree(tree.tree ?? [], opts.prefix ?? "") };
}
